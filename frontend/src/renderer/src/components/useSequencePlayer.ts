import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  skipUnavailable = false,
  onProgress,
}: UseSequencePlayerArgs): UseSequencePlayerResult {
  const [playing, setPlaying] = useState(false);
  const [currentIndexState, setCurrentIndex] = useState(0);
  const [currentSourceTimeSec, setCurrentSourceTimeSec] = useState(
    segments[0]?.start_sec ?? 0,
  );
  const [seek, setSeek] = useState({ time: 0, epoch: 0 });
  const advanceLockRef = useRef(false);
  const endedRef = useRef(false);
  const segmentsRef = useRef<SequenceSegment[]>(segments);
  const activeItemIdRef = useRef<string | undefined>(segments[0]?.item_id);
  const currentIndexRef = useRef(0);
  segmentsRef.current = segments;

  const timing = useMemo(() => computeTiming(segments), [segments]);

  const findPlayableIndex = useCallback(
    (fromIndex: number) => {
      if (!skipUnavailable) return fromIndex < segments.length ? fromIndex : -1;
      for (let index = Math.max(0, fromIndex); index < segments.length; index += 1) {
        if (segments[index]?.file_id) return index;
      }
      return -1;
    },
    [segments, skipUnavailable],
  );

  // Timeline segments carry stable item IDs, while VersionPlayer's legacy
  // segments do not. Resolve by identity when available and retain the old
  // index-based behavior for callers without IDs.
  const currentIndex = useMemo(() => {
    if (segments.length === 0) return 0;
    const activeItemId = activeItemIdRef.current;
    if (activeItemId !== undefined) {
      const identityIndex = segments.findIndex((segment) => segment.item_id === activeItemId);
      if (identityIndex >= 0) return identityIndex;
    }
    return clamp(currentIndexState, 0, segments.length - 1);
  }, [currentIndexState, segments]);
  currentIndexRef.current = currentIndex;

  const seekTo = useCallback((index: number, sourceTimeSec: number) => {
    advanceLockRef.current = false;
    endedRef.current = false;
    activeItemIdRef.current = segmentsRef.current[index]?.item_id;
    currentIndexRef.current = index;
    setCurrentIndex(index);
    setCurrentSourceTimeSec(sourceTimeSec);
    setSeek((previous) => ({ time: sourceTimeSec, epoch: previous.epoch + 1 }));
  }, []);

  // Reconcile the public index after Timeline Items are reordered, removed,
  // or replaced by an SSE snapshot. A removed active item falls back to the
  // surviving item at the old index (or the final item), and seeks to its
  // source start. ID-less VersionPlayer sequences remain index-based.
  useEffect(() => {
    if (segments.length === 0) {
      activeItemIdRef.current = undefined;
      if (currentIndexState !== 0) setCurrentIndex(0);
      return;
    }

    const hasItemIds = segments.some((segment) => segment.item_id !== undefined);
    const activeItemId = activeItemIdRef.current;
    if (activeItemId === undefined && hasItemIds) {
      activeItemIdRef.current = segments[currentIndex]?.item_id;
    } else if (activeItemId !== undefined && !segments.some((segment) => segment.item_id === activeItemId)) {
      const fallbackIndex = clamp(currentIndexState, 0, segments.length - 1);
      seekTo(fallbackIndex, segments[fallbackIndex].start_sec);
      return;
    }

    if (currentIndexState !== currentIndex) setCurrentIndex(currentIndex);
  }, [currentIndex, currentIndexState, seekTo, segments]);

  const onPlaybackTime = useCallback(
    (sourceTimeSec: number) => {
      const currentSegments = segmentsRef.current;
      const playbackIndex = currentIndexRef.current;
      const segment = currentSegments[playbackIndex];
      if (!segment) return;

      if (sourceTimeSec >= segment.end_sec - SEGMENT_END_EPSILON) {
        if (advanceLockRef.current) return;
        advanceLockRef.current = true;
        const nextIndex = skipUnavailable
          ? currentSegments.findIndex(
              (candidate, index) => index > playbackIndex && Boolean(candidate.file_id),
            )
          : playbackIndex + 1;
        if (nextIndex < 0 || nextIndex >= currentSegments.length) {
          setCurrentSourceTimeSec(segment.end_sec);
          onProgress?.(playbackIndex, segment.end_sec);
          if (loop && currentSegments.length > 0) {
            const loopIndex = skipUnavailable ? findPlayableIndex(0) : 0;
            if (loopIndex >= 0) {
              seekTo(loopIndex, currentSegments[loopIndex].start_sec);
              return;
            }
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
      onProgress?.(playbackIndex, sourceTimeSec);
    },
    [findPlayableIndex, loop, onProgress, seekTo, skipUnavailable],
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
    const requestedIndex = endedRef.current ? 0 : currentIndexRef.current;
    const playableIndex = findPlayableIndex(requestedIndex);
    if (playableIndex < 0) {
      setPlaying(false);
      return;
    }
    if (playableIndex !== currentIndexRef.current) {
      seekTo(playableIndex, currentSegments[playableIndex].start_sec);
    }
    setPlaying(true);
  }, [findPlayableIndex, seekTo]);
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
        projectId && segment?.file_id
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
