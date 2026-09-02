import type { ReactNode } from 'react';

export type WorkflowFooterProps = {
  summary: ReactNode;
  detail?: ReactNode;
  secondaryActions?: ReactNode;
  primaryAction?: ReactNode;
  currentStep?: 1 | 2 | 3 | 4;
};

/** Persistent workflow navigation and progress summary for the studio shell. */
export function WorkflowFooter({ summary, detail, secondaryActions, primaryAction, currentStep = 1 }: WorkflowFooterProps) {
  return (
    <footer className="workflow-footer" data-surface="workflow-footer">
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
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className="workflow-footer-actions">
        {secondaryActions}
        {primaryAction}
      </div>
    </footer>
  );
}
