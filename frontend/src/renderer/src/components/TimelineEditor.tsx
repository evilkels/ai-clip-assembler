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
import { TimelineItemControls, TimelineItemRow } from './TimelineItemRow';
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
  const selectedItem = selectedId ? timelineItems.find((item) => item.item_id === selectedId) : undefined;
  const selectedProjection = selectedItem ? projectionByItemId.get(selectedItem.item_id) : undefined;

  return (
    <aside className="timeline-editor" aria-label="Timeline inspector" data-testid="timeline-editor">
      <div className="timeline-editor-head">
        <strong>Inspector</strong>
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
      {selectedItem && selectedProjection ? (
        <div className="timeline-inspector" data-testid="timeline-inspector">
          <div className="timeline-inspector-heading">
            <span className="timeline-inspector-label">Selected item · #{timelineItems.indexOf(selectedItem) + 1}</span>
            <strong>{selectedProjection.fileName}</strong>
            <span className="timeline-inspector-source">{selectedProjection.sourceClipId}</span>
          </div>
          <TimelineItemControls
            key={`${selectedItem.item_id}:${selectedItem.start_sec}:${selectedItem.end_sec}:${selectedItem.speed}:${selectedItem.transform.scale}:${selectedItem.transform.x}:${selectedItem.transform.y}`}
            item={selectedItem}
            apply={applyTimelineOperation}
          />
          <div className="timeline-inspector-values">
            <span><b>Source</b> {selectedProjection.startSec.toFixed(1)} → {selectedProjection.endSec.toFixed(1)}s</span>
            <span><b>Timeline</b> {selectedProjection.durationSec.toFixed(1)}s</span>
            <span><b>Item</b> <code>{selectedItem.item_id}</code></span>
          </div>
          <div className="timeline-inspector-actions">
            <button
              type="button"
              className="btn subtle"
              onClick={() => void applyTimelineOperation('remove_item', { item_id: selectedItem.item_id })}
              data-testid="timeline-inspector-remove"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="timeline-inspector timeline-inspector-empty" data-testid="timeline-inspector-empty">
          <span className="timeline-inspector-label">Selected item</span>
          <span>Select a clip or item row to edit its bounds, speed, and transform.</span>
        </div>
      )}
      {timelineItems.length === 0 ? (
        <p className="draft-summary">Accept candidate clips to start building the timeline.</p>
      ) : (
        <div className="timeline-items-table" data-testid="timeline-items-table">
          <span className="timeline-inspector-label">All items</span>
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
                showControls={false}
              />
            ))}
          </ol>
        </div>
      )}
    </aside>
  );
}
