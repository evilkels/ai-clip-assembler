import { useEffect, useState } from 'react';
import { getSettings, updateSettings, type AppSettings, type SettingsUpdate } from '../api/client';
import { ThemeToggle } from './ThemeToggle';
import { UpdateSection } from './UpdateSection';

export function SettingsTabPanel() {
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

      <UpdateSection />

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
