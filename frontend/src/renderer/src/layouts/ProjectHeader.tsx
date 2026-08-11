import { useReview } from '../state/ReviewContext';

type ProjectHeaderProps = {
  onRename?: () => void;
};

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function ProjectHeader({ onRename }: ProjectHeaderProps) {
  const { projectFolder, projectName } = useReview();
  const displayName = projectName ?? (projectFolder ? basename(projectFolder) : null);
  const hasProject = Boolean(displayName || projectFolder);

  return (
    <header className="project-header" aria-label="Current project">
      {!hasProject ? (
        <span className="project-header-empty">No project open</span>
      ) : (
        <div className="project-header-content">
          <strong className="project-header-name">{displayName ?? 'Project'}</strong>
          {projectFolder && (
            <span className="project-header-path" title={projectFolder}>
              {projectFolder}
            </span>
          )}
          <button
            className="btn subtle project-header-rename"
            type="button"
            onClick={onRename}
            disabled={!onRename}
          >
            Rename
          </button>
        </div>
      )}
    </header>
  );
}
