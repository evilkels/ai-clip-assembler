/**
 * Timeline editor (A2.4) — the editor-facing surface for the operations core.
 *
 * Renders the authoritative Timeline Items and drives split / extend (set
 * bounds) / speed / transform (digital zoom-pan) / reorder / remove through the
 * same backend operations the GUI review actions and agents use. Every change
 * is undoable. State comes from `ReviewContext` (document-authoritative), so an
 * agent's edit appears here live too.
 */
import { useReview } from '../state/ReviewContext';
import { TimelineItemRow } from './TimelineItemRow';
import { projectTimelineItems } from '../lib/timelineProjection';

export function TimelineEditor({
  selectedId,
  onSelectedItemChange,
}: {
  selectedId?: string | null;
  onSelectedItemChange?: (itemId: string | null) => void;
} = {}) {
  const { projectId, timelineItems, clips, applyTimelineOperation, undo, redo } = useReview();

  if (!projectId) return null;

  const projectedItems = projectTimelineItems(timelineItems, clips);
  const projectionByItemId = new Map(projectedItems.map((item) => [item.itemId, item]));
  const fileByClip = new Map(clips.map((clip) => [clip.clip_id, clip.file_id]));

  return (
    <section className="timeline-editor" aria-label="Timeline editor" data-testid="timeline-editor">
      <div className="timeline-editor-head">
        <strong>Timeline editor</strong>
        <span className="draft-summary">{timelineItems.length} item(s)</span>
        <div className="timeline-editor-tools">
          <button type="button" className="btn subtle" onClick={() => void undo()} data-testid="timeline-undo">
            Undo
          </button>
          <button type="button" className="btn subtle" onClick={() => void redo()} data-testid="timeline-redo">
            Redo
          </button>
        </div>
      </div>
      {selectedId && projectionByItemId.has(selectedId) ? (
        <div className="timeline-inspector" data-testid="timeline-inspector">
          <div>
            <span className="timeline-inspector-label">Selected item</span>
            <strong>{projectionByItemId.get(selectedId)?.fileName}</strong>
          </div>
          <div className="timeline-inspector-values">
            <span><b>In</b> {projectionByItemId.get(selectedId)?.startSec.toFixed(1)}s</span>
            <span><b>Out</b> {projectionByItemId.get(selectedId)?.endSec.toFixed(1)}s</span>
            <span><b>Speed</b> {projectionByItemId.get(selectedId)?.speed.toFixed(1)}×</span>
            <span><b>Runtime</b> {projectionByItemId.get(selectedId)?.durationSec.toFixed(1)}s</span>
            <span><b>Item</b> <code>{selectedId}</code></span>
          </div>
        </div>
      ) : null}
      {timelineItems.length === 0 ? (
        <p className="draft-summary">Accept candidate clips to start building the timeline.</p>
      ) : (
        <ol className="timeline-editor-list">
          {timelineItems.map((item, index) => (
            <TimelineItemRow
              // Remount the row when the item changes so uncontrolled inputs
              // reflect the latest authoritative values.
              key={`${item.item_id}:${item.start_sec}:${item.end_sec}:${item.speed}:${item.transform.scale}:${item.transform.x}:${item.transform.y}`}
              item={item}
              index={index}
              total={timelineItems.length}
              name={projectionByItemId.get(item.item_id)?.fileName ?? item.source_clip_id}
              fileId={fileByClip.get(item.source_clip_id)}
              durationSec={projectionByItemId.get(item.item_id)?.durationSec ?? 0}
              selected={item.item_id === selectedId}
              onSelect={() => onSelectedItemChange?.(item.item_id)}
              apply={applyTimelineOperation}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
