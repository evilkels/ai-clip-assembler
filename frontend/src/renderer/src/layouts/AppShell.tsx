import { useEffect, type ReactNode } from 'react';
import { setWindowTitle } from '../api/client';
import { useReview } from '../state/ReviewContext';
import { ResizeHandle } from '../components/ResizeHandle';
import { usePanelWidth } from '../hooks/usePanelWidth';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { projectName } = useReview();
  const [sidebarWidth, resizeSidebar] = usePanelWidth('sidebarWidth', 232, 180, 420);

  useEffect(() => {
    setWindowTitle(projectName ?? undefined).catch(() => {});
  }, [projectName]);

  return (
    <div className="app-shell">
      <div
        className="app-workspace"
        style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}
      >
        <Sidebar />
        <ResizeHandle ariaLabel="Resize the side panel" onResize={resizeSidebar} />
        <main className="main">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
