import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface WorkflowFooterProps {
  currentStep?: 1 | 2 | 3 | 4;
  summary: ReactNode;
  detail?: ReactNode;
  /** Amber when a warning notice is riding along with an allowed step. */
  detailTone?: 'muted' | 'warning';
  /** Mono meta beside the actions, e.g. `RUNS IN BACKGROUND`. */
  hint?: string;
  secondaryActions?: ReactNode;
  /** The step's one primary action. Absent on the last step. */
  primary?: { label: string; to: string };
  /**
   * Set when the step is gated. The primary goes dashed and disabled, its
   * reason sits beside it, and the accent moves to `unblock`.
   */
  blockedReason?: string;
  /** The action that unblocks a blocked step — the bar's one solid accent. */
  unblock?: ReactNode;
}

/** Persistent workflow navigation and progress summary for the studio shell. */
export function WorkflowFooter({
  currentStep = 1,
  summary,
  detail,
  detailTone = 'muted',
  hint,
  secondaryActions,
  primary,
  blockedReason,
  unblock,
}: WorkflowFooterProps) {
  const blocked = blockedReason !== undefined;
  return (
    <footer className="workflow-footer" data-surface="workflow-footer" data-gate={blocked ? 'blocked' : 'allowed'}>
      <div className="workflow-footer-progress" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            className={`workflow-footer-progress-segment${step < currentStep ? ' complete' : step === currentStep ? ' active' : ''}`}
            key={step}
          />
        ))}
      </div>
      <div className="workflow-footer-copy">
        <strong>{summary}</strong>
        {detail ? <span data-tone={detailTone}>{detail}</span> : null}
      </div>
      <div className="workflow-footer-actions">
        {hint ? <span className="workflow-footer-hint">{hint}</span> : null}
        {blocked ? (
          <span className="workflow-footer-gate" role="status">
            <span className="workflow-footer-gate-label">Blocked</span>
            <span className="workflow-footer-gate-reason">{blockedReason}</span>
          </span>
        ) : null}
        {secondaryActions}
        {unblock}
        {primary ? (
          blocked ? (
            // A blocked primary stays visible and carries its reason, rather
            // than disappearing or failing after the click.
            <button type="button" className="btn blocked" disabled>
              {primary.label}
            </button>
          ) : (
            <Link className="btn primary" to={primary.to}>
              {primary.label}
            </Link>
          )
        ) : null}
      </div>
    </footer>
  );
}
