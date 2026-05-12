import { useCallback, useMemo, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import { exportTimeline, updateTimeline } from '../api/client';
import type { ClipCandidate } from '../types/clip';

export function ExportPage() {
  const { clips, acceptedOrder, trims, projectId } = useReview();
  const [exporting, setExporting] = useState<'edl' | 'fcpxml' | null>(null);
  const [exportResult, setExportResult] = useState<{ edl?: string; fcpxml?: string }>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState(false);

  const acceptedClips = useMemo(
    () => {
      const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));
      return acceptedOrder
        .map((id) => clipsById.get(id))
        .filter((c): c is ClipCandidate => Boolean(c));
    },
    [acceptedOrder, clips],
  );

  const totalDuration = acceptedClips.reduce(
    (sum, c) => {
      const trim = trims[c.clip_id];
      const start = trim?.start_sec ?? c.start_sec;
      const end = trim?.end_sec ?? c.end_sec;
      return sum + (end - start);
    },
    0,
  );

  const handleExport = useCallback(
    async (format: 'edl' | 'fcpxml') => {
      if (!projectId) return;
      setExporting(format);
      setExportError(null);
      setSyncWarning(false);

      const hasCustomTrims = acceptedClips.some(
        (c) => {
          const t = trims[c.clip_id];
          return t && (Math.abs(t.start_sec - c.start_sec) > 0.01 || Math.abs(t.end_sec - c.end_sec) > 0.01);
        },
      );

      if (hasCustomTrims || acceptedOrder.length > 0) {
        const syncResult = await updateTimeline(projectId, {
          order: acceptedOrder,
          trims,
        });
        if (!syncResult.ok) {
          setSyncWarning(true);
        }
      }

      try {
        const result = await exportTimeline(projectId, format);
        setExportResult((prev) => ({ ...prev, [format]: result.file_path }));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(null);
      }
    },
    [projectId, acceptedOrder, trims, acceptedClips],
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
            {acceptedClips.length} clip{acceptedClips.length === 1 ? '' : 's'} accepted ·{' '}
            {totalDuration.toFixed(1)}s total.
          </p>
        </div>
      </div>
      <div className="page-body">
        {syncWarning && (
          <div
            style={{
              background: 'var(--bg-warning)',
              border: '1px solid var(--border-warning)',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 16,
              fontSize: 12,
            }}
          >
            <strong>Backend update needed for order/trim sync.</strong> The current backend does
            not support timeline updates. Export uses original analysis order and timings. Trims
            and accepted order are saved in the frontend session only.
          </div>
        )}

        {acceptedClips.length === 0 ? (
          <div className="empty-state">No clips accepted yet. Pick keepers on the Review tab.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn primary"
                onClick={() => handleExport('edl')}
                disabled={exporting !== null}
              >
                {exporting === 'edl' ? 'Exporting…' : 'Export EDL'}
              </button>
              <button
                className="btn primary"
                onClick={() => handleExport('fcpxml')}
                disabled={exporting !== null}
              >
                {exporting === 'fcpxml' ? 'Exporting…' : 'Export FCPXML'}
              </button>
            </div>

            {exportError && (
              <p style={{ color: 'var(--text-error)', fontSize: 13 }}>{exportError}</p>
            )}

            {exportResult.edl && (
              <div
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>EDL exported</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {exportResult.edl}
                  </code>
                  <button className="btn subtle" onClick={() => copyPath(exportResult.edl!)}>
                    Copy
                  </button>
                </div>
              </div>
            )}

            {exportResult.fcpxml && (
              <div
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>FCPXML exported</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {exportResult.fcpxml}
                  </code>
                  <button className="btn subtle" onClick={() => copyPath(exportResult.fcpxml!)}>
                    Copy
                  </button>
                </div>
              </div>
            )}

            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                Review export payload
              </summary>
              <pre
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
                    timeline: acceptedClips.map((c, idx) => {
                      const trim = trims[c.clip_id];
                      return {
                        order: idx + 1,
                        clip_id: c.clip_id,
                        file_id: c.file_id,
                        file_name: c.file_name,
                        start_sec: trim?.start_sec ?? c.start_sec,
                        end_sec: trim?.end_sec ?? c.end_sec,
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
