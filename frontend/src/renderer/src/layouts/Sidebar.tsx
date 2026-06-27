import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { selectProjectFolder } from '../api/client';
import { useReview } from '../state/ReviewContext';
import { SettingsModal, type SettingsTab } from '../components/SettingsModal';

const ImportIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
const ReviewIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);
const TimelineIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="7" height="5" rx="1" />
    <rect x="14" y="6" width="7" height="5" rx="1" />
    <rect x="3" y="14" width="11" height="5" rx="1" />
  </svg>
);
const ExportIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 20h14" />
  </svg>
);

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5L20 6" />
  </svg>
);

type WorkflowStep = {
  to: string;
  label: string;
  hint: string;
  icon: ReactNode;
};

const steps: WorkflowStep[] = [
  { to: '/import', label: 'Import', hint: 'Add your footage', icon: ImportIcon },
  { to: '/review', label: 'Review', hint: 'Pick the best clips', icon: ReviewIcon },
  { to: '/timeline', label: 'Timeline', hint: 'Arrange & trim', icon: TimelineIcon },
  { to: '/export', label: 'Export', hint: 'Save your video', icon: ExportIcon },
];

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function Sidebar() {
  const {
    projectFolder,
    projectName,
    recentProjects,
    loading,
    openProjectFolder,
    createUploadProject,
    removeRecent,
    relocateRecent,
    uploadedVideos,
    acceptedCount,
    timelineItems,
  } = useReview();
  const [error, setError] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);

  // Which workflow steps already have work in them — drives the progress ticks.
  const stepDone: Record<string, boolean> = {
    '/import': uploadedVideos.length > 0,
    '/review': acceptedCount > 0,
    '/timeline': timelineItems.length > 0,
    '/export': false,
  };

  const openFolder = async () => {
    setError(null);
    const folderPath = await selectProjectFolder();
    if (!folderPath) return;
    try {
      await openProjectFolder(folderPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className="sidebar" aria-label="Project sidebar">
      <div className="sidebar-brand" aria-label="AI Clip Assembler">
        <img src="./build/logo.png" alt="" className="sidebar-brand-logo" width="32" height="32" />
        <span className="sidebar-brand-name">AI Clip Assembler</span>
      </div>
      <button className="sidebar-new-project" type="button" onClick={openFolder} disabled={loading}>
        <span aria-hidden="true">+</span>
        Open Folder
      </button>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Projects</div>
        <div className="project-list">
          {recentProjects.length === 0 && (
            <div className="project-empty">No recent projects</div>
          )}
          {recentProjects.map((project) => {
            const active = project.folderPath === projectFolder;
            return (
              <div className={active ? 'project-row-wrap active' : 'project-row-wrap'} key={project.folderPath}>
                <button
                  className={active ? 'project-row active' : 'project-row'}
                  type="button"
                  disabled={loading || project.missing}
                  title={project.folderPath}
                  onClick={() => openProjectFolder(project.folderPath).catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                  })}
                >
                  <span className="project-dot" aria-hidden="true" />
                  <span className="project-row-name">{project.name ?? basename(project.folderPath)}</span>
                  <span className="project-row-count">{project.missing ? 'missing' : 'open'}</span>
                </button>
                <div className="project-row-actions">
                  {project.missing && (
                    <button type="button" onClick={() => relocateRecent(project.folderPath)}>
                      Locate
                    </button>
                  )}
                  <button type="button" onClick={() => removeRecent(project.folderPath)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <nav className="sidebar-section" aria-label="Workflow">
        <div className="sidebar-section-label">Workflow</div>
        <ol className="workflow-steps">
          {steps.map((step, index) => {
            const done = stepDone[step.to];
            return (
              <li className="workflow-step" key={step.to}>
                <NavLink
                  className={({ isActive }) =>
                    `step-link${isActive ? ' active' : ''}${done ? ' done' : ''}`
                  }
                  to={step.to}
                >
                  <span className="step-marker" aria-hidden="true">
                    <span className="step-number">{index + 1}</span>
                    <span className="step-check">{CheckIcon}</span>
                  </span>
                  <span className="step-body">
                    <span className="step-label">
                      <span className="step-icon">{step.icon}</span>
                      {step.label}
                    </span>
                    <span className="step-hint">{step.hint}</span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sidebar-footer">
        {!projectFolder && (
          <button className="sidebar-action" type="button" onClick={() => createUploadProject()} disabled={loading}>
            Upload files instead
          </button>
        )}
        <button className="sidebar-action" type="button" onClick={() => setSettingsTab('settings')}>
          Settings
        </button>
        <button className="sidebar-action" type="button" onClick={() => setSettingsTab('diagnostics')}>
          Diagnostics
        </button>
        {error && <div className="sidebar-error">{error}</div>}
        {projectName && <div className="sidebar-current">{projectName}</div>}
      </div>

      {settingsTab && (
        <SettingsModal initialTab={settingsTab} onClose={() => setSettingsTab(null)} />
      )}
    </aside>
  );
}
