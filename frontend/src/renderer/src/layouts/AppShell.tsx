import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { setWindowTitle } from '../api/client';
import { useReview } from '../state/ReviewContext';
import { ResizeHandle } from '../components/ResizeHandle';
import { UpdateBanner } from '../components/UpdateBanner';
import { usePanelWidth } from '../hooks/usePanelWidth';
import { Sidebar } from './Sidebar';
import { ProjectHeader } from './ProjectHeader';
import { StatusBar } from './StatusBar';
import { WorkflowFooter } from '../components/WorkflowFooter';
import { effectiveTimelineDuration } from '../lib/timelineProjection';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { projectName, uploadedVideos, clips, acceptedCount, timelineItems } = useReview();
  const location = useLocation();
  const [sidebarWidth, resizeSidebar] = usePanelWidth('sidebarWidth', 232, 180, 420);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setWindowTitle(projectName ?? undefined).catch(() => {});
  }, [projectName]);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem('sidebarCollapsed', String(next));
      } catch {
        // Persisting the layout is best-effort.
      }
      return next;
    });
  };

  const footer = (() => {
    switch (location.pathname) {
      case '/review':
        return {
          currentStep: 2 as const,
          summary: `${acceptedCount} clips kept`,
          detail: `${clips.length} candidates · next: arrange & trim in Timeline`,
          secondaryActions: <Link className="btn subtle" to="/import">Back to Import</Link>,
          primaryAction: <Link className="btn primary" to="/timeline">Continue to Timeline →</Link>,
        };
      case '/timeline':
        return {
          currentStep: 3 as const,
          summary: `${timelineItems.length} item${timelineItems.length === 1 ? '' : 's'} · ${effectiveTimelineDuration(timelineItems).toFixed(1)}s`,
          detail: 'next: export FCPXML, Resolve XML or EDL',
          secondaryActions: <Link className="btn subtle" to="/review">Back to Review</Link>,
          primaryAction: <Link className="btn primary" to="/export">Continue to Export →</Link>,
        };
      case '/export':
        return {
          currentStep: 4 as const,
          summary: `${timelineItems.length} item${timelineItems.length === 1 ? '' : 's'} ready to export`,
          detail: 'Choose a format, then create your handoff',
          secondaryActions: <Link className="btn subtle" to="/timeline">Back to Timeline</Link>,
        };
      case '/import':
        return {
          currentStep: 1 as const,
          summary: uploadedVideos.length > 0 ? `${uploadedVideos.length} sources loaded` : 'Import footage to begin',
          detail: 'next: pick the keepers in Review',
          secondaryActions: null,
          primaryAction: <Link className="btn primary" to="/review">Continue to Review →</Link>,
        };
      default:
        return null;
    }
  })();

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`} data-shell="studio" data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'} style={{ '--sidebar-width': `${sidebarCollapsed ? 64 : sidebarWidth}px` } as CSSProperties}>
      <ProjectHeader />
      {/* Always-present grid row so the shell keeps its layout when empty. */}
      <div className="app-banners">
        <UpdateBanner />
      </div>
      <div
        className="app-workspace"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? 64 : sidebarWidth}px 6px minmax(0, 1fr)` }}
      >
        <Sidebar collapsed={sidebarCollapsed} />
        <ResizeHandle ariaLabel="Resize the side panel" onResize={resizeSidebar} />
        <button
          className="sidebar-collapse-toggle"
          type="button"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          style={{ left: `${(sidebarCollapsed ? 64 : sidebarWidth) - 14}px` }}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>
        <main className="main">{children}</main>
      </div>
      {footer ? <WorkflowFooter {...footer} /> : null}
      <StatusBar />
    </div>
  );
}
