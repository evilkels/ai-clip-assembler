import { useMemo, useState } from 'react';
import { ViewModeSwitcher } from './ViewModeSwitcher';
import { formatBytes, formatClock, formatDate } from '../lib/format';
import {
  isSourceVideoRunning,
  visibleSourceVideos,
  type SourceVideoFilters,
  type SourceVideoSort,
  type SourceVideoSortKey,
  type SourceVideoViewMode,
} from '../lib/sourceVideoView';
import type { UploadedVideo } from '../types/clip';

interface Props {
  videos: UploadedVideo[];
  analyzedIds: ReadonlySet<string>;
  deselected: ReadonlySet<string>;
  selectedIds: readonly string[];
  sort: SourceVideoSort;
  onSort: (key: SourceVideoSortKey) => void;
  onToggleOne: (fileId: string) => void;
  onToggleAll: () => void;
  onPreview: (video: UploadedVideo) => void;
  runningFileName?: string | null;
  disabled?: boolean;
}

type ColumnKey = 'duration' | 'fps' | 'resolution' | 'size' | 'date' | 'codec' | 'analysis';
const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'duration', label: 'Duration' },
  { key: 'fps', label: 'FPS' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'size', label: 'Size' },
  { key: 'date', label: 'Date' },
  { key: 'codec', label: 'Codec' },
  { key: 'analysis', label: 'Analysis' },
];

function formatResolution(metadata: NonNullable<UploadedVideo['metadata']>): string {
  const display = metadata.display_resolution;
  const hasUsableDisplay = Array.isArray(display) && display.length === 2 && display.every((value) => Number.isFinite(value) && value > 0);
  const [width, height] = hasUsableDisplay ? display : metadata.resolution;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '—';
  return `${width}×${height}${height > width ? ' ↕' : ''}`;
}

function sortArrow(sort: SourceVideoSort, key: SourceVideoSortKey): string {
  return sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
}

