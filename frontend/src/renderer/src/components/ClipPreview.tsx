import { useEffect, useMemo, useRef } from 'react';

interface ClipPreviewProps {
  mediaUrl?: string;
  startSec: number;
  endSec: number;
  label: string;
  currentTimeSec?: number;
  playing?: boolean;
  loop?: boolean;
  testId: string;
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
}: ClipPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const safeStart = useMemo(() => boundedStart(startSec, endSec), [startSec, endSec]);
  const targetTime = currentTimeSec ?? safeStart;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    const seek = () => {
      video.currentTime = targetTime;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [mediaUrl, targetTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (Math.abs(video.currentTime - targetTime) > 0.35) {
      video.currentTime = targetTime;
    }
  }, [mediaUrl, targetTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [mediaUrl, playing]);

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
        controls
        muted
        preload="metadata"
        playsInline
        aria-label={label}
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = targetTime;
        }}
        onTimeUpdate={(event) => {
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
        }}
      />
      <div className="clip-preview-label">{label}</div>
    </div>
  );
}
