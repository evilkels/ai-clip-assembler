import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ClipCandidate, ClipDecision } from '../types/clip';
import { verdictFor } from '../lib/scoring';
import { formatClock } from '../lib/format';
import { ScoreChip } from './ScoreChip';
import { SourceTrack, type Range } from './SourceTrack';
import { SourceAudioBadge } from './SourceAudioBadge';
import { sourceAudioState } from '../lib/sourceAudio';
import { useReview } from '../state/ReviewContext';
import { usePreviewAudio } from '../state/usePreviewAudio';
import { reviewFileAccent } from '../lib/reviewView';

const EMPTY_RANGES: Range[] = [];
const EMPTY_VERSION_LABELS: string[] = [];

interface Props {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  mediaUrl?: string;
  /** 1-based position in the current timeline, or undefined if not in the draft. */
  draftPosition?: number;
  /** Current Version labels that contain this Candidate Clip. */
  versionLabels?: string[];
  /** Other candidate clips from the same source file, for the file track. */
  siblingRanges?: Range[];
  /** 1-based index of this clip among candidates from the same source file. */
  fileClipIndex?: number;
  /** Total candidates from the same source file. */
  fileClipCount?: number;
  /** Other candidates sharing this clip's look group (visually similar shots),
   *  hidden by default and revealed via the toggle below. Undefined/0 when
   *  the clip has no look group or is the only member of one. */
  similarLookCount?: number;
  similarLooksExpanded?: boolean;
  onToggleSimilarLooks?: () => void;
  onToggleInclude: () => void;
}

function formatRange(start: number, end: number): string {
  return `${formatClock(start)} → ${formatClock(end)} (${(end - start).toFixed(1)}s)`;
}

function generationWhy(clip: ClipCandidate): string {
  const kind = clip.tags?.includes('fallback') ? 'fallback' : 'smooth';
  const turn =
    typeof clip.max_turn_rate_deg_per_sec === 'number'
      ? `${clip.max_turn_rate_deg_per_sec.toFixed(1)}°/s turn`
      : 'turn unavailable';
  return `Scene ${clip.scene_id ?? '—'} · ${kind} · smooth ${clip.scores.smoothness.toFixed(1)} · ${turn}`;
}

export function ClipCard({
  clip,
  rank,
  decision,
  mediaUrl,
  draftPosition,
  versionLabels = EMPTY_VERSION_LABELS,
  siblingRanges = EMPTY_RANGES,
  fileClipIndex,
  fileClipCount,
  similarLookCount = 0,
  similarLooksExpanded = false,
  onToggleSimilarLooks,
  onToggleInclude,
}: Props) {
  const cls = ['clip-card', decision === 'included' ? 'included' : decision === 'excluded' ? 'excluded' : ''].join(' ');
  const verdict = verdictFor(clip.scores.overall);
  const accent = reviewFileAccent(clip.file_id);
  const accentStyle = { '--clip-accent': accent } as CSSProperties;
  const hasSiblings = (fileClipCount ?? 1) > 1;
  const videoRef = useRef<HTMLVideoElement>(null);
  const { uploadedVideos } = useReview();
  const { muted, volume, setMuted } = usePreviewAudio();
  const sourceAudio = sourceAudioState(clip.file_id, uploadedVideos);
  // A source known to have no audio stays silent whatever the preference says.
  const cardMuted = muted || sourceAudio.hasAudio === false;
  const [playing, setPlaying] = useState(false);
  // Seed-only: playhead starts at the clip's in-point, then moves independently
  // as the preview plays. Not state derived from the prop on every render.
  // react-doctor-disable-next-line react-doctor/no-derived-useState
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
    video.play().catch(() => {
      // Chromium refuses unmuted playback without a gesture; fall back to
      // muted rather than leaving a dead play button, and say so in the UI.
      if (video.muted) return;
      video.muted = true;
      setMuted(true);
      video.play().catch(() => {});
    });
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React does not reliably propagate a changed `muted` prop to a mounted
    // media element, so own it here rather than trusting the JSX attribute.
    video.muted = cardMuted;
    video.volume = Math.max(0, Math.min(1, volume));
    video.preservesPitch = true;
  }, [cardMuted, volume]);

  const seekFromTrack = (event: React.MouseEvent<HTMLButtonElement>) => {
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
    <div className={cls} style={accentStyle}>
      <div className="clip-thumb">
        <span className="clip-thumb-rank">#{rank}</span>
        {draftPosition !== undefined && (
          <span className="clip-thumb-draft" title="Position in the current timeline">
            ◆ Timeline #{draftPosition}
          </span>
        )}
        {versionLabels.length > 0 ? (
          <span className="clip-thumb-proposed">Proposed in {versionLabels.join('/')}</span>
        ) : null}
        {mediaUrl ? (
          <>
            <video
              ref={videoRef}
              src={`${mediaUrl}#t=${clip.start_sec.toFixed(3)}`}
              preload="metadata"
              muted={cardMuted}
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
            >
              {/* Source footage carries no caption track; declaring an empty
                  one keeps the now-audible preview accessible. */}
              <track kind="captions" />
            </video>
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
          accent="var(--clip-accent)"
          onSeek={mediaUrl ? seekFromTrack : undefined}
        />
      )}
      <div className="clip-body">
        <div className="clip-source-row">
          <span className="clip-file-dot" title="Source file" />
          <strong className="clip-source">{clip.file_name}</strong>
          <SourceAudioBadge hasAudio={sourceAudio.hasAudio} channels={sourceAudio.channels} />
          {hasSiblings && (
            <span className="clip-file-group">
              {fileClipIndex} of {fileClipCount} from this file
            </span>
          )}
          {similarLookCount > 0 && (
            <button
              type="button"
              className="clip-look-group-badge"
              onClick={onToggleSimilarLooks}
              aria-expanded={similarLooksExpanded}
            >
              {similarLooksExpanded ? 'Hide similar' : `${similarLookCount} similar look${similarLookCount === 1 ? '' : 's'}`}
            </button>
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
        <div className="clip-generation-why">{generationWhy(clip)}</div>
        {clip.reason && (
          <div className="clip-reason">
            <span className="clip-reason-label">Why</span> {clip.reason}
          </div>
        )}
        <div className="clip-actions">
          <button type="button"
            className={draftPosition !== undefined ? 'btn subtle' : 'btn primary'}
            onClick={onToggleInclude}
          >
            {draftPosition !== undefined
              ? 'Remove from working timeline'
              : 'Add to working timeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
