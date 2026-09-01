import { useCallback, useMemo, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import {
  exportTimeline,
  openInDaVinci,
  revealExportFile,
  type ExportFormat,
  type ExportResult,
} from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { WorkflowHeader } from '../components/WorkflowHeader';
import { StatusSurface } from '../components/StatusSurface';
import {
  effectiveTimelineDuration,
  projectTimelineItems,
  type TimelineProjectionItem,
} from '../lib/timelineProjection';
import type { ClipCandidate } from '../types/clip';

const EXPORT_FORMATS: Array<{
  id: ExportFormat;
  kicker: string;
  name: string;
  note: string;
  extension: string;
  actionLabel: string;
}> = [
  {
    id: 'resolve_xml',
    kicker: 'Resolve',
    name: 'DaVinci Resolve XML',
    note: 'A timeline handoff for DaVinci Resolve with source links preserved.',
    extension: '.xml',
    actionLabel: 'Export for DaVinci Resolve',
  },
  {
    id: 'fcpxml',
    kicker: 'FCPXML',
    name: 'Final Cut Pro XML',
    note: 'An editable XML sequence for Final Cut Pro and compatible NLEs.',
    extension: '.fcpxml',
    actionLabel: 'Export FCPXML',
  },
  {
    id: 'edl',
    kicker: 'EDL',
    name: 'CMX 3600 EDL',
    note: 'A compact interchange list for editors that support flat EDL imports.',
    extension: '.edl',
    actionLabel: 'Export EDL',
  },
];

interface ExportPayload {
  timeline: Array<{
    order: number;
    item_id: string;
    source_clip_id: string;
    file_id: string | null;
    file_name: string;
    start_sec: number;
    end_sec: number;
    speed: number;
    transform: TimelineProjectionItem['transform'];
  }>;
}

type DisplayExportResult = ExportResult & {
  effective_duration_sec: number;
  payload: ExportPayload;
};

function buildExportPayload(
  items: TimelineProjectionItem[],
  clipsById: Map<string, ClipCandidate>,
): ExportPayload {
  return {
    timeline: items.map((item, index) => ({
      order: index + 1,
      item_id: item.itemId,
      source_clip_id: item.sourceClipId,
      file_id: clipsById.get(item.sourceClipId)?.file_id ?? null,
      file_name: item.fileName,
      start_sec: item.startSec,
      end_sec: item.endSec,
      speed: item.speed,
      transform: item.transform,
    })),
  };
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

export function ExportPage() {
  const { clips, timelineItems, projectId, projectFolder } = useReview();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('edl');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportResults, setExportResults] = useState<
    Partial<Record<ExportFormat, DisplayExportResult>>
  >({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.clip_id, clip])), [clips]);
  const effectiveDuration = effectiveTimelineDuration(timelineItems);
  const projectedItems = useMemo(
    () => projectTimelineItems(timelineItems, clips),
    [clips, timelineItems],
  );
  const sourceFileCount = new Set(
    projectedItems.map((item) => clipsById.get(item.sourceClipId)?.file_id ?? item.sourceClipId),
  ).size;
  const repeatedItemCount = Math.max(
    0,
    projectedItems.length - new Set(projectedItems.map((item) => item.sourceClipId)).size,
  );
  const selectedFormatConfig = EXPORT_FORMATS.find((format) => format.id === selectedFormat)!;

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!projectId) return;
      setSelectedFormat(format);
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
        // Capture the authoritative projection at handoff time. The receipt is
        // intentionally not recomputed when Timeline state changes afterwards.
        setExportResults((previous) => ({
          ...previous,
          [format]: {
            ...result,
            effective_duration_sec: effectiveDuration,
            payload: buildExportPayload(projectedItems, clipsById),
          },
        }));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(null);
      }
    },
    [clipsById, effectiveDuration, projectedItems, projectId],
  );

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch {
      setCopiedPath(null);
    }
  }, []);

  const revealFile = useCallback(async (path: string) => {
    setExportError(null);
    try {
      await revealExportFile(path);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div className="page export-page">
      <WorkflowHeader
        title="Export"
        step="Step 04 / 04"
        description={`${timelineItems.length} item${timelineItems.length === 1 ? '' : 's'} in the Timeline · ${formatDuration(effectiveDuration)} total. Media paths stay relative to the project folder.`}
        actions={Object.values(exportResults).some(Boolean) ? (
          <button
            type="button"
            className="btn subtle export-reveal-header"
            onClick={() => {
              const result = exportResults[selectedFormat];
              if (result) void revealFile(result.file_path);
            }}
            disabled={!exportResults[selectedFormat]}
          >
            Reveal in Finder
          </button>
        ) : undefined}
      />

      <div className="page-body export-page-body">
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
          <div className="export-workspace">
            <main className="export-main-column">
              <section className="export-format-section" aria-labelledby="export-format-heading">
                <span id="export-format-heading" className="section-kicker">Choose a format</span>
                <div className="export-format-cards" role="group" aria-label="Export format">
                  {EXPORT_FORMATS.map((format) => {
                    const selected = selectedFormat === format.id;
                    return (
                      <button
                        type="button"
                        key={format.id}
                        className={`export-format-card${selected ? ' selected' : ''}`}
                        data-testid={`export-format-card-${format.id}`}
                        data-format={format.id}
                        aria-pressed={selected}
                        onClick={() => setSelectedFormat(format.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                          event.preventDefault();
                          const index = EXPORT_FORMATS.findIndex((item) => item.id === format.id);
                          const delta = event.key === 'ArrowRight' ? 1 : -1;
                          const next = EXPORT_FORMATS[(index + delta + EXPORT_FORMATS.length) % EXPORT_FORMATS.length];
                          setSelectedFormat(next.id);
                          requestAnimationFrame(() => {
                            document.querySelector<HTMLButtonElement>(
                              `[data-testid="export-format-card-${next.id}"]`,
                            )?.focus();
                          });
                        }}
                      >
                        <span className="export-format-kicker">{format.kicker}</span>
                        <strong>{format.name}</strong>
                        <span className="export-format-note">{format.note}</span>
                        <span className="export-format-extension">{format.extension}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="btn primary export-selected-action"
                  data-testid="export-selected"
                  onClick={() => void handleExport(selectedFormat)}
                  disabled={exporting !== null}
                >
                  {exporting === selectedFormat ? 'Exporting…' : selectedFormatConfig.actionLabel}
                </button>
              </section>

              {exportError && <p className="export-error" role="alert">{exportError}</p>}

              {EXPORT_FORMATS.map((format) => {
                const result = exportResults[format.id];
                if (!result) return null;
                return (
                  <div key={format.id} data-testid={`export-result-${format.id}`}>
                    <StatusSurface tone="success" className="export-receipt">
                    <div className="export-receipt-heading">
                      <div className="export-receipt-title">
                        <span className="export-receipt-kicker">Exported</span>
                        <strong>{format.name} exported</strong>
                      </div>
                      <span className="export-receipt-meta">
                        {result.clip_count} item{result.clip_count === 1 ? '' : 's'} ·{' '}
                        {formatDuration(result.effective_duration_sec)} effective · just now
                      </span>
                    </div>
                    <div className="export-receipt-path-row">
                      <code className="export-receipt-path" title={result.file_path}>{result.file_path}</code>
                      <button type="button" className="btn subtle" onClick={() => void copyPath(result.file_path)}>
                        {copiedPath === result.file_path ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" className="btn subtle" onClick={() => void revealFile(result.file_path)}>
                        Reveal
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
                  <div className="export-receipt-detail">
                    Backend report: {formatDuration(result.total_duration_sec)} · {result.status}
                  </div>
                  {result.warnings.length > 0 && (
                    <div role="status" data-testid={`export-warning-${format.id}`} className="export-warning">
                      {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  )}
                  <details className="export-payload-details">
                    <summary>Review export payload</summary>
                    <pre data-testid="export-payload">{JSON.stringify(result.payload, null, 2)}</pre>
                  </details>
                  </StatusSurface>
                </div>
              );
            })}
            </main>

            <aside className="export-handoff-summary" aria-label="What you're handing off">
              <span className="section-kicker">What you&apos;re handing off</span>
              <div className="export-summary-stats">
                <div><span>Timeline items</span><strong>{timelineItems.length}</strong></div>
                <div><span>Effective runtime</span><strong>{formatDuration(effectiveDuration)}</strong></div>
                <div><span>Source files</span><strong>{sourceFileCount}</strong></div>
                <div><span>Repeated items</span><strong>{repeatedItemCount}</strong></div>
              </div>
              <div className="export-summary-caveat">
                <span className="section-kicker">Format note</span>
                <p>
                  {selectedFormat === 'edl'
                    ? 'EDL is a flat interchange format; speed and transform metadata may be degraded.'
                    : selectedFormat === 'resolve_xml'
                      ? 'Resolve XML preserves the ordered Timeline placements and source links.'
                      : 'FCPXML carries the ordered Timeline placements for Final Cut Pro.'}
                </p>
              </div>
              <div className="export-summary-files">
                <span className="section-kicker">Source files</span>
                {Array.from(new Set(projectedItems.map((item) => item.fileName))).map((fileName) => (
                  <code key={fileName} title={fileName}>{fileName}</code>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
