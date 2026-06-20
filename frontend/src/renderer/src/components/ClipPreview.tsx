import { useEffect, useMemo, useRef } from 'react';

interface SeekCommand {
  time: number;
  epoch: number;
}

interface ClipPreviewProps {
  mediaUrl?: string;
  startSec: number;
  endSec: number;
  label: string;
  currentTimeSec?: number;
  playing?: boolean;
  loop?: boolean;
  testId: string;
  controls?: boolean;
  /**
   * Explicit seek command: applied once per epoch change (and re-applied after
   * a src swap). When set, the legacy currentTimeSec drift-correction path is
   * disabled and the video clock is never corrected while playing.
   */
  seek?: SeekCommand;
  /** Reports video.currentTime every animation frame while playing. */
  onPlaybackTime?: (sourceTimeSec: number) => void;
  /** Source playback speed. */
  playbackRate?: number;
  /** Digital zoom applied to the rendered video. */
  scale?: number;
}

function boundedStart(startSec: number, endSec: number): number {
  return Math.max(0, Math.min(startSec, Math.max(startSec, endSec - 0.05)));
}

export function ClipPreview({
  mediaUrl,
  startSec,
  endSec,
  label,
  currentTimeSec,
  playing = false,
  loop = true,
  testId,
  controls = true,
  seek,
  onPlaybackTime,
  playbackRate = 1,
  scale = 1,
}: ClipPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const appliedSeekRef = useRef<{ epoch: number; mediaUrl: string } | null>(null);
  const safeStart = useMemo(() => boundedStart(startSec, endSec), [startSec, endSec]);
  const targetTime = currentTimeSec ?? safeStart;

  // Legacy path (ClipCard): keep the video at targetTime.
  useEffect(() => {
    if (seek) return;
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    const apply = () => {
      video.currentTime = targetTime;
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [seek, mediaUrl, targetTime]);

  // Command path (Timeline): seek only when the epoch changes or the src swaps.
  useEffect(() => {
    if (!seek) return;
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    const applied = appliedSeekRef.current;
    if (applied && applied.epoch === seek.epoch && applied.mediaUrl === mediaUrl) return;
    appliedSeekRef.current = { epoch: seek.epoch, mediaUrl };
    const apply = () => {
      video.currentTime = seek.time;
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [seek, mediaUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [mediaUrl, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [mediaUrl, playbackRate]);

  // Report the video clock while playing (RAF for smooth playhead motion).
  useEffect(() => {
    if (!playing || !onPlaybackTime) return;
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const tick = () => {
      onPlaybackTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onPlaybackTime]);

  if (!mediaUrl) {
    return (
      <div className="clip-preview missing" data-testid={`${testId}-missing`}>
        <span>{label}</span>
        <span>No preview</span>
      </div>
    );
  }

  return (
    <div className="clip-preview">
      <video
        ref={videoRef}
        data-testid={testId}
        src={mediaUrl}
        controls={controls}
        muted
        preload="metadata"
        playsInline
        aria-label={label}
        style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}
        onLoadedMetadata={(event) => {
          if (!seek) event.currentTarget.currentTime = targetTime;
        }}
        onTimeUpdate={
          // The clip-range clamp belongs to native controls (ClipCard usage);
          // with controls off the owner drives boundaries via seek commands.
          controls
            ? (event) => {
                const video = event.currentTarget;
                if (video.currentTime < startSec) video.currentTime = safeStart;
                if (video.currentTime >= endSec) {
                  if (loop && endSec > startSec) {
                    video.currentTime = safeStart;
                    if (playing) video.play().catch(() => {});
                  } else {
                    video.pause();
                    video.currentTime = safeStart;
                  }
                }
              }
            : undefined
        }
      />
      <div className="clip-preview-label">{label}</div>
    </div>
  );
}
