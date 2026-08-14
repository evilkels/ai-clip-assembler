import { useCallback, useMemo, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import {
  exportTimeline,
  openInDaVinci,
  type ExportFormat,
  type ExportResult,
} from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { effectiveTimelineDuration, projectTimelineItems } from '../lib/timelineProjection';

const EXPORT_FORMATS: Array<{ id: ExportFormat; button: string; label: string }> = [
  { id: 'resolve_xml', button: 'Export for DaVinci Resolve', label: 'DaVinci Resolve XML exported' },
  { id: 'fcpxml', button: 'Export FCPXML', label: 'FCPXML exported' },
  { id: 'edl', button: 'Export EDL', label: 'EDL exported' },
];

type DisplayExportResult = ExportResult & { effective_duration_sec: number };

export function ExportPage() {
  const { clips, timelineItems, projectId, projectFolder } = useReview();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportResults, setExportResults] = useState<
    Partial<Record<ExportFormat, DisplayExportResult>>
  >({});
  const [exportError, setExportError] = useState<string | null>(null);

  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.clip_id, clip])), [clips]);

  const effectiveDuration = effectiveTimelineDuration(timelineItems);
  const projectedItems = useMemo(
    () => projectTimelineItems(timelineItems, clips),
    [clips, timelineItems],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!projectId) return;
      setExporting(format);
      setExportError(null);

      try {
        let result: ExportResult;
        try {
          result = await exportTimeline(projectId, format);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes('already exists')) throw err;
          const overwrite = window.confirm(`${message}\n\nOverwrite existing export?`);
          if (!overwrite) throw err;
          result = await exportTimeline(projectId, format, { overwrite: true });
        }
        setExportResults((previous) => ({
          ...previous,
          [format]: { ...result, effective_duration_sec: effectiveDuration },
        }));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(null);
      }
    },
    [effectiveDuration, projectId],
  );

  const copyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {});
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Export</h1>
          <p>
            {timelineItems.length} item{timelineItems.length === 1 ? '' : 's'} in the Timeline ·{' '}
            {effectiveDuration.toFixed(1)}s total.
          </p>
        </div>
      </div>
      <div className="page-body">
        {timelineItems.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M5 20h14" />
              </svg>
            }
            title="Nothing to export yet"
            hint="Choose the clips you want on the Review step, then come back here to save your video."
            actionLabel="Go to Review"
            actionTo="/review"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  className="btn primary"
                  onClick={() => handleExport(format.id)}
                  disabled={exporting !== null}
                >
                  {exporting === format.id ? 'Exporting…' : format.button}
                </button>
              ))}
            </div>

            {exportError && (
              <p style={{ color: 'var(--text-error)', fontSize: 13 }}>{exportError}</p>
            )}

            {EXPORT_FORMATS.map((format) => {
              const result = exportResults[format.id];
              if (!result) return null;
              return (
              <div
                key={format.id}
                data-testid={`export-result-${format.id}`}
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{format.label}</div>
                <div style={{ marginBottom: 4 }}>
                  {result.clip_count} item{result.clip_count === 1 ? '' : 's'} ·{' '}
                  {result.effective_duration_sec.toFixed(1)}s effective · backend{' '}
                  {result.total_duration_sec.toFixed(1)}s ·{' '}
                  {result.status}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {result.file_path}
                  </code>
                  <button
                    type="button"
                    className="btn subtle"
                    onClick={() => copyPath(result.file_path)}
                  >
                    Copy
                  </button>
                  {format.id === 'resolve_xml' && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={async () => {
                        setExportError(null);
                        try {
                          const opened = await openInDaVinci(result.file_path, projectFolder ?? undefined);
                          if (!opened) {
                            setExportError('Open the exported XML in DaVinci Resolve to import the draft.');
                          }
                        } catch (err) {
                          setExportError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      Open in DaVinci Resolve
                    </button>
                  )}
                </div>
                {result.warnings.length > 0 && (
                  <div
                    role="status"
                    data-testid={`export-warning-${format.id}`}
                    style={{
                      marginTop: 8,
                      color: 'var(--text-warning)',
                    }}
                  >
                    {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                )}
              </div>
              );
            })}

            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                Review export payload
              </summary>
              <pre
                data-testid="export-payload"
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 12,
                  marginTop: 8,
                  fontSize: 11,
                  overflow: 'auto',
                  maxHeight: 300,
                }}
              >
                {JSON.stringify(
                  {
                    timeline: projectedItems.map((item, index) => {
                      const clip = clipsById.get(item.sourceClipId);
                      return {
                        order: index + 1,
                        item_id: item.itemId,
                        source_clip_id: item.sourceClipId,
                        file_id: clip?.file_id ?? null,
                        file_name: item.fileName,
                        start_sec: item.startSec,
                        end_sec: item.endSec,
                        speed: item.speed,
                        transform: item.transform,
                      };
                    }),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
