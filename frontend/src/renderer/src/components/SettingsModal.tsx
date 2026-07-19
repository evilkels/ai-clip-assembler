import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelReviewModelSignIn,
  connectMcpClient,
  detectMcpClients,
  getDiagnostics,
  getReviewModelAccountStatus,
  getSettings,
  signInReviewModel,
  updateSettings,
  type AppSettings,
  type Diagnostics,
  type McpClientId,
  type McpClientStatus,
  type McpConnectResult,
  type ReviewModelAccountStatus,
  type SettingsUpdate,
} from '../api/client';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

export type SettingsTab = 'settings' | 'connect-ai' | 'diagnostics';

interface SettingsModalProps {
  initialTab?: SettingsTab;
  onClose: () => void;
}

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {themeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          className={preference === option.value ? 'theme-toggle-option active' : 'theme-toggle-option'}
          onClick={() => setPreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingsTabPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getSettings()
      .then((res) => {
        if (active) setSettings(res.settings);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const value = <K extends keyof AppSettings>(key: K): AppSettings[K] =>
    (draft[key as keyof SettingsUpdate] as AppSettings[K] | undefined) ??
    (settings?.[key] as AppSettings[K]);

  const dirty = Object.keys(draft).length > 0;

  const save = () => {
    setSaving(true);
    setSaveError(null);
    updateSettings(draft)
      .then((res) => {
        setSettings(res.settings);
        setDraft({});
        setSavedAt(Date.now());
      })
      .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  if (loadError) {
    return <p className="settings-error" role="alert">Couldn't load settings: {loadError}</p>;
  }
  if (!settings) {
    return <p className="settings-muted">Loading settings…</p>;
  }

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3 className="settings-group-title">Appearance</h3>
        <div className="settings-row">
          <span className="settings-label">Theme</span>
          <ThemeToggle />
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">AI review model</h3>
        <p className="settings-hint">
          Used by the review agent and clip analysis. Changes take effect on the next request.
        </p>
        <div className="settings-row">
          <label className="settings-label" htmlFor="pi-provider">Provider</label>
          <input
            id="pi-provider"
            className="settings-input"
            type="text"
            value={value('pi_provider') ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, pi_provider: e.target.value }))}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="pi-model">Model</label>
          <input
            id="pi-model"
            className="settings-input"
            type="text"
            value={value('pi_model') ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, pi_model: e.target.value }))}
          />
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="pi-timeout">Timeout (seconds)</label>
          <input
            id="pi-timeout"
            className="settings-input settings-input-narrow"
            type="number"
            min={1}
            value={value('pi_timeout_sec') ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                pi_timeout_sec: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Executable</span>
          <span className="settings-readonly" title="Set via the PI_BIN environment variable">
            {settings.pi_bin}
          </span>
        </div>
      </section>

      {saveError && <p className="settings-error" role="alert">{saveError}</p>}

      <div className="settings-actions">
        {savedAt && !dirty && <span className="settings-saved">Saved</span>}
        <button type="button" className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

const accountStateLabels: Record<ReviewModelAccountStatus['state'], string> = {
  connected: 'Connected',
  expired: 'Expired',
  disconnected: 'Disconnected',
  waiting: 'Waiting',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

type DiagnosticState = 'checking' | 'reachable' | 'unreachable';

function ReviewModelAccountSection() {
  const [account, setAccount] = useState<ReviewModelAccountStatus | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [diagnosticState, setDiagnosticState] = useState<DiagnosticState | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestIdRef.current;
    getReviewModelAccountStatus()
      .then((status) => {
        if (mountedRef.current && requestId === requestIdRef.current) setAccount(status);
      })
      .catch(() => {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setAccount({
            provider: 'openai-codex',
            state: 'failed',
            detail: 'Review model account status could not be loaded.',
            pi: { state: 'incompatible', detail: 'Pi could not be inspected.' },
          });
        }
      });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const runDiagnostics = async (requestId: number) => {
    if (!mountedRef.current || requestId !== requestIdRef.current) return;
    setDiagnosticState('checking');
    try {
      const result = await getDiagnostics();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setDiagnosticState(result.review_model.reachable ? 'reachable' : 'unreachable');
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setDiagnosticState('unreachable');
      }
    }
  };

  const act = async () => {
    if (!account) return;
    const requestId = ++requestIdRef.current;
    setActionPending(true);
    setDiagnosticState(null);
    if (account.state !== 'waiting') {
      setAccount({ ...account, state: 'waiting', detail: 'Waiting for OpenAI sign-in.' });
      setActionPending(false);
    }

    try {
      const status = account.state === 'waiting'
        ? await cancelReviewModelSignIn()
        : await signInReviewModel();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setAccount(status);
      setActionPending(false);
      if (status.state === 'connected') await runDiagnostics(requestId);
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setAccount({
        ...account,
        state: 'failed',
        detail: 'OpenAI sign-in failed. Try again.',
      });
      setActionPending(false);
    }
  };

  if (!account) {
    return (
      <section className="settings-group">
        <h3 className="settings-group-title">Review model account</h3>
        <p className="settings-muted" role="status" aria-live="polite">Checking account…</p>
      </section>
    );
  }

  const waiting = account.state === 'waiting';
  const actionLabel = waiting ? 'Cancel' : account.state === 'disconnected' ? 'Sign in' : 'Reconnect';
  const actionDisabled = actionPending || (!waiting && account.pi.state !== 'ready');

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">Review model account</h3>
      <div className={`review-model-account state-${account.state}`}>
        <div className="review-model-account-main">
          <div>
            <span className={`diagnostics-badge ${account.state === 'connected' ? 'ok' : account.state === 'failed' ? 'fail' : ''}`}>
              {accountStateLabels[account.state]}
            </span>
            <p
              className={account.state === 'failed' ? 'settings-error' : 'settings-muted'}
              role={account.state === 'failed' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {account.detail}
            </p>
          </div>
          <button type="button" className="btn" onClick={act} disabled={actionDisabled}>
            {actionLabel}
          </button>
        </div>
        <p className="review-model-pi-detail">
          Pi{account.pi.version ? ` ${account.pi.version}` : ''}: {account.pi.detail}
        </p>
        {diagnosticState === 'checking' && <p className="settings-muted">Checking configured model…</p>}
        {diagnosticState === 'reachable' && <p className="settings-saved">Configured model is reachable.</p>}
        {diagnosticState === 'unreachable' && (
          <p className="settings-error" role="alert">
            Account is connected, but the configured model is not reachable.
          </p>
        )}
      </div>
    </section>
  );
}

