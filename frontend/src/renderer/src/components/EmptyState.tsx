import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  hint?: string;
  /** Optional call-to-action button that navigates to another step. */
  actionLabel?: string;
  actionTo?: string;
};

/**
 * A calm, consistent placeholder for screens that have no content yet.
 * Shows an icon, a friendly headline, a short hint, and an optional button
 * that points the user at the step they need to do next.
 */
export function EmptyState({ icon, title, hint, actionLabel, actionTo }: EmptyStateProps) {
  const navigate = useNavigate();
  return (
    <div className="empty-state">
      {icon ? (
        <div className="empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="empty-state-title">{title}</p>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {actionLabel && actionTo ? (
        <button type="button" className="btn primary" onClick={() => navigate(actionTo)}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
