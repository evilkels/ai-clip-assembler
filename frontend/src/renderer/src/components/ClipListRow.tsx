import type { CSSProperties } from 'react';
import type { ClipDecision, ClipCandidate } from '../types/clip';
import { formatClock } from '../lib/format';
import { reviewFileAccent } from '../lib/reviewView';
import { ScoreChip } from './ScoreChip';
import { SourceTrack, type Range } from './SourceTrack';

interface ClipListRowProps {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  timelinePosition?: number;
  versionLabels?: string[];
  siblingRanges?: Range[];
  fileClipIndex?: number;
  fileClipCount?: number;
  onToggleInclude: () => void;
}

export function ClipListRow({
  clip,
  rank,
  decision,
  timelinePosition,
  versionLabels = [],
  siblingRanges = [],
  fileClipIndex,
  fileClipCount,
  onToggleInclude,
}: ClipListRowProps) {
  const accent = reviewFileAccent(clip.file_id);
  const style = { '--clip-accent': accent } as CSSProperties;
  const duration = clip.end_sec - clip.start_sec;
  const sourceDuration = clip.source_duration_sec ?? null;
  const included = timelinePosition !== undefined;

  return (
    <article
      className={`clip-list-row ${decision === 'included' ? 'included' : decision === 'excluded' ? 'excluded' : ''}`}
      data-review-clip={clip.clip_id}
      data-rank={rank}
      style={style}
    >
      <div className="clip-list-poster" aria-hidden="true">
        <span>#{rank}</span>
        <strong>{duration.toFixed(1)}s</strong>
      </div>
      <div className="clip-list-main">
        <div className="clip-source-row">
          <span className="clip-file-dot" title="Source file" />
          <strong className="clip-source">{clip.file_name}</strong>
          {fileClipCount && fileClipCount > 1 ? (
            <span className="clip-file-group">
              {fileClipIndex} of {fileClipCount} from this file
            </span>
          ) : null}
        </div>
        <div className="clip-meta clip-list-meta">
          <span>{formatClock(clip.start_sec)} → {formatClock(clip.end_sec)}</span>
          <span>Scene {clip.scene_id ?? '—'}</span>
          {timelinePosition !== undefined ? <span>Timeline #{timelinePosition}</span> : null}
          {versionLabels.length > 0 ? <span>Proposed in {versionLabels.join('/')}</span> : null}
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
      </div>
      <div className="clip-list-scores">
        <ScoreChip label="smooth" value={clip.scores.smoothness} />
        <ScoreChip label="combined" value={clip.scores.overall} />
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