export function SourceVideoBrowser({
  videos,
  analyzedIds,
  deselected,
  selectedIds,
  sort,
  onSort,
  onToggleOne,
  onToggleAll,
  onPreview,
  runningFileName = null,
  disabled = false,
}: Props) {
  const [viewMode, setViewMode] = useState<SourceVideoViewMode>('table');
  const [filters, setFilters] = useState<SourceVideoFilters>({ query: '', analysis: 'all' });
  const visibleFilters = useMemo(
    () => ({ ...filters, runningFileName }),
    [filters, runningFileName],
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(
    () => Object.fromEntries(COLUMNS.map(({ key }) => [key, true])) as Record<ColumnKey, boolean>,
  );
  const visible = useMemo(
    () => visibleSourceVideos(videos, analyzedIds, visibleFilters, sort),
    [videos, analyzedIds, visibleFilters, sort],
  );
  const allSelected = videos.length > 0 && selectedIds.length === videos.length;
  const someSelected = videos.some((video) => !deselected.has(video.file_id));
  const viewOptions = [
    { value: 'table' as const, label: 'Table' },
    { value: 'thumbs' as const, label: 'Thumbs' },
    { value: 'compact' as const, label: 'Compact' },
  ];

  const toggleColumn = (key: ColumnKey) =>
    setColumns((current) => ({ ...current, [key]: !current[key] }));

  const selectionBox = (video: UploadedVideo) => {
    const checked = !deselected.has(video.file_id);
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggleOne(video.file_id)}
        disabled={disabled}
        aria-label={`Select ${video.file_name}`}
      />
    );
  };

  const sortButton = (key: SourceVideoSortKey, label: string) => (
    <button type="button" className="source-video-sort" onClick={() => onSort(key)}>
      {label}{sortArrow(sort, key)}
    </button>
  );
  const isRunning = (video: UploadedVideo) => isSourceVideoRunning(video, runningFileName);
  const analysisLabel = (video: UploadedVideo) =>
    isRunning(video) ? 'Running' : analyzedIds.has(video.file_id) ? 'Analyzed' : 'Not analyzed';
  const sortDirection = (key: SourceVideoSortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <section className="source-video-browser" aria-label="Source videos">
      <div className="source-video-browser-head">
        <div>
          <h2>Source videos</h2>
          <p>Choose footage to analyze. Files stay local to this project.</p>
        </div>
        <ViewModeSwitcher
          value={viewMode}
          options={viewOptions}
          onChange={setViewMode}
          ariaLabel="Source video view"
        />
      </div>
      <div className="source-video-browser-tools">
        <label className="source-video-search">
          <span>Search</span>
          <input
            type="search"
            aria-label="Search source videos"
            placeholder="Search filenames"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          />
        </label>
        <label className="source-video-filter">
          <span>Analysis</span>
          <select
            aria-label="Analysis filter"
            value={filters.analysis}
            onChange={(event) => setFilters((current) => ({ ...current, analysis: event.target.value as SourceVideoFilters['analysis'] }))}
          >
            <option value="all">All</option>
            <option value="analyzed">Analyzed</option>
            <option value="unanalyzed">Not analyzed</option>
            <option value="running">Running</option>
          </select>
        </label>
        <div className="source-video-columns">
          <button type="button" className="btn subtle" onClick={() => setColumnsOpen((open) => !open)}>
            Columns
          </button>
          {columnsOpen ? (
            <div className="source-video-columns-menu" role="group" aria-label="Source video columns">
              {COLUMNS.map(({ key, label }) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={columns[key]}
                    onChange={() => toggleColumn(key)}
                    aria-label={`${label} column`}
                  />
                  {label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="source-video-browser-meta">
        <span>{visible.length} shown</span>
        {filters.query || filters.analysis !== 'all' ? <span>Filtered from {videos.length}</span> : null}
      </div>

      {viewMode === 'thumbs' ? (
        <div className="source-video-thumbs" data-view-mode="thumbs">
          {visible.map((video) => {
            const checked = !deselected.has(video.file_id);
            return (
              <article
                key={video.file_id}
                className={`source-video-card${checked ? '' : ' is-deselected'}`}
                data-source-video-row
              >
                <div className="source-video-poster" aria-hidden="true"><span>MP4</span></div>
                <div className="source-video-card-head">{selectionBox(video)}<strong title={video.file_name}>{video.file_name}</strong></div>
                <span>{video.metadata ? formatClock(video.metadata.duration_sec) : 'Pending'} · {analysisLabel(video)}</span>
              </article>
            );
          })}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="source-video-compact" data-view-mode="compact">
          {visible.map((video) => {
            const checked = !deselected.has(video.file_id);
            return (
              <div
                key={video.file_id}
                className={`source-video-compact-row${checked ? '' : ' is-deselected'}`}
                data-source-video-row
              >
                {selectionBox(video)}
                <button type="button" className="preview-eye" title={`Preview ${video.file_name}`} aria-label={`Preview ${video.file_name}`} onClick={(event) => { event.stopPropagation(); onPreview(video); }}>👁</button>
                <strong title={video.file_name}>{video.file_name}</strong>
                <span>{video.metadata ? formatClock(video.metadata.duration_sec) : 'Pending'}</span>
                <span>{analysisLabel(video)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="source-videos-table-scroll" data-view-mode="table">
          <table className="source-videos-table">
            <thead>
              <tr>
                <th className="source-video-select-cell">
                  <input type="checkbox" checked={allSelected} ref={(element) => { if (element) element.indeterminate = !allSelected && someSelected; }} onChange={onToggleAll} disabled={disabled} aria-label="Select all videos" />
                </th>
                <th aria-label="Preview" />
                <th>File</th>
                {columns.duration ? <th>{COLUMNS[0].label}</th> : null}
                {columns.fps ? <th>{COLUMNS[1].label}</th> : null}
                {columns.resolution ? <th>{COLUMNS[2].label}</th> : null}
                {columns.size ? <th aria-sort={sortDirection('size')}>{sortButton('size', COLUMNS[3].label)}</th> : null}
                {columns.date ? <th aria-sort={sortDirection('date')}>{sortButton('date', COLUMNS[4].label)}</th> : null}
                {columns.codec ? <th>{COLUMNS[5].label}</th> : null}
                {columns.analysis ? <th aria-sort={sortDirection('analyzed')}>{sortButton('analyzed', COLUMNS[6].label)}</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((video) => {
                const checked = !deselected.has(video.file_id);
                return (
                  <tr key={video.file_id} data-source-video-row className={checked ? '' : 'is-deselected'}>
                    <td className="source-video-select-cell">{selectionBox(video)}</td>
                    <td><button type="button" className="preview-eye" title={`Preview ${video.file_name}`} aria-label={`Preview ${video.file_name}`} disabled={!video.metadata} onClick={(event) => { event.stopPropagation(); onPreview(video); }}>👁</button></td>
                    <td className="source-video-name" title={video.file_name}>{video.file_name}</td>
                    {columns.duration ? <td>{video.metadata ? formatClock(video.metadata.duration_sec) : 'Pending'}</td> : null}
                    {columns.fps ? <td>{video.metadata ? video.metadata.fps.toFixed(2) : '—'}</td> : null}
                    {columns.resolution ? <td>{video.metadata ? formatResolution(video.metadata) : '—'}</td> : null}
                    {columns.size ? <td>{formatBytes(video.metadata?.size_bytes)}</td> : null}
                    {columns.date ? <td>{formatDate(video.metadata?.created_at)}</td> : null}
                    {columns.codec ? <td>{video.metadata?.codec ?? '—'}</td> : null}
                    {columns.analysis ? <td className={isRunning(video) ? 'is-running' : analyzedIds.has(video.file_id) ? 'is-analyzed' : ''}>{isRunning(video) ? 'Running' : analyzedIds.has(video.file_id) ? '✓ Analyzed' : '— Not analyzed'}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {visible.length === 0 ? <p className="source-video-empty">No source videos match these filters.</p> : null}
    </section>
  );
}
