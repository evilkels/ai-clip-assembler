import { useCallback, useEffect, useState } from 'react';
import { getDiagnostics, type Diagnostics } from '../api/client';

function ranAgoLabel(ranAt: number): string {
  const minutes = Math.floor((Date.now() - ranAt) / 60_000);
  if (minutes < 1) return 'RAN JUST NOW';
  return `RAN ${minutes} MIN AGO`;
}

export function DiagnosticsTabPanel() {
  const [data, setData] = useState<Diagnostics | null>(null);
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

  const review = data?.review_model;
  const guidance = review?.guidance ?? [];

  return (
    <div className="settings-panel diagnostics-panel">
      {running && <p className="settings-muted">Checking…</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}

      {review && !running && (
        <>
          <div className={`diagnostics-status-card ${review.reachable ? 'reachable' : 'unreachable'}`} data-testid="diagnostics-result">
            <div className="diagnostics-status-row">
              <span className="diagnostics-ring" aria-hidden="true" />
              <span className={`diagnostics-badge ${review.reachable ? 'ok' : 'fail'}`}>
                {review.reachable ? 'Reachable' : 'Not reachable'}
              </span>
              <span className="diagnostics-status-summary">
                {review.reachable
                  ? review.elapsed_sec != null
                    ? `Replied in ${review.elapsed_sec}s`
                    : 'Replied'
                  : 'Check failed'}
              </span>
              {ranAt != null && (
                <span className="settings-diagnostics-stamp">{ranAgoLabel(ranAt)}</span>
              )}
              <button type="button" className={review.reachable ? 'btn' : 'btn primary'} onClick={run}>
                {review.reachable ? 'Run again' : 'Run check again'}
              </button>
            </div>
            {!review.reachable && review.detail && <p className="diagnostics-detail">{review.detail}</p>}
          </div>

          {review.reachable ? (
            <dl className="diagnostics-list">
              <div><dt>Provider</dt><dd>{review.provider}</dd></div>
              <div><dt>Model</dt><dd>{review.model}</dd></div>
              <div><dt>Executable</dt><dd>{review.binary.found ? review.binary.resolved : `Not found on PATH (${review.binary.configured})`}</dd></div>
              {review.elapsed_sec != null && <div><dt>Round trip</dt><dd>{review.elapsed_sec}s</dd></div>}
            </dl>
          ) : (
            <div className="diagnostics-guidance">
              <h4 className="diagnostics-guidance-title">How to fix this</h4>
              <ol className="diagnostics-guidance-steps">
                {guidance.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
              <p className="diagnostics-guidance-note">
                Environment-variable steps only take effect after quitting and reopening the app. Until then Import falls back to rule-based scoring, so your project still works.
              </p>
            </div>
          )}
        </>
      )}

      {!review && !running && !error && <p className="settings-muted">No diagnostics result yet.</p>}
    </div>
  );
}
