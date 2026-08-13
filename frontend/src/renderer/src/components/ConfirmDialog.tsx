import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small yes/no gate for actions worth a second thought. Cancel holds initial
 * focus so Return never confirms by accident.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="confirm-dialog"
        // Matches the existing custom modal surface (see VersionApplyDialog); a
        // native <dialog> migration is a separate design decision.
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        {/* A div, not a <p>: `body` is a ReactNode, and block content inside a
            paragraph is invalid nesting. */}
        <div className="confirm-dialog-body">{body}</div>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn subtle" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'btn destructive' : 'btn primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
