import type { Version } from '../types/version';
import type { VersionDisplayState } from '../state/versionState';
import { VersionPlayer } from './VersionPlayer';

interface VersionCardProps {
  version: Version;
  projectId: string | null;
  expanded: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  onExpand: (id: string) => void;
  displayState: VersionDisplayState;
  missingClipNames: string[];
  onApply: (version: Version) => void;
}

export function VersionCard({
  version,
  projectId,
  expanded,
  playing,
  onTogglePlay,
  onExpand,
  displayState,
  missingClipNames,
  onApply,
}: VersionCardProps) {
  const stateLabel = {
    applied: 'In working timeline',
    current: 'Current suggestion',
    stale: 'Out of date',
    unavailable: 'Unavailable',
  }[displayState];
  return (
    <article
      className={`version-card${expanded ? ' expanded' : ''}`}
      data-testid="version-card"
      data-version-state={displayState}
    >
      <div className="version-card-surface" data-testid="version-card-surface">
        <VersionPlayer
          version={version}
          projectId={projectId}
          expanded={expanded}
          playing={playing}
          onTogglePlay={onTogglePlay}
          onExpand={() => onExpand(version.version_id)}
          testId={`version-player-${version.version_id}`}
        />
      </div>
      <div className="version-card-body">
        <div className="version-card-heading">
          <div>
            <strong>{version.title}</strong>
            <span className="version-vibe" data-testid="version-vibe">
              {version.vibe} · {version.total_duration_sec}s
            </span>
          </div>
          <button
            type="button"
            className="version-expand"
            onClick={() => onExpand(version.version_id)}
            aria-label={expanded ? `Collapse ${version.title}` : `Focus ${version.title}`}
          >
            {expanded ? 'Collapse' : 'Focus'}
          </button>
        </div>
        <p className="version-rationale">{version.rationale}</p>
        <p className={`version-state version-state-${displayState}`}>{stateLabel}</p>
        {missingClipNames.length > 0 ? (
          <p className="version-missing">Missing Source Clips: {missingClipNames.join(', ')}</p>
        ) : null}
        <button
          type="button"
          className="btn primary"
          data-testid="version-adopt"
          onClick={() => onApply(version)}
          disabled={displayState === 'unavailable'}
        >
          Apply to working timeline
        </button>
      </div>
    </article>
  );
}
