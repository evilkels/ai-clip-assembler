import { useCallback, type KeyboardEvent, type PointerEvent } from 'react';

interface ResizeHandleProps {
  /** Called with the horizontal pointer movement (px) as the handle is dragged. */
  onResize: (deltaX: number) => void;
  ariaLabel: string;
  className?: string;
  /** Pixels moved per arrow-key press for keyboard resizing. */
  keyboardStep?: number;
}

/**
 * A thin vertical divider that resizes the panel to its left. Works in both
 * flex and grid layouts (it lays out as a fixed-width column/child) and reports
 * drag distance to the parent via `onResize`. Pointer capture keeps the drag
 * tracking even when the cursor moves fast outside the handle.
 */
export function ResizeHandle({ onResize, ariaLabel, className, keyboardStep = 16 }: ResizeHandleProps) {
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      let lastX = event.clientX;
      target.setPointerCapture(event.pointerId);

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        onResize(moveEvent.clientX - lastX);
        lastX = moveEvent.clientX;
      };
      const stop = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', stop);
        target.removeEventListener('pointercancel', stop);
      };
      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', stop);
      target.addEventListener('pointercancel', stop);
    },
    [onResize],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onResize(-keyboardStep);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onResize(keyboardStep);
      }
    },
    [onResize, keyboardStep],
  );

  return (
    <div
      className={`resize-handle${className ? ` ${className}` : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
