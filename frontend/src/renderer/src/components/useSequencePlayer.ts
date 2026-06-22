import { useCallback, useMemo, useRef, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type {
  SequenceSegment,
  UseSequencePlayerArgs,
  UseSequencePlayerResult,
} from './useSequencePlayer.types';

const SEGMENT_END_EPSILON = 0.05;

function effectiveDuration(segment: SequenceSegment): number {
  const span = Math.max(0, segment.end_sec - segment.start_sec);
  return span / (segment.speed ?? 1);
}

interface SequenceTiming {
  durations: number[];
  starts: number[];
  totalDurationSec: number;
}

/** Effective durations and cumulative starts in total Version time. */
function computeTiming(segments: SequenceSegment[]): SequenceTiming {
  const durations = segments.map(effectiveDuration);
  const starts: number[] = [];
  let running = 0;
  for (const duration of durations) {
    starts.push(running);
    running += duration;
  }
  return { durations, starts, totalDurationSec: running };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useSequencePlayer({
  projectId,
  segments,
  loop = false,
  onProgress,
}: UseSequencePlayerArgs): UseSequencePlayerResult {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSourceTimeSec, setCurrentSourceTimeSec] = useState(
    segments[0]?.start_sec ?? 0,
  );
  const [seek, setSeek] = useState({ time: 0, epoch: 0 });
  const advanceLockRef = useRef(false);
  const endedRef = useRef(false);
  const segmentsRef = useRef<SequenceSegment[]>(segments);
  segmentsRef.current = segments;

  const timing = useMemo(() => computeTiming(segments), [segments]);

  const seekTo = useCallback((index: number, sourceTimeSec: number) => {
    advanceLockRef.current = false;
    endedRef.current = false;
    setCurrentIndex(index);
    setCurrentSourceTimeSec(sourceTimeSec);
    setSeek((previous) => ({ time: sourceTimeSec, epoch: previous.epoch + 1 }));
  }, []);

  const onPlaybackTime = useCallback(
    (sourceTimeSec: number) => {
      const currentSegments = segmentsRef.current;
      const segment = currentSegments[currentIndex];
      if (!segment) return;

      if (sourceTimeSec >= segment.end_sec - SEGMENT_END_EPSILON) {
        if (advanceLockRef.current) return;
        advanceLockRef.current = true;
        const nextIndex = currentIndex + 1;
        if (nextIndex >= currentSegments.length) {
          setCurrentSourceTimeSec(segment.end_sec);
          onProgress?.(currentIndex, segment.end_sec);
          if (loop && currentSegments.length > 0) {
            seekTo(0, currentSegments[0].start_sec);
            return;
          }
          endedRef.current = true;
          setPlaying(false);
          return;
        }
        seekTo(nextIndex, currentSegments[nextIndex].start_sec);
        return;
      }

      advanceLockRef.current = false;
      setCurrentSourceTimeSec(sourceTimeSec);
      onProgress?.(currentIndex, sourceTimeSec);
    },
    [currentIndex, loop, onProgress, seekTo],
  );

  const seekToTimelineTime = useCallback(
    (timelineTimeSec: number) => {
      const currentSegments = segmentsRef.current;
      if (currentSegments.length === 0) return;
      const { durations, starts, totalDurationSec } = computeTiming(currentSegments);
      const target = clamp(timelineTimeSec, 0, totalDurationSec);
      let index = currentSegments.length - 1;
      for (let i = 0; i < currentSegments.length; i += 1) {
        if (target < starts[i] + durations[i]) {
          index = i;
          break;
        }
      }
      const segment = currentSegments[index];
      const offsetTimelineSec = target - starts[index];
      const sourceTimeSec = segment.start_sec + offsetTimelineSec * (segment.speed ?? 1);
      seekTo(index, sourceTimeSec);
    },
    [seekTo],
  );

  const play = useCallback(() => {
    const currentSegments = segmentsRef.current;
    if (currentSegments.length === 0) return;
    if (endedRef.current) seekTo(0, currentSegments[0].start_sec);
    setPlaying(true);
  }, [seekTo]);
  const stop = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(
    () => (playing ? stop() : play()),
    [play, playing, stop],
  );

  const segment = segments[currentIndex];
  const currentTimelineTimeSec = segment
    ? clamp(
        (timing.starts[currentIndex] ?? 0) +
          (currentSourceTimeSec - segment.start_sec) / (segment.speed ?? 1),
        0,
        timing.totalDurationSec,
      )
    : 0;

  const previewProps = useMemo<UseSequencePlayerResult['previewProps']>(
    () => ({
      mediaUrl:
        projectId && segment
          ? buildVideoMediaUrl(projectId, segment.file_id)
          : undefined,
      startSec: segment?.start_sec ?? 0,
      endSec: segment?.end_sec ?? 0,
      playing,
      loop: false,
      controls: false,
      seek,
      onPlaybackTime,
      playbackRate: segment?.speed ?? 1,
    }),
    [onPlaybackTime, playing, projectId, seek, segment],
  );

  return {
    playing,
    currentIndex,
    currentSourceTimeSec,
    currentTimelineTimeSec,
    totalDurationSec: timing.totalDurationSec,
    play,
    stop,
    toggle,
    seekTo,
    seekToTimelineTime,
    previewProps,
  };
}

export type { SequenceSegment } from './useSequencePlayer.types';
