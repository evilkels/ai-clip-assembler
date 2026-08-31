import type { UploadedVideo } from '../types/clip';

export type SourceVideoViewMode = 'table' | 'thumbs' | 'compact';
export type SourceVideoAnalysisFilter = 'all' | 'analyzed' | 'unanalyzed' | 'running';

export interface SourceVideoFilters {
  query: string;
  analysis: SourceVideoAnalysisFilter;
  /** Backend progress identifies the active source without mutating uploads. */
  runningFileName?: string | null;
}

/**
 * Analysis is running for exactly the source video the backend progress feed
 * names. The uploaded-video record carries no analysis state of its own, so this
 * is the only explicit signal — never infer it from `video.status` text.
 */
export function isSourceVideoRunning(
  video: UploadedVideo,
  runningFileName: string | null | undefined,
): boolean {
  return Boolean(runningFileName) && video.file_name === runningFileName;
}

export type SourceVideoSortKey = 'size' | 'date' | 'analyzed';

export interface SourceVideoSort {
  key: SourceVideoSortKey | null;
  dir: 'asc' | 'desc';
}

export function visibleSourceVideos(
  videos: UploadedVideo[],
  analyzedIds: ReadonlySet<string>,
  filters: SourceVideoFilters,
  sort: SourceVideoSort,
): UploadedVideo[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const filtered = videos.filter((video) => {
    const matchesQuery = !query || video.file_name.toLocaleLowerCase().includes(query);
    const analyzed = analyzedIds.has(video.file_id);
    const running = isSourceVideoRunning(video, filters.runningFileName);
    const matchesAnalysis =
      filters.analysis === 'all' ||
      (filters.analysis === 'analyzed' && analyzed) ||
      (filters.analysis === 'unanalyzed' && !analyzed && !running) ||
      (filters.analysis === 'running' && running);
    return matchesQuery && matchesAnalysis;
  });

  if (!sort.key) return filtered;
  const factor = sort.dir === 'asc' ? 1 : -1;
  const value = (video: UploadedVideo): number => {
    if (sort.key === 'size') return video.metadata?.size_bytes ?? 0;
    if (sort.key === 'analyzed') return Number(analyzedIds.has(video.file_id));
    return video.metadata?.created_at ? new Date(video.metadata.created_at).getTime() || 0 : 0;
  };
  return filtered
    .map((video, index) => ({ video, index }))
    .sort((a, b) => (value(a.video) - value(b.video)) * factor || a.index - b.index)
    .map(({ video }) => video);
}