function ConnectionsTabPanel() {
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [connecting, setConnecting] = useState<McpClientId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<McpConnectResult | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    detectMcpClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = (clientId: McpClientId) => {
    setConnecting(clientId);
    setError(null);
    connectMcpClient(clientId)
      .then((result) => {
        setLastResult(result);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConnecting(null));
  };

  return (
    <div className="settings-panel">
      <ReviewModelAccountSection />
      <section className="settings-group">
        <h3 className="settings-group-title">Connect your AI</h3>
        <p className="settings-hint">
          Connect an MCP-capable desktop client so it can inspect candidates and edit the open Timeline.
        </p>

        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}

        <div className="mcp-client-list">
          {clients.map((client) => (
            <div key={client.id} className="mcp-client-row">
              <div>
                <div className="mcp-client-name">{client.name}</div>
                <div className="settings-muted">{client.configPath}</div>
              </div>
              <div className="mcp-client-actions">
                <span className={client.connected ? 'diagnostics-badge ok' : 'diagnostics-badge'}>
                  {client.detectError
                    ? 'Config unreadable'
                    : client.connected
                      ? 'Connected'
                      : client.installed
                        ? 'Detected'
                        : 'Not installed'}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => connect(client.id)}
                  disabled={connecting === client.id || !client.installed || Boolean(client.detectError)}
                >
                  {connecting === client.id ? 'Connecting...' : client.connected ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {lastResult && (
          <output className="mcp-connect-result">
            <p className="settings-saved">Connected. Restart {lastResult.name} to finish.</p>
            {lastResult.backupPath && (
              <p className="settings-muted">Backup created at {lastResult.backupPath}</p>
            )}
            <pre className="mcp-snippet">{lastResult.snippet}</pre>
          </output>
        )}
      </section>
    </div>
  );
}

function DiagnosticsTabPanel() {
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
      </section>

      <div className="settings-actions">
        <button type="button" className="btn" onClick={run} disabled={running}>
          {running ? 'Checking…' : 'Run check again'}
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({ initialTab = 'settings', onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-dialog"
        // Custom modal matches the existing dark editor-console surface, in line
        // with VersionApplyDialog; a native <dialog> migration is a separate
        // design decision tracked there.
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn subtle" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'settings'}
            className={tab === 'settings' ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'connect-ai'}
            className={tab === 'connect-ai' ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab('connect-ai')}
          >
            Connections
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'diagnostics'}
            className={tab === 'diagnostics' ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab('diagnostics')}
          >
            Diagnostics
          </button>
        </div>

        {tab === 'settings' && <SettingsTabPanel />}
        {tab === 'connect-ai' && <ConnectionsTabPanel />}
        {tab === 'diagnostics' && <DiagnosticsTabPanel />}
      </section>
    </div>
  );
}
