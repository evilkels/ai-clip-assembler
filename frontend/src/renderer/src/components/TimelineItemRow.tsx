import type { TimelineItem } from '../api/client';
import { SourceAudioBadge } from './SourceAudioBadge';
import { sourceAudioState } from '../lib/sourceAudio';
import { useReview } from '../state/ReviewContext';

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

type TimelineItemControlsProps = {
  item: TimelineItem;
  apply: (operation: string, args: Record<string, unknown>) => Promise<void>;
};

/** Controls for the selected item inspector. Keep every mutation keyed by item_id. */
export function TimelineItemControls({ item, apply }: TimelineItemControlsProps) {
  return (
    <div className="timeline-item-controls">
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
  );
}

export function TimelineItemRow({
  item,
  index,
  total,
  name,
  fileId,
  durationSec,
  selected,
  onSelect,
  apply,
  showControls = true,
}: {
  item: TimelineItem;
  index: number;
  total: number;
  name: string;
  fileId?: string;
  durationSec: number;
  selected?: boolean;
  onSelect?: () => void;
  apply: (operation: string, args: Record<string, unknown>) => Promise<void>;
  showControls?: boolean;
}) {
  const effective = round(durationSec);
  const { uploadedVideos } = useReview();
  const sourceAudio = sourceAudioState(fileId, uploadedVideos);

  return (
    <li
      className={`timeline-item-row${selected ? ' selected' : ''}`}
      data-testid="timeline-item-row"
      data-timeline-editor-item-id={item.item_id}
    >
      <div className="timeline-item-head">
        <button
          type="button"
          className="timeline-item-select"
          aria-label={`Select ${name}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          <span aria-hidden="true">{selected ? '●' : '○'}</span>
        </button>
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

      {showControls ? <TimelineItemControls item={item} apply={apply} /> : null}
    </li>
  );
}
