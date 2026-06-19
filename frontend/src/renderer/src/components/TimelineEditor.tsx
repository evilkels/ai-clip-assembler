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
import type { TimelineItem } from '../api/client';

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function TimelineEditor() {
  const { projectId, timelineItems, clips, applyTimelineOperation, undo, redo } = useReview();

  if (!projectId) return null;

  const nameByClip = new Map(clips.map((clip) => [clip.clip_id, clip.file_name]));

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
              apply={applyTimelineOperation}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineItemRow({
  item,
  index,
  total,
  name,
  apply,
}: {
  item: TimelineItem;
  index: number;
  total: number;
  name: string;
  apply: (operation: string, args: Record<string, unknown>) => Promise<void>;
}) {
  const effective = round((item.end_sec - item.start_sec) / item.speed);

  return (
    <li className="timeline-item-row" data-testid="timeline-item-row">
      <div className="timeline-item-head">
        <span className="pill-rank">#{index + 1}</span>
        <span className="timeline-item-name">{name}</span>
        <span className="draft-summary">{effective}s on timeline</span>
        <div className="timeline-item-order">
          <button
            type="button"
            className="btn subtle"
            disabled={index === 0}
            onClick={() => void apply('reorder', { item_id: item.item_id, to_index: index - 1 })}
            aria-label="Move earlier"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn subtle"
            disabled={index === total - 1}
            onClick={() => void apply('reorder', { item_id: item.item_id, to_index: index + 1 })}
            aria-label="Move later"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn subtle"
            onClick={() => void apply('remove_item', { item_id: item.item_id })}
            aria-label="Remove item"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="timeline-item-controls">
        {/* Extend / trim within the source video (clamped backend-side). */}
        <label>
          In
          <input
            type="number"
            step="0.1"
            defaultValue={item.start_sec}
            data-testid="item-start"
            onBlur={(event) =>
              void apply('set_bounds', {
                item_id: item.item_id,
                start_sec: Number(event.target.value),
                end_sec: item.end_sec,
              })
            }
          />
        </label>
        <label>
          Out
          <input
            type="number"
            step="0.1"
            defaultValue={item.end_sec}
            data-testid="item-end"
            onBlur={(event) =>
              void apply('set_bounds', {
                item_id: item.item_id,
                start_sec: item.start_sec,
                end_sec: Number(event.target.value),
              })
            }
          />
        </label>

        {/* Speed (retime). */}
        <label>
          Speed
          <input
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={item.speed}
            data-testid="item-speed"
            onBlur={(event) =>
              void apply('set_speed', { item_id: item.item_id, speed: Number(event.target.value) })
            }
          />
        </label>

        {/* Transform — digital zoom/pan. */}
        <label>
          Zoom
          <input
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={item.transform.scale}
            data-testid="item-zoom"
            onBlur={(event) =>
              void apply('set_transform', {
                item_id: item.item_id,
                transform: { scale: Number(event.target.value), x: item.transform.x, y: item.transform.y },
              })
            }
          />
        </label>

        {/* Split at a source timestamp (defaults to the midpoint). */}
        <button
          type="button"
          className="btn subtle"
          data-testid="item-split"
          onClick={() =>
            void apply('split_item', {
              item_id: item.item_id,
              at_sec: round((item.start_sec + item.end_sec) / 2),
            })
          }
        >
          Split
        </button>
      </div>
    </li>
  );
}
