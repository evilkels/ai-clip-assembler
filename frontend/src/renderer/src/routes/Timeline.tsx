import { useMemo } from 'react';
import { Timeline } from '../components/Timeline';
import { TimelineEditor } from '../components/TimelineEditor';
import { useReview } from '../state/ReviewContext';

export function TimelinePage() {
  const { timelineItems } = useReview();

  const totalDuration = useMemo(() => {
    return timelineItems.reduce(
      (sum, item) => sum + Math.max(0, (item.end_sec - item.start_sec) / item.speed),
      0,
    );
  }, [timelineItems]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Timeline</h1>
          <p>Reorder Timeline Items, trim source bounds, and scrub the speed-aware sequence before export.</p>
        </div>
        <div className="controls">
          <span data-testid="timeline-summary" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {timelineItems.length} item{timelineItems.length === 1 ? '' : 's'} ·{' '}
            {totalDuration.toFixed(1)}s
          </span>
        </div>
      </div>
      <div className="page-body">
        <Timeline />
        <TimelineEditor />
      </div>
    </div>
  );
}
