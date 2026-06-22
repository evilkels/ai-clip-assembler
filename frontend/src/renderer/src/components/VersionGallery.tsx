import { useState } from 'react';
import type { Version } from '../types/version';
import { VersionCard } from './VersionCard';

interface VersionGalleryProps {
  versions: Version[];
  projectId: string | null;
  onAdopt: (version: Version) => void;
}

export function VersionGallery({
  versions,
  projectId,
  onAdopt,
}: VersionGalleryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Only one Version may play at a time; the gallery owns that single identity.
  const [playingId, setPlayingId] = useState<string | null>(null);

  if (versions.length === 0) {
    return <p className="draft-summary">No versions yet: ask the agent for cuts.</p>;
  }

  return (
    <div
      className={`version-gallery${expandedId ? ' has-focus' : ''}`}
      data-testid="version-gallery"
    >
      {versions.map((version) => (
        <VersionCard
          key={version.version_id}
          version={version}
          projectId={projectId}
          expanded={expandedId === version.version_id}
          playing={playingId === version.version_id}
          onTogglePlay={() =>
            setPlayingId((current) =>
              current === version.version_id ? null : version.version_id,
            )
          }
          onExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
          onAdopt={onAdopt}
        />
      ))}
    </div>
  );
}
