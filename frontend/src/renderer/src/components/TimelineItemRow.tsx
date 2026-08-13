import type { TimelineItem } from '../api/client';
import { SourceAudioBadge, sourceAudioState } from './SourceAudioBadge';
import { useReview } from '../state/ReviewContext';

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function TimelineItemRow({
  item,
  index,
  total,
  name,
  fileId,
  apply,
}: {
  item: TimelineItem;
  index: number;
  total: number;
  name: string;
  fileId?: string;
  apply: (operation: string, args: Record<string, unknown>) => Promise<void>;
}) {
  const effective = round((item.end_sec - item.start_sec) / item.speed);
  const { uploadedVideos } = useReview();
  const sourceAudio = sourceAudioState(fileId, uploadedVideos);

  return (
    <li className="timeline-item-row" data-testid="timeline-item-row">
      <div className="timeline-item-head">
        <span className="pill-rank">#{index + 1}</span>
        <span className="timeline-item-name">{name}</span>
        <SourceAudioBadge hasAudio={sourceAudio.hasAudio} channels={sourceAudio.channels} />
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
