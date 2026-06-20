import type { Version } from '../types/version';
import { VersionPlayer } from './VersionPlayer';

interface VersionCardProps {
  version: Version;
  projectId: string | null;
  expanded: boolean;
  onExpand: (id: string) => void;
  onAdopt: (version: Version) => void;
}

export function VersionCard({
  version,
  projectId,
  expanded,
  onExpand,
  onAdopt,
}: VersionCardProps) {
  return (
    <article
      className={`version-card${expanded ? ' expanded' : ''}`}
      data-testid="version-card"
    >
      <div
        className="version-card-surface"
        data-testid="version-card-surface"
        onClick={() => onExpand(version.version_id)}
      >
        <VersionPlayer
          version={version}
          projectId={projectId}
          expanded={expanded}
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
        <button
          type="button"
          className="btn primary"
          data-testid="version-adopt"
          onClick={() => onAdopt(version)}
        >
          Use this version
        </button>
      </div>
    </article>
  );
}
