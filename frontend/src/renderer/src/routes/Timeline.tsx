import { useEffect, useState } from 'react';
import { Timeline } from '../components/Timeline';
import { TimelineEditor } from '../components/TimelineEditor';
import { useReview } from '../state/ReviewContext';
import { effectiveTimelineDuration } from '../lib/timelineProjection';
import { WorkflowHeader } from '../components/WorkflowHeader';

export function TimelinePage() {
  const { timelineItems, undo, redo } = useReview();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const totalDuration = effectiveTimelineDuration(timelineItems);

  useEffect(() => {
    if (selectedItemId && !timelineItems.some((item) => item.item_id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [selectedItemId, timelineItems]);

  return (
    <div className="page timeline-page">
      <WorkflowHeader
        title="Timeline"
        step="Step 03 / 04"
        description="Reorder Timeline Items, trim source bounds, and scrub the speed-aware sequence before export."
        actions={(
          <div className="timeline-header-actions" data-testid="timeline-header-actions">
            <button type="button" className="btn subtle" onClick={() => void undo()} data-testid="timeline-undo">
              Undo
            </button>
            <button type="button" className="btn subtle" onClick={() => void redo()} data-testid="timeline-redo">
              Redo
            </button>
            <span className="timeline-header-runtime" data-testid="timeline-summary">
              {timelineItems.length} item{timelineItems.length === 1 ? '' : 's'} ·{' '}
              {totalDuration.toFixed(1)}s
            </span>
          </div>
        )}
      />
      <div className="page-body timeline-page-body" data-testid="timeline-workspace">
        <Timeline selectedId={selectedItemId} onSelectedItemChange={setSelectedItemId} />
        <TimelineEditor selectedId={selectedItemId} onSelectedItemChange={setSelectedItemId} />
      </div>
    </div>
  );
}
