import { useEffect, useState } from 'react';
import { SettingsTabPanel } from './SettingsTabPanel';
import { ConnectionsTabPanel } from './ConnectionsTabPanel';
import { DiagnosticsTabPanel } from './DiagnosticsTabPanel';

export type SettingsTab = 'settings' | 'connect-ai' | 'diagnostics';

interface SettingsModalProps {
  initialTab?: SettingsTab;
  onClose: () => void;
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
