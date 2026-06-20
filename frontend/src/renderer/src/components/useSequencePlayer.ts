import { useCallback, useMemo, useRef, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type {
  SequenceSegment,
  UseSequencePlayerArgs,
  UseSequencePlayerResult,
} from './useSequencePlayer.types';

const SEGMENT_END_EPSILON = 0.05;

export function useSequencePlayer({
  projectId,
  segments,
  loop = false,
  onProgress,
}: UseSequencePlayerArgs): UseSequencePlayerResult {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [seek, setSeek] = useState({ time: 0, epoch: 0 });
  const advanceLockRef = useRef(false);
  const endedRef = useRef(false);
  const segmentsRef = useRef<SequenceSegment[]>(segments);
  segmentsRef.current = segments;

  const seekTo = useCallback((index: number, sourceTimeSec: number) => {
    advanceLockRef.current = false;
    endedRef.current = false;
    setCurrentIndex(index);
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
      onProgress?.(currentIndex, sourceTimeSec);
    },
    [currentIndex, loop, onProgress, seekTo],
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
    play,
    stop,
    toggle,
    seekTo,
    previewProps,
  };
}

export type { SequenceSegment } from './useSequencePlayer.types';
