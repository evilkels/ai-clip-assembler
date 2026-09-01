import type { ReactNode } from 'react';

export type WorkflowFooterProps = {
  summary: ReactNode;
  detail?: ReactNode;
  secondaryActions?: ReactNode;
  primaryAction?: ReactNode;
};

/** Persistent workflow navigation and progress summary for the studio shell. */
export function WorkflowFooter({ summary, detail, secondaryActions, primaryAction }: WorkflowFooterProps) {
  return (
    <footer className="workflow-footer" data-surface="workflow-footer">
      <div className="workflow-footer-progress" aria-hidden="true">
        <span className="workflow-footer-progress-segment active" />
        <span className="workflow-footer-progress-segment" />
        <span className="workflow-footer-progress-segment" />
        <span className="workflow-footer-progress-segment" />
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
