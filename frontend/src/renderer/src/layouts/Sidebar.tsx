import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { selectProjectFolder } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProjectRenameEditor } from '../components/ProjectRenameEditor';
import { recentProjectDisplayName, sortRecentProjects } from '../lib/projectSort';
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

const PencilIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14.5 7.5 2 2" />
  </svg>
);

const TrashIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7v13h12V7" />
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

export function Sidebar() {
  const {
    projectFolder,
    recentProjects,
    loading,
    openProjectFolder,
    createUploadProject,
    removeRecent,
    renameRecent,
    relocateRecent,
    uploadedVideos,
    acceptedCount,
    timelineItems,
  } = useReview();
  const [error, setError] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [editingFolderPath, setEditingFolderPath] = useState<string | null>(null);
  const [removingProject, setRemovingProject] = useState<
    { folderPath: string; displayName: string } | null
  >(null);
  const renameTriggers = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRename = useRef<string | null>(null);
  const orderedRecentProjects = useMemo(
    () => sortRecentProjects(recentProjects),
    [recentProjects],
  );

  useEffect(() => {
    if (editingFolderPath !== null || focusAfterRename.current === null) return;
    const folderPath = focusAfterRename.current;
    focusAfterRename.current = null;
    renameTriggers.current.get(folderPath)?.focus();
  }, [editingFolderPath]);

  const closeRename = useCallback((folderPath: string) => {
    focusAfterRename.current = folderPath;
    setEditingFolderPath(null);
  }, []);

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
          {orderedRecentProjects.length === 0 && (
            <div className="project-empty">No recent projects</div>
          )}
          {orderedRecentProjects.map((project, index) => {
            const active = project.folderPath === projectFolder;
            const displayName = recentProjectDisplayName(project);
            return (
              <div
                className={`project-row-wrap${active ? ' active' : ''}${project.missing ? ' missing' : ''}`}
                key={project.folderPath}
              >
                {editingFolderPath === project.folderPath ? (
                  <ProjectRenameEditor
                    key={project.folderPath}
                    initialName={displayName}
                    inputId={`project-name-${index}`}
                    onSave={async (name) => {
                      await renameRecent(project.folderPath, name);
                      closeRename(project.folderPath);
                    }}
                    onCancel={() => closeRename(project.folderPath)}
                  />
                ) : (
                  <div className="project-row">
                    <button
                      type="button"
                      className="project-row-open"
                      disabled={loading || project.missing}
                      aria-label={`Open ${displayName}`}
                      onClick={() => openProjectFolder(project.folderPath).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                      })}
                    >
                      <span className="project-row-name">{displayName}</span>
                    </button>
                    <div className="project-row-actions">
                      <button
                        type="button"
                        className="project-row-icon"
                        aria-label={`Rename ${displayName}`}
                        title="Rename"
                        ref={(element) => {
                          if (element) renameTriggers.current.set(project.folderPath, element);
                          else renameTriggers.current.delete(project.folderPath);
                        }}
                        onClick={() => {
                          setError(null);
                          setEditingFolderPath(project.folderPath);
                        }}
                      >
                        {PencilIcon}
                      </button>
                      <button
                        type="button"
                        className="project-row-icon danger"
                        aria-label={`Remove ${displayName}`}
                        title="Remove from list"
                        onClick={() => setRemovingProject({ folderPath: project.folderPath, displayName })}
                      >
                        {TrashIcon}
                      </button>
                    </div>
                  </div>
                )}
                {project.missing && editingFolderPath !== project.folderPath && (
                  <div className="project-row-missing-note">
                    <span className="project-state-chip missing">missing</span>
                    <button
                      type="button"
                      className="project-row-locate"
                      aria-label={`Locate ${displayName}`}
                      onClick={() => relocateRecent(project.folderPath)}
                    >
                      Locate folder
                    </button>
                  </div>
                )}
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
      </div>

      {settingsTab && (
        <SettingsModal initialTab={settingsTab} onClose={() => setSettingsTab(null)} />
      )}

      {removingProject && (
        <ConfirmDialog
          title={`Remove ${removingProject.displayName}?`}
          body="This only forgets the project in this list. The folder and your footage stay on disk."
          confirmLabel="Remove from list"
          destructive
          onCancel={() => setRemovingProject(null)}
          onConfirm={() => {
            const { folderPath } = removingProject;
            setRemovingProject(null);
            void Promise.resolve(removeRecent(folderPath)).catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
        />
      )}
    </aside>
  );
}
