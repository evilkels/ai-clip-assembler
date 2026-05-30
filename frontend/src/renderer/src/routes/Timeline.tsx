import { useMemo } from 'react';
import { Timeline } from '../components/Timeline';
import { useReview } from '../state/ReviewContext';

export function TimelinePage() {
  const { acceptedOrder, clips, trims } = useReview();

  const totalDuration = useMemo(() => {
    const byId = new Map(clips.map((clip) => [clip.clip_id, clip]));
    return acceptedOrder.reduce((sum, id) => {
      const clip = byId.get(id);
      if (!clip) return sum;
      const trim = trims[id];
      const start = trim?.start_sec ?? clip.start_sec;
      const end = trim?.end_sec ?? clip.end_sec;
      return sum + Math.max(0, end - start);
    }, 0);
  }, [acceptedOrder, clips, trims]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Timeline</h1>
          <p>Reorder, trim, and scrub the assembled sequence before export.</p>
        </div>
        <div className="controls">
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {acceptedOrder.length} clip{acceptedOrder.length === 1 ? '' : 's'} ·{' '}
            {totalDuration.toFixed(1)}s
          </span>
        </div>
      </div>
      <div className="page-body">
        <Timeline />
      </div>
    </div>
  );
}
