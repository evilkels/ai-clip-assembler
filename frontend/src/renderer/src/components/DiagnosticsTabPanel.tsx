import { useCallback, useEffect, useState } from 'react';
import { getDiagnostics } from '../api/client';
import type { DiagnosticsResult } from '../types/generated';
import type { SettingsPanel } from './SettingsModal';

function ranAgoLabel(ranAt: number): string {
  const minutes = Math.floor((Date.now() - ranAt) / 60_000);
  if (minutes < 1) return 'RAN JUST NOW';
  return `RAN ${minutes} MIN AGO`;
}

export function DiagnosticsTabPanel({ onOpenSettings }: { onOpenSettings: (panel: SettingsPanel) => void }) {
  const [data, setData] = useState<DiagnosticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<number | null>(null);

  const run = useCallback(() => {
    setRunning(true);
    setError(null);
    getDiagnostics()
      .then((result) => {
        setData(result);
        setRanAt(Date.now());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRunning(false));
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const provider = data?.provider === 'chatgpt' ? 'ChatGPT' : data?.provider === 'claude' ? 'Claude' : data?.provider;

  return (
    <div className="settings-panel diagnostics-panel">
      {running && <p className="settings-muted">Checking…</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}

      {data && !running && (
        <>
          <div className={`diagnostics-status-card ${data.reachable ? 'reachable' : 'unreachable'}`} data-testid="diagnostics-result">
            <div className="diagnostics-status-row">
              <span className="diagnostics-ring" aria-hidden="true" />
              <span className={`diagnostics-badge ${data.reachable ? 'ok' : 'fail'}`}>
                {data.reachable ? 'Reachable' : 'Not reachable'}
              </span>
              <span className="diagnostics-status-summary">{provider}</span>
              <span className="diagnostics-status-summary">
                {data.reachable
                  ? data.elapsed_sec != null
                    ? `Replied in ${data.elapsed_sec}s`
                    : 'Replied'
                  : 'Check failed'}
              </span>
              {ranAt != null && (
                <span className="settings-diagnostics-stamp">{ranAgoLabel(ranAt)}</span>
              )}
              {data.reachable || !data.failure || !['open_providers', 'sign_in'].includes(data.failure.action) ? (
                <button type="button" className={data.reachable ? 'btn' : 'btn primary'} onClick={run}>
                  {data.reachable ? 'Run again' : 'Run check again'}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => onOpenSettings('ai')}>
                  Open AI settings
                </button>
              )}
            </div>
            {!data.reachable && data.failure?.message && <p className="diagnostics-detail">{data.failure.message}</p>}
          </div>
        </>
      )}

      {!data && !running && !error && <p className="settings-muted">No diagnostics result yet.</p>}
    </div>
  );
}
