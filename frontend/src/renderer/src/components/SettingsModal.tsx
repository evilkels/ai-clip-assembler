import { useCallback, useEffect, useState } from 'react';
import {
  getDiagnostics,
  getSettings,
  updateSettings,
  type AppSettings,
  type Diagnostics,
  type SettingsUpdate,
} from '../api/client';
import { useTheme, type ThemePreference } from '../state/ThemeContext';

export type SettingsTab = 'settings' | 'diagnostics';

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
          <label className="settings-label">Theme</label>
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
            aria-selected={tab === 'diagnostics'}
            className={tab === 'diagnostics' ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab('diagnostics')}
          >
            Diagnostics
          </button>
        </div>

        {tab === 'settings' ? <SettingsTabPanel /> : <DiagnosticsTabPanel />}
      </section>
    </div>
  );
}
