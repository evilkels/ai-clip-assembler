import { useMemo } from 'react';
import { useReview } from '../state/ReviewContext';
import type { ClipCandidate } from '../types/clip';

export function ExportPage() {
  const { clips, acceptedOrder } = useReview();

  const acceptedClips = useMemo(
    () => {
      const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));
      return acceptedOrder
        .map((id) => clipsById.get(id))
        .filter((c): c is ClipCandidate => Boolean(c));
    },
    [acceptedOrder, clips],
  );

  const totalDuration = acceptedClips.reduce(
    (sum, c) => sum + (c.end_sec - c.start_sec),
    0,
  );

  const exportPayload = {
    timeline: acceptedClips.map((c, idx) => ({
      order: idx + 1,
      clip_id: c.clip_id,
      file_id: c.file_id,
      file_name: c.file_name,
      start_sec: c.start_sec,
      end_sec: c.end_sec,
    })),
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Export</h1>
          <p>
            {acceptedClips.length} clip{acceptedClips.length === 1 ? '' : 's'} accepted ·{' '}
            {totalDuration.toFixed(1)}s total. FCPXML / EDL writers land with backend export.
          </p>
        </div>
        <button className="btn primary" disabled>
          Export FCPXML (coming soon)
        </button>
      </div>
      <div className="page-body">
        {acceptedClips.length === 0 ? (
          <div className="empty-state">
            No clips accepted yet. Pick keepers on the Review tab.
          </div>
        ) : (
          <pre
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              overflow: 'auto',
              userSelect: 'text',
            }}
          >
            {JSON.stringify(exportPayload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
