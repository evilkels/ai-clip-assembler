import type { ClipCandidate, ClipDecision } from '../types/clip';
import { ScoreChip } from './ScoreChip';

interface Props {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  mediaUrl?: string;
  onToggleInclude: () => void;
  onExclude: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function formatRange(start: number, end: number): string {
  return `${formatTime(start)} → ${formatTime(end)} (${(end - start).toFixed(1)}s)`;
}

export function ClipCard({ clip, rank, decision, mediaUrl, onToggleInclude, onExclude }: Props) {
  const cls = ['clip-card', decision === 'included' ? 'included' : decision === 'excluded' ? 'excluded' : ''].join(' ');

  return (
    <div className={cls}>
      <div className="clip-thumb">
        <span className="clip-thumb-rank">#{rank}</span>
        {mediaUrl ? (
          <video
            src={`${mediaUrl}#t=${clip.start_sec.toFixed(3)}`}
            preload="metadata"
            muted
            playsInline
            aria-label={`Poster for ${clip.file_name}`}
          />
        ) : (
          <span>Poster unavailable</span>
        )}
        <span className="clip-thumb-time">{(clip.end_sec - clip.start_sec).toFixed(1)}s</span>
      </div>
      <div className="clip-body">
        <strong className="clip-source">{clip.file_name}</strong>
        <div className="clip-meta">
          <span>{formatRange(clip.start_sec, clip.end_sec)}</span>
          <span>
            Scene {clip.scene_id ?? '—'} ·{' '}
            {clip.suggested_speed && clip.suggested_speed !== 1
              ? `${clip.suggested_speed}×`
              : 'normal speed'}
          </span>
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
        <div className="clip-reason">{clip.reason}</div>
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
