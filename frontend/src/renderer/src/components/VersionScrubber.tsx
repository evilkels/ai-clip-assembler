import { useMemo } from 'react';
import type { VersionItem } from '../types/version';

export interface VersionScrubberProps {
  items: VersionItem[];
  currentTimelineTimeSec: number;
  totalDurationSec: number;
  currentIndex: number;
  onSeek: (timelineTimeSec: number) => void;
}

const KEYBOARD_STEP_SEC = 1;

function effectiveDuration(item: VersionItem): number {
  const span = Math.max(0, item.end_sec - item.start_sec);
  return span / (item.speed ?? 1);
}

/** `M:SS.s` total-time format shared by the playhead and source readouts. */
function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/**
 * Segmented, read-only playback navigation for a complete Version. It maps
 * total Version (effective) time onto each clip's proportional band and seeks;
 * it never trims, reorders, or changes speed.
 */
export function VersionScrubber({
  items,
  currentTimelineTimeSec,
  totalDurationSec,
  currentIndex,
  onSeek,
}: VersionScrubberProps) {
  const { durations, starts } = useMemo(() => {
    const computed = items.map(effectiveDuration);
    const cumulative: number[] = [];
    let running = 0;
    for (const duration of computed) {
      cumulative.push(running);
      running += duration;
    }
    return { durations: computed, starts: cumulative };
  }, [items]);

  if (items.length === 0 || totalDurationSec <= 0) return null;

  const total = totalDurationSec;
  const current = Math.max(0, Math.min(currentTimelineTimeSec, total));
  const playheadPercent = (current / total) * 100;

  const activeIndex = Math.min(Math.max(currentIndex, 0), items.length - 1);
  const activeItem = items[activeIndex];
  const offsetIntoClip = Math.max(0, current - (starts[activeIndex] ?? 0));
  const sourceTimeSec = activeItem.start_sec + offsetIntoClip * (activeItem.speed ?? 1);

  const valueText = `${formatTimecode(current)} of ${formatTimecode(total)}`;

  return (
    <div className="version-scrubber" data-testid="version-scrubber">
      <div
        className="version-scrubber-track"
        // A segmented playback slider (clickable segments + playhead) has no
        // native HTML equivalent; the Review contract requires role="slider".
        // react-doctor-disable-next-line react-doctor/prefer-tag-over-role
        role="slider"
        tabIndex={0}
        aria-label="Version playback position"
        aria-valuemin={0}
        aria-valuemax={Number(total.toFixed(3))}
        aria-valuenow={Number(current.toFixed(3))}
        aria-valuetext={valueText}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          let next: number | null = null;
          if (event.key === 'ArrowRight') next = current + KEYBOARD_STEP_SEC;
          else if (event.key === 'ArrowLeft') next = current - KEYBOARD_STEP_SEC;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = total;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          onSeek(Math.max(0, Math.min(next, total)));
        }}
      >
        {items.map((item, index) => (
          <button
            key={`${item.source_clip_id}-${index}`}
            type="button"
            className={`version-scrubber-segment${index === activeIndex ? ' active' : ''}`}
            style={{ width: `${(durations[index] / total) * 100}%` }}
            aria-label={`Seek to clip ${index + 1}, ${item.file_name}`}
            onClick={(event) => {
              event.stopPropagation();
              onSeek(starts[index]);
            }}
          />
        ))}
        <div className="version-scrubber-playhead" style={{ left: `${playheadPercent}%` }} />
      </div>
      <div className="version-scrubber-readout">
        <span className="version-scrubber-time">{valueText.replace(' of ', ' / ')}</span>
        <span className="version-scrubber-position">
          clip {activeIndex + 1} of {items.length} · {activeItem.file_name}
        </span>
        <span className="version-scrubber-source">{formatTimecode(sourceTimeSec)}</span>
      </div>
    </div>
  );
}
