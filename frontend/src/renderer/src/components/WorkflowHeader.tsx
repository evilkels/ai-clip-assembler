import type { ReactNode } from 'react';

export type WorkflowHeaderProps = {
  title: string;
  step: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

/** Shared route heading used by the studio workflows. */
export function WorkflowHeader({ title, step, description, actions, meta }: WorkflowHeaderProps) {
  return (
    <header className="workflow-header" data-surface="workflow-header">
      <div className="workflow-header-copy">
        <div className="workflow-header-title">
          <h1>{title}</h1>
          <span className="workflow-header-step">{step}</span>
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {meta ? <div className="workflow-header-meta">{meta}</div> : null}
      {actions ? <div className="workflow-header-actions">{actions}</div> : null}
    </header>
  );
}
