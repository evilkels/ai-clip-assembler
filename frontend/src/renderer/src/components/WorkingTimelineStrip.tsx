import { useState } from 'react';
import { useReview } from '../state/ReviewContext';

export function WorkingTimelineStrip() {
  const { applyTimelineOperation, clips, timelineItems } = useReview();
  const [expanded, setExpanded] = useState(true);
  const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));

  return (
    <details
      className="working-timeline"
      data-testid="working-timeline-strip"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="review-zone-label">4 · Commit</span>
        <strong>Working Timeline · authoritative · sent to export</strong>
        <span className="draft-summary">
          {timelineItems.length} item{timelineItems.length === 1 ? '' : 's'}
        </span>
      </summary>
      {timelineItems.length === 0 ? (
        <p className="working-timeline-empty">Add Source Clips or apply a Version to build the Working Timeline.</p>
      ) : (
        <div className="working-timeline-list">
          {timelineItems.map((item, index) => {
            const clip = clipsById.get(item.source_clip_id);
            const effectiveDuration = (item.end_sec - item.start_sec) / item.speed;
            return (
              <article
                key={item.item_id}
                className="working-timeline-item"
                data-testid="working-timeline-item"
              >
                <div className="working-timeline-frame">
                  {clip?.thumbnail_url ? (
                    <img src={clip.thumbnail_url} alt="" />
                  ) : (
                    <span>#{index + 1}</span>
                  )}
                </div>
                <div className="working-timeline-copy">
                  <strong>#{index + 1} {clip?.file_name ?? item.source_clip_id}</strong>
                  <span>{effectiveDuration.toFixed(1)}s · {item.speed}×</span>
                </div>
                <div className="working-timeline-actions">
                  <button
                    type="button"
                    className="btn subtle"
                    disabled={index === 0}
                    aria-label={`Move item ${index + 1} earlier`}
                    onClick={() =>
                      void applyTimelineOperation('reorder', {
                        item_id: item.item_id,
                        to_index: index - 1,
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn subtle"
                    disabled={index === timelineItems.length - 1}
                    aria-label={`Move item ${index + 1} later`}
                    onClick={() =>
                      void applyTimelineOperation('reorder', {
                        item_id: item.item_id,
                        to_index: index + 1,
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn subtle"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() =>
                      void applyTimelineOperation('remove_item', { item_id: item.item_id })
                    }
                  >
                    ✕
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </details>
  );
}
