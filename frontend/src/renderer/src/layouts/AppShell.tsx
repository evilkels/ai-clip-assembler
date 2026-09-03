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
import { WorkflowFooter, type WorkflowFooterProps } from '../components/WorkflowFooter';
import { effectiveTimelineDuration } from '../lib/timelineProjection';
import { useGateActions } from '../state/StepGateContext';
import {
  importGate,
  reviewGate,
  ridingWarning,
  thresholdSummary,
  timelineGate,
  type StepGate,
} from '../lib/stepGate';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const {
    projectName,
    uploadedVideos,
    clips,
    acceptedCount,
    timelineItems,
    analysisStatus,
    generationStats,
  } = useReview();
  const location = useLocation();
  const gateActions = useGateActions();
  const [sidebarWidth, resizeSidebar] = usePanelWidth('sidebarWidth', 264, 180, 420);
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

  /**
   * Render the action that unblocks a blocked step as the bar's one solid
   * accent. A route-owned action reaches us through StepGateContext; a step
   * back the shell can navigate itself.
   */
  const unblockNode = (gate: StepGate) => {
    if (gate.unblockTo) {
      return (
        <Link className="btn primary" to={gate.unblockTo.to}>
          {gate.unblockTo.label}
        </Link>
      );
    }
    const action = gate.unblock ? gateActions[gate.unblock] : undefined;
    if (!action) return null;
    return (
      <button type="button" className="btn primary" onClick={action.run} disabled={action.inert}>
        {action.label}
      </button>
    );
  };

  /** Compose the gate into the props the footer renders. */
  const gated = (gate: StepGate, props: WorkflowFooterProps): WorkflowFooterProps =>
    gate.allowed
      ? props
      : {
          ...props,
          blockedReason: gate.reason,
          unblock: unblockNode(gate),
          // The unblock replaces the step-back secondary rather than sitting
          // beside a second copy of it.
          secondaryActions: gate.unblockTo ? null : props.secondaryActions,
        };

  const footer = ((): WorkflowFooterProps | null => {
    switch (location.pathname) {
      case '/review': {
        const gate = reviewGate(acceptedCount);
        return gated(gate, {
          currentStep: 2,
          summary: `${acceptedCount} clips kept`,
          detail: `${clips.length} candidates · next: arrange & trim in Timeline`,
          secondaryActions: <Link className="btn subtle" to="/import">Back to Import</Link>,
          primary: { label: 'Continue to Timeline →', to: '/timeline' },
        });
      }
      case '/timeline': {
        const gate = timelineGate(timelineItems.length);
        return gated(gate, {
          currentStep: 3,
          summary: `${timelineItems.length} item${timelineItems.length === 1 ? '' : 's'} · ${effectiveTimelineDuration(timelineItems).toFixed(1)}s`,
          detail: 'next: export FCPXML, Resolve XML or EDL',
          secondaryActions: <Link className="btn subtle" to="/review">Back to Review</Link>,
          primary: { label: 'Continue to Export →', to: '/export' },
        });
      }
      case '/export':
        return {
          currentStep: 4,
          summary: `${timelineItems.length} item${timelineItems.length === 1 ? '' : 's'} ready to export`,
          detail: 'Choose a format, then create your handoff',
          secondaryActions: <Link className="btn subtle" to="/timeline">Back to Timeline</Link>,
        };
      case '/import': {
        const phase = analysisStatus.phase;
        const gate = importGate({
          sourceCount: uploadedVideos.length,
          clipCount: clips.length,
          phase,
        });
        const warning = gate.allowed ? ridingWarning(analysisStatus.notices) : null;
        const thresholds = gate.unblock === 'loosen-rules' ? thresholdSummary(generationStats) : null;
        return gated(gate, {
          currentStep: 1,
          summary: uploadedVideos.length > 0 ? `${uploadedVideos.length} sources loaded` : 'Import footage to begin',
          detail: warning?.message ?? thresholds ?? 'next: pick the keepers in Review',
          detailTone: warning ? 'warning' : 'muted',
          // Partial results are usable, so the step stays crossable while the
          // rest of the analysis is still running.
          hint: phase === 'analyzing' ? 'Runs in background' : undefined,
          secondaryActions: null,
          primary: { label: 'Continue to Review →', to: '/review' },
        });
      }
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
