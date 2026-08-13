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

export function TimelineEditor() {
  const { projectId, timelineItems, clips, applyTimelineOperation, undo, redo } = useReview();

  if (!projectId) return null;

  const nameByClip = new Map(clips.map((clip) => [clip.clip_id, clip.file_name]));
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
              name={nameByClip.get(item.source_clip_id) ?? item.source_clip_id}
              fileId={fileByClip.get(item.source_clip_id)}
              apply={applyTimelineOperation}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
