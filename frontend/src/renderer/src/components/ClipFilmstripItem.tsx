import type { CSSProperties } from 'react';
import type { ClipCandidate, ClipDecision } from '../types/clip';
import { formatClock } from '../lib/format';
import { reviewFileAccent } from '../lib/reviewView';
import { ScoreChip } from './ScoreChip';

interface ClipFilmstripItemProps {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  timelinePosition?: number;
  versionLabels?: string[];
  onToggleInclude: () => void;
}

export function ClipFilmstripItem({
  clip,
  rank,
  decision,
  timelinePosition,
  versionLabels = [],
  onToggleInclude,
}: ClipFilmstripItemProps) {
  const accent = reviewFileAccent(clip.file_id);
  const style = { '--clip-accent': accent } as CSSProperties;
  const included = timelinePosition !== undefined;

  return (
    <article
      className={`clip-filmstrip-item ${decision === 'included' ? 'included' : decision === 'excluded' ? 'excluded' : ''}`}
      data-review-clip={clip.clip_id}
      data-rank={rank}
      style={style}
    >
      <div className="clip-filmstrip-poster" aria-hidden="true">
        <span>#{rank}</span>
        <strong>{(clip.end_sec - clip.start_sec).toFixed(1)}s</strong>
      </div>
      <div className="clip-filmstrip-info">
        <strong className="clip-source" title={clip.file_name}>{clip.file_name}</strong>
        <span className="clip-filmstrip-time">
          {formatClock(clip.start_sec)} → {formatClock(clip.end_sec)}
        </span>
        <div className="score-row">
          <ScoreChip label="smooth" value={clip.scores.smoothness} />
          <ScoreChip label="combined" value={clip.scores.overall} />
        </div>
        {timelinePosition !== undefined ? <span className="clip-filmstrip-status">Timeline #{timelinePosition}</span> : null}
        {versionLabels.length > 0 ? <span className="clip-filmstrip-status">Proposed in {versionLabels.join('/')}</span> : null}
      </div>
      <button
        type="button"
        className={included ? 'btn subtle' : 'btn primary'}
        aria-label={included ? 'Remove' : 'Include'}
        onClick={onToggleInclude}
      >
        {included ? 'Remove' : 'Include'}
      </button>
    </article>
  );
}
