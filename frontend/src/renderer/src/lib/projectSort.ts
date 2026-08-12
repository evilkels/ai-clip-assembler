import type { RecentProject } from '../types/clip';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function recentProjectDisplayName(project: RecentProject): string {
  return project.name ?? basename(project.folderPath);
}

export function currentProjectDisplayName({
  recentProject,
  projectName,
  projectFolder,
}: {
  recentProject?: RecentProject;
  projectName?: string | null;
  projectFolder?: string | null;
}): string | null {
  if (recentProject) return recentProjectDisplayName(recentProject);
  return projectName ?? (projectFolder ? basename(projectFolder) : null);
}

export function sortRecentProjects(projects: readonly RecentProject[]): RecentProject[] {
  return [...projects].sort((a, b) => {
    const nameOrder = recentProjectDisplayName(a).localeCompare(
      recentProjectDisplayName(b),
      undefined,
      { sensitivity: 'base' },
    );
    return nameOrder || a.folderPath.localeCompare(b.folderPath);
  });
}
