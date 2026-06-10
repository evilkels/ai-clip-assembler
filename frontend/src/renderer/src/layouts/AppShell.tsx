import { useEffect, type ReactNode } from 'react';
import { setWindowTitle } from '../api/client';
import { useReview } from '../state/ReviewContext';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { projectName } = useReview();

  useEffect(() => {
    setWindowTitle(projectName ?? undefined).catch(() => {});
  }, [projectName]);

  return (
    <div className="app-shell">
      <div className="app-workspace">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
