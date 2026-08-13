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
  /** Silence the element. Preview audio is off unless the user asks for it. */
  muted?: boolean;
  /** 0..1, applied as a property: `volume` is not a valid HTML attribute. */
  volume?: number;
  /** Called when Chromium refuses unmuted playback so the UI can show muted. */
  onAudioBlocked?: () => void;
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
  muted = true,
  volume = 1,
  onAudioBlocked,
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
      video.play().catch(() => {
        // Chromium refuses unmuted playback without a user gesture, and the
        // Timeline advances segments on its own clock. Retry muted so the
        // playhead never stalls, and tell the owner the app fell back.
        if (video.muted) return;
        video.muted = true;
        onAudioBlocked?.();
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }
  }, [mediaUrl, playing, onAudioBlocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [mediaUrl, playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React does not reliably propagate a changed `muted` prop to a mounted
    // media element, so own it here rather than trusting the JSX attribute.
    video.muted = muted;
    video.volume = Math.max(0, Math.min(1, volume));
    // Pin the retime behavior instead of relying on the browser default, so a
    // 0.5x or 2x clip is time-stretched (dialogue stays intelligible) in every
    // build, matching Resolve's own audio retime.
    video.preservesPitch = true;
  }, [mediaUrl, muted, volume]);

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
        muted={muted}
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
      >
        {/* Source footage carries no caption track; declaring an empty one
            keeps the now-audible preview accessible. */}
        <track kind="captions" />
      </video>
      <div className="clip-preview-label">{label}</div>
    </div>
  );
}
