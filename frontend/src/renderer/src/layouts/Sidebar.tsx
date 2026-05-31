import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { selectProjectFolder } from '../api/client';
import { useReview } from '../state/ReviewContext';

const routes = [
  { to: '/import', label: 'Import' },
  { to: '/review', label: 'Review' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/export', label: 'Export' },
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
    rescanOpenProject,
    deleteOpenProjectFiles,
  } = useReview();
  const [error, setError] = useState<string | null>(null);

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

  const deleteFiles = async () => {
    if (!projectFolder) return;
    const confirmed = window.confirm(
      'Delete clipassembler/ and exports/ for this project? Source videos will not be deleted.',
    );
    if (!confirmed) return;
    setError(null);
    try {
      await deleteOpenProjectFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className="sidebar" aria-label="Project sidebar">
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
        <div className="route-list">
          {routes.map((route) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'route-link active' : 'route-link')}
              key={route.to}
              to={route.to}
            >
              {route.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        {projectFolder && (
          <>
            <button className="sidebar-action" type="button" onClick={() => rescanOpenProject()} disabled={loading}>
              Rescan
            </button>
            <button className="sidebar-action" type="button" onClick={deleteFiles} disabled={loading}>
              Delete project files
            </button>
          </>
        )}
        {!projectFolder && (
          <button className="sidebar-action" type="button" onClick={() => createUploadProject()} disabled={loading}>
            Legacy upload project
          </button>
        )}
        <button className="sidebar-action" type="button">
          Settings
        </button>
        <button className="sidebar-action" type="button">
          Diagnostics
        </button>
        {error && <div className="sidebar-error">{error}</div>}
        {projectName && <div className="sidebar-current">{projectName}</div>}
      </div>
    </aside>
  );
}
