import type { ReactNode } from 'react';

export type StatusSurfaceTone = 'accent' | 'success' | 'warning' | 'danger';

export type StatusSurfaceProps = {
  tone: StatusSurfaceTone;
  className?: string;
  'data-testid'?: string;
  children: ReactNode;
};

export function StatusSurface({ tone, className, 'data-testid': testId, children }: StatusSurfaceProps) {
  const classes = ['status-surface', `status-surface-${tone}`, className].filter(Boolean).join(' ');
  return (
    <div className={classes} data-tone={tone} data-testid={testId}>
      {children}
    </div>
  );
}
