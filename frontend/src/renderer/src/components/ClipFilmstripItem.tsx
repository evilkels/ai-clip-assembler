import type { ClipCandidate, ClipDecision } from '../types/clip';
import { formatClock } from '../lib/format';
import { reviewFileAccentStyle } from '../lib/reviewView';
import { ScoreChip } from './ScoreChip';
import { SourceTrack, type Range } from './SourceTrack';

interface ClipFilmstripItemProps {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  timelinePosition?: number;
  versionLabels?: string[];
  /** Other candidates cut from the same source file, drawn on the file track. */
  siblingRanges?: Range[];
  onToggleInclude: () => void;
}

export function ClipFilmstripItem({
  clip,
  rank,
  decision,
  timelinePosition,
  versionLabels = [],
  siblingRanges = [],
  onToggleInclude,
}: ClipFilmstripItemProps) {
  const style = reviewFileAccentStyle(clip.file_id);
  const included = timelinePosition !== undefined;
  const sourceDuration = clip.source_duration_sec ?? null;

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
        {sourceDuration && sourceDuration > 0 ? (
          <SourceTrack
            durationSec={sourceDuration}
            startSec={clip.start_sec}
            endSec={clip.end_sec}
            playheadSec={clip.start_sec}
            siblings={siblingRanges}
            accent="var(--clip-accent)"
          />
        ) : null}
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
