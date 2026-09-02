import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ProjectRenameEditor } from '../components/ProjectRenameEditor';
import { effectiveTimelineDuration } from '../lib/timelineProjection';
import { formatBytes } from '../lib/format';
import { currentProjectDisplayName } from '../lib/projectSort';
import { useReview } from '../state/ReviewContext';

export function ProjectHeader() {
  const { projectFolder, projectName, recentProjects, renameRecent, uploadedVideos, clips, acceptedCount, timelineItems } = useReview();
  const location = useLocation();
  const recentProject = recentProjects.find((project) => project.folderPath === projectFolder);
  const displayName = currentProjectDisplayName({ recentProject, projectName, projectFolder });
  const hasProject = Boolean(displayName || projectFolder);
  const projectMetadata = useMemo(() => {
    const sourceBytes = uploadedVideos.reduce(
      (total, video) => total + (video.metadata?.size_bytes ?? 0),
      0,
    );
    const runtime = effectiveTimelineDuration(timelineItems).toFixed(1);
    switch (location.pathname) {
      case '/import':
        return `${uploadedVideos.length} sources · ${formatBytes(sourceBytes)}`;
      case '/review':
        return `${clips.length} clips · ${acceptedCount} kept`;
      case '/timeline':
      case '/export':
        return `${timelineItems.length} items · ${runtime}s`;
      default:
        return `${uploadedVideos.length} sources`;
    }
  }, [acceptedCount, clips.length, location.pathname, timelineItems, uploadedVideos]);
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
    <header className="project-header" aria-label="Current project" data-surface="project-header">
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
            <span className="project-header-path project-header-metadata" title={projectFolder}>
              {projectFolder}
            </span>
          )}
          {projectFolder && (
            <span className="project-header-stats project-header-metadata" aria-label="Project summary">
              {projectMetadata}
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
