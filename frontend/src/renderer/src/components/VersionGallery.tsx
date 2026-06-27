import { useState } from 'react';
import type { TimelineSnapshot } from '../api/client';
import { deriveVersionState } from '../state/versionState';
import type { Version, VersionSet } from '../types/version';
import { VersionCard } from './VersionCard';

interface VersionGalleryProps {
  versionSet: VersionSet | null;
  snapshot: TimelineSnapshot | null;
  availableClipIds: Set<string>;
  projectId: string | null;
  onApply: (version: Version) => void;
}

export function VersionGallery({
  versionSet,
  snapshot,
  availableClipIds,
  projectId,
  onApply,
}: VersionGalleryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Only one Version may play at a time; the gallery owns that single identity.
  const [playingId, setPlayingId] = useState<string | null>(null);

  const versions = versionSet?.versions ?? [];
  if (versions.length === 0) {
    return <p className="draft-summary">No suggestions yet. Ask the AI for a cut.</p>;
  }

  return (
    <div
      className={`version-gallery${expandedId ? ' has-focus' : ''}`}
      data-testid="version-gallery"
    >
      {versions.map((version) => {
        const displayState = versionSet && snapshot
          ? deriveVersionState({ version, versionSet, snapshot, availableClipIds })
          : 'current';
        const missingClipNames: string[] = [];
        for (const item of version.items) {
          if (!availableClipIds.has(item.source_clip_id)) {
            missingClipNames.push(item.file_name || item.source_clip_id);
          }
        }
        return <VersionCard
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
          displayState={displayState}
          missingClipNames={[...new Set(missingClipNames)]}
          onApply={onApply}
        />;
      })}
    </div>
  );
}
