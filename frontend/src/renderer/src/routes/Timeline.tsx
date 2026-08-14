import { useEffect, useState } from 'react';
import { Timeline } from '../components/Timeline';
import { TimelineEditor } from '../components/TimelineEditor';
import { useReview } from '../state/ReviewContext';
import { effectiveTimelineDuration } from '../lib/timelineProjection';

export function TimelinePage() {
  const { timelineItems } = useReview();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const totalDuration = effectiveTimelineDuration(timelineItems);

  useEffect(() => {
    if (selectedItemId && !timelineItems.some((item) => item.item_id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, timelineItems]);

  return (
    <div className="page timeline-page">
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
      <div className="page-body timeline-page-body">
        <Timeline selectedId={selectedItemId} onSelectedItemChange={setSelectedItemId} />
        <TimelineEditor selectedId={selectedItemId} onSelectedItemChange={setSelectedItemId} />
      </div>
    </div>
  );
}
