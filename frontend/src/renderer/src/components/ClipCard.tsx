import { useRef, useState } from 'react';
import type { ClipCandidate, ClipDecision } from '../types/clip';
import { verdictFor } from '../lib/scoring';
import { ScoreChip } from './ScoreChip';

interface Range {
  start: number;
  end: number;
}

interface Props {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  mediaUrl?: string;
  /** 1-based position in the current timeline, or undefined if not in the draft. */
  draftPosition?: number;
  /** Other candidate clips from the same source file, for the file track. */
  siblingRanges?: Range[];
  /** 1-based index of this clip among candidates from the same source file. */
  fileClipIndex?: number;
  /** Total candidates from the same source file. */
  fileClipCount?: number;
  onToggleInclude: () => void;
  onExclude: () => void;
}

/** Stable, evenly-spread colour per source file so cards from the same video
 *  share a recognisable accent. */
function fileColor(fileId: string): string {
  let hash = 0;
  for (let i = 0; i < fileId.length; i += 1) {
    hash = (hash * 31 + fileId.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 70%, 62%)`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function formatRange(start: number, end: number): string {
  return `${formatTime(start)} → ${formatTime(end)} (${(end - start).toFixed(1)}s)`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** A bar spanning the full source file with the clip region, sibling candidates
 *  and a live playhead marked on it. */
function SourceTrack({
  durationSec,
  startSec,
  endSec,
  playheadSec,
  siblings,
  accent,
  onSeek,
}: {
  durationSec: number;
  startSec: number;
  endSec: number;
  playheadSec: number;
  siblings: Range[];
  accent: string;
  onSeek?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const left = (t: number) => `${clamp01(t / durationSec) * 100}%`;
  const width = (a: number, b: number) => `${clamp01((b - a) / durationSec) * 100}%`;
  return (
    <div className="source-track-wrap">
      <div
        className={`source-track${onSeek ? ' seekable' : ''}`}
        onClick={onSeek}
        title={`Clip is ${formatTime(startSec)}–${formatTime(endSec)} of a ${formatTime(durationSec)} file`}
      >
        {siblings.map((s, i) => (
          <span
            key={`${s.start}-${i}`}
            className="source-track-sibling"
            style={{ left: left(s.start), width: width(s.start, s.end) }}
          />
        ))}
        <span
          className="source-track-clip"
          style={{ left: left(startSec), width: width(startSec, endSec), background: accent }}
        />
        <span className="source-track-playhead" style={{ left: left(playheadSec) }} />
      </div>
      <span className="source-track-caption">
        {formatTime(startSec)}–{formatTime(endSec)} of {formatTime(durationSec)}
      </span>
    </div>
  );
}

export function ClipCard({
  clip,
  rank,
  decision,
  mediaUrl,
  draftPosition,
  siblingRanges = [],
  fileClipIndex,
  fileClipCount,
  onToggleInclude,
  onExclude,
}: Props) {
  const cls = ['clip-card', decision === 'included' ? 'included' : decision === 'excluded' ? 'excluded' : ''].join(' ');
  const verdict = verdictFor(clip.scores.overall);
  const accent = fileColor(clip.file_id);
  const hasSiblings = (fileClipCount ?? 1) > 1;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(clip.start_sec);
  const sourceDuration = clip.source_duration_sec ?? null;

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      return;
    }
    if (video.currentTime < clip.start_sec || video.currentTime >= clip.end_sec - 0.05) {
      video.currentTime = clip.start_sec;
    }
    video.play().catch(() => {});
  };

  const seekFromTrack = (event: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !sourceDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    // Keep previews inside the candidate's own range so the loop stays meaningful.
    const target = Math.max(clip.start_sec, Math.min(clip.end_sec - 0.05, frac * sourceDuration));
    video.currentTime = target;
    setPlayheadSec(target);
  };

  return (
    <div className={cls}>
      <div className="clip-thumb">
        <span className="clip-thumb-rank">#{rank}</span>
        {draftPosition !== undefined && (
          <span className="clip-thumb-draft" title="Position in the current timeline">
            ◆ Timeline #{draftPosition}
          </span>
        )}
        {mediaUrl ? (
          <>
            <video
              ref={videoRef}
              src={`${mediaUrl}#t=${clip.start_sec.toFixed(3)}`}
              preload="metadata"
              muted
              playsInline
              aria-label={`Preview ${clip.file_name}`}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (video.currentTime >= clip.end_sec) {
                  video.currentTime = clip.start_sec;
                }
                setPlayheadSec(video.currentTime);
              }}
            />
            <button
              type="button"
              className="clip-play-btn"
              onClick={togglePlay}
              aria-label={playing ? 'Pause preview' : 'Play clip'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
          </>
        ) : (
          <span>Poster unavailable</span>
        )}
        <span className="clip-thumb-time">{(clip.end_sec - clip.start_sec).toFixed(1)}s</span>
      </div>
      {sourceDuration && sourceDuration > 0 && (
        <SourceTrack
          durationSec={sourceDuration}
          startSec={clip.start_sec}
          endSec={clip.end_sec}
          playheadSec={playheadSec}
          siblings={siblingRanges}
          accent={accent}
          onSeek={mediaUrl ? seekFromTrack : undefined}
        />
      )}
      <div className="clip-body">
        <div className="clip-source-row">
          <span className="clip-file-dot" style={{ background: accent }} title="Source file" />
          <strong className="clip-source">{clip.file_name}</strong>
          {hasSiblings && (
            <span className="clip-file-group" style={{ borderColor: accent, color: accent }}>
              {fileClipIndex} of {fileClipCount} from this file
            </span>
          )}
        </div>
        <div className="clip-meta">
          <span>{formatRange(clip.start_sec, clip.end_sec)}</span>
          <span>
            Scene {clip.scene_id ?? '—'} ·{' '}
            {clip.suggested_speed && clip.suggested_speed !== 1
              ? `${clip.suggested_speed}×`
              : 'normal speed'}
          </span>
        </div>
        <div className="clip-verdict-row">
          <span className={`clip-verdict ${verdict.tier}`}>{verdict.label}</span>
          <span className="clip-verdict-blurb">{verdict.blurb}</span>
        </div>
        <div className="score-row">
          <ScoreChip label="smooth" value={clip.scores.smoothness} />
          {typeof clip.scores.visualInterest === 'number' && clip.scores.visualInterest > 0 && (
            <ScoreChip label="visual" value={clip.scores.visualInterest} />
          )}
          <ScoreChip label="combined" value={clip.scores.overall} />
        </div>
        <details className="clip-score-details">
          <summary>Local technical scores</summary>
          <div className="score-row">
            <ScoreChip label="sharp" value={clip.scores.sharpness} />
            <ScoreChip label="expose" value={clip.scores.exposure} />
            <ScoreChip label="contrast" value={clip.scores.contrast} />
          </div>
        </details>
        {clip.reason && (
          <div className="clip-reason">
            <span className="clip-reason-label">Why</span> {clip.reason}
          </div>
        )}
        <div className="clip-actions">
          <button
            className={decision === 'included' ? 'btn primary' : 'btn'}
            onClick={onToggleInclude}
          >
            {decision === 'included' ? 'Included ✓' : 'Include'}
          </button>
          <button className="btn subtle" onClick={onExclude}>
            {decision === 'excluded' ? 'Excluded' : 'Exclude'}
          </button>
        </div>
      </div>
    </div>
  );
}
