import { useMemo, useState } from 'react';
import type { TimelineSnapshot } from '../api/client';
import type { Version, VersionItem } from '../types/version';

interface VersionApplyDialogProps {
  version: Version;
  snapshot: TimelineSnapshot;
  onApply: (version: Version, expectedRevision: number) => Promise<void>;
  onClose: () => void;
}

function duration(items: Array<VersionItem | TimelineSnapshot['document']['items'][number]>): number {
  return items.reduce((total, item) => total + (item.end_sec - item.start_sec) / item.speed, 0);
}

function samePlacement(
  current: TimelineSnapshot['document']['items'][number] | undefined,
  proposed: VersionItem | undefined,
): boolean {
  return Boolean(
    current &&
      proposed &&
      current.source_clip_id === proposed.source_clip_id &&
      current.start_sec === proposed.start_sec &&
      current.end_sec === proposed.end_sec &&
      current.speed === proposed.speed &&
      current.transform.scale === proposed.transform.scale &&
      current.transform.x === proposed.transform.x &&
      current.transform.y === proposed.transform.y,
  );
}

export function VersionApplyDialog({
  version,
  snapshot,
  onApply,
  onClose,
}: VersionApplyDialogProps) {
  // Intentional one-time capture: the revision is frozen at dialog-open time so
  // a concurrent edit is detected as a 409 conflict on submit, not silently
  // applied. It must NOT track later snapshot changes.
  // react-doctor-disable-next-line react-doctor/no-derived-useState
  const [expectedRevision] = useState(snapshot.document.revision);
  const [applying, setApplying] = useState(false);
  const [conflict, setConflict] = useState(false);
  const comparison = useMemo(() => {
    const current = snapshot.document.items;
    const currentSources = new Set(current.map((item) => item.source_clip_id));
    const proposedSources = new Set(version.items.map((item) => item.source_clip_id));
    const added = [...proposedSources].filter((id) => !currentSources.has(id));
    const removed = [...currentSources].filter((id) => !proposedSources.has(id));
    const changed = Math.max(current.length, version.items.length) - current.reduce(
      (same, item, index) => same + (samePlacement(item, version.items[index]) ? 1 : 0),
      0,
    );
    return {
      currentCount: current.length,
      proposedCount: version.items.length,
      currentDuration: duration(current),
      proposedDuration: duration(version.items),
      added,
      removed,
      changed,
    };
  }, [snapshot.document.items, version.items]);

  return (
    <div className="version-apply-backdrop" role="presentation">
      <section
        className="version-apply-dialog"
        // Custom modal matches the existing dark editor-console surface; a native
        // <dialog> migration is a separate design decision (see react-doctor-triage).
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-apply-title"
      >
        <div>
          <span className="draft-kicker">Apply complete cut</span>
          <h2 id="version-apply-title">Apply {version.title} to working timeline?</h2>
        </div>
        <dl className="version-apply-comparison">
          <div><dt>Items</dt><dd>{comparison.currentCount} current → {comparison.proposedCount} proposed</dd></div>
          <div><dt>Duration</dt><dd>{comparison.currentDuration.toFixed(1)}s current → {comparison.proposedDuration.toFixed(1)}s proposed</dd></div>
          <div><dt>Added sources</dt><dd>{comparison.added.join(', ') || 'None'}</dd></div>
          <div><dt>Removed sources</dt><dd>{comparison.removed.join(', ') || 'None'}</dd></div>
          <div><dt>Changed placements</dt><dd>{comparison.changed}</dd></div>
        </dl>
        <p className="version-apply-warning">
          Manual trims, order, speed, transforms, and other Working Timeline changes will be replaced.
        </p>
        {conflict ? (
          <p className="version-apply-conflict" role="alert">
            Working Timeline changed while this comparison was open. Review the updated comparison before applying.
          </p>
        ) : null}
        <div className="version-apply-actions">
          <button type="button" className="btn subtle" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={applying || conflict}
            onClick={() => {
              setApplying(true);
              void onApply(version, expectedRevision)
                .then(onClose)
                .catch(() => {
                  setConflict(true);
                  setApplying(false);
                });
            }}
          >
            {applying ? 'Applying…' : 'Apply to working timeline'}
          </button>
        </div>
      </section>
    </div>
  );
}
