import { useCallback, useEffect, useState } from 'react';
import { getDiagnostics, type Diagnostics } from '../api/client';

export function DiagnosticsTabPanel() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setError(null);
    getDiagnostics()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRunning(false));
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const review = data?.review_model;
  const guidance = review?.guidance ?? [];

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3 className="settings-group-title">Review model reachability</h3>
        <p className="settings-hint">
          Sends a tiny prompt to the configured provider/model to confirm it responds.
        </p>

        {running && <p className="settings-muted">Checking…</p>}
        {error && <p className="settings-error" role="alert">{error}</p>}

        {review && !running && (
          <dl className="diagnostics-list">
            <div>
              <dt>Status</dt>
              <dd>
                <span
                  className={
                    review.reachable ? 'diagnostics-badge ok' : 'diagnostics-badge fail'
                  }
                >
                  {review.reachable ? 'Reachable' : 'Not reachable'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{review.provider}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{review.model}</dd>
            </div>
            <div>
              <dt>Executable</dt>
              <dd>
                {review.binary.found
                  ? review.binary.resolved
                  : `Not found on PATH (${review.binary.configured})`}
              </dd>
            </div>
            {review.elapsed_sec != null && (
              <div>
                <dt>Response time</dt>
                <dd>{review.elapsed_sec}s</dd>
              </div>
            )}
            {review.detail && (
              <div>
                <dt>{review.reachable ? 'Reply' : 'Detail'}</dt>
                <dd className="diagnostics-detail">{review.detail}</dd>
              </div>
            )}
          </dl>
        )}

        {review && !running && !review.reachable && guidance.length > 0 && (
          <div className="diagnostics-guidance">
            <h4 className="diagnostics-guidance-title">How to fix this</h4>
            <ol className="diagnostics-guidance-steps">
              {guidance.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="settings-hint">
              Run the check again after each step. Steps that set an environment variable
              only take effect once AI Clip Assembler is quit and reopened.
            </p>
          </div>
        )}
      </section>

      <div className="settings-actions">
        <button type="button" className="btn" onClick={run} disabled={running}>
          {running ? 'Checking…' : 'Run check again'}
        </button>
      </div>
    </div>
  );
}
