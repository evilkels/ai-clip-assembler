import { useCallback, useState } from 'react';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A persisted, draggable panel width.
 *
 * Returns the current width plus a `resizeBy(delta)` callback that a resize
 * handle calls with horizontal pointer movement. The value is clamped to
 * [min, max] and mirrored to localStorage so the layout survives reloads.
 */
export function usePanelWidth(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
): readonly [number, (delta: number) => void] {
  const [width, setWidth] = useState(() => {
    if (typeof localStorage === 'undefined') return defaultWidth;
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, min, max) : defaultWidth;
  });

  const resizeBy = useCallback(
    (delta: number) => {
      setWidth((current) => {
        const next = clamp(current + delta, min, max);
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          // Persisting the layout is best-effort; ignore storage failures.
        }
        return next;
      });
    },
    [storageKey, min, max],
  );

  return [width, resizeBy] as const;
}
