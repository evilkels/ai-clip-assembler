import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectRenameEditor } from '../components/ProjectRenameEditor';
import { useReview } from '../state/ReviewContext';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function ProjectHeader() {
  const { projectFolder, projectName, recentProjects, renameRecent } = useReview();
  const recentProject = recentProjects.find((project) => project.folderPath === projectFolder);
  const displayName = recentProject?.name ?? projectName ?? (projectFolder ? basename(projectFolder) : null);
  const hasProject = Boolean(displayName || projectFolder);
  const [editing, setEditing] = useState(false);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);

  useEffect(() => {
    if (editing || !focusAfterClose.current) return;
    focusAfterClose.current = false;
    renameTrigger.current?.focus();
  }, [editing]);

  const closeRename = useCallback(() => {
    focusAfterClose.current = true;
    setEditing(false);
  }, []);

  return (
    <header className="project-header" aria-label="Current project">
      {!hasProject ? (
        <span className="project-header-empty">No project open</span>
      ) : editing && projectFolder ? (
        <ProjectRenameEditor
          initialName={displayName ?? 'Project'}
          inputId="project-header-name"
          onSave={async (name) => {
            await renameRecent(projectFolder, name);
            closeRename();
          }}
          onCancel={closeRename}
        />
      ) : (
        <div className="project-header-content">
          <strong className="project-header-name">{displayName ?? 'Project'}</strong>
          {projectFolder && (
            <span className="project-header-path" title={projectFolder}>
              {projectFolder}
            </span>
          )}
          {projectFolder && (
            <button
              ref={renameTrigger}
              className="btn subtle project-header-rename"
              type="button"
              aria-label={`Rename ${displayName ?? 'Project'}`}
              onClick={() => setEditing(true)}
            >
              Rename
            </button>
          )}
        </div>
      )}
    </header>
  );
}
