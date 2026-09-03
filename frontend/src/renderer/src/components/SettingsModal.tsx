import { useEffect, useState } from 'react';
import { AiAssistancePanel } from './AiAssistancePanel';
import { ConnectionsTabPanel } from './ConnectionsTabPanel';
import { DiagnosticsTabPanel } from './DiagnosticsTabPanel';
import { GeneralSettingsPanel } from './SettingsTabPanel';

export type SettingsPanel = 'ai' | 'connections' | 'diagnostics' | 'general';

/** Legacy names kept at the boundary so existing deep links keep working. */
export type SettingsTab = 'settings' | 'connect-ai' | 'diagnostics';

interface SettingsModalProps {
  initialPanel?: SettingsPanel;
  initialTab?: SettingsTab;
  onClose: () => void;
}

const legacyPanel: Record<SettingsTab, SettingsPanel> = {
  settings: 'general',
  'connect-ai': 'connections',
  diagnostics: 'diagnostics',
};

const panels: Array<{ id: SettingsPanel; label: string; badge?: string }> = [
  { id: 'ai', label: 'AI assistance', badge: 'CLOUD' },
  { id: 'connections', label: 'Connections' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'general', label: 'General' },
];

function panelTitle(panel: SettingsPanel): string {
  return panels.find((item) => item.id === panel)?.label ?? 'Settings';
}

function panelDescription(panel: SettingsPanel): string {
  switch (panel) {
    case 'ai':
      return 'Who scores your footage and answers in Review. Changes take effect on the next request.';
    case 'connections':
      return 'Let an MCP-capable desktop client inspect candidates and edit the open timeline.';
    case 'diagnostics':
      return 'Sends a tiny prompt to the configured provider and model to confirm it answers.';
    case 'general':
      return 'Appearance, updates, and other settings for this machine.';
  }
}

export function SettingsModal({ initialPanel = 'ai', initialTab, onClose }: SettingsModalProps) {
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(
    initialTab ? legacyPanel[initialTab] : initialPanel,
  );

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
        aria-labelledby="settings-panel-title"
      >
        <aside className="settings-rail">
          <div className="settings-rail-heading">
            <strong>Settings</strong>
            <span>local first · v0.2.0</span>
          </div>
          <div className="settings-rail-items" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            {panels.map((panel) => (
              <button
                key={panel.id}
                id={`settings-tab-${panel.id}`}
                type="button"
                role="tab"
                aria-selected={settingsPanel === panel.id}
                aria-controls={`settings-panel-${panel.id}`}
                className={settingsPanel === panel.id ? 'settings-rail-item active' : 'settings-rail-item'}
                onClick={() => setSettingsPanel(panel.id)}
              >
                <span>{panel.label}</span>
                {panel.badge && <span className="settings-rail-badge" aria-hidden="true">{panel.badge}</span>}
              </button>
            ))}
          </div>
          <p className="settings-rail-footnote">Settings are per machine. Cloud consent is per project.</p>
        </aside>

        <div className="settings-content" id={`settings-panel-${settingsPanel}`} role="tabpanel" aria-labelledby={`settings-tab-${settingsPanel}`}>
          <header className="settings-header">
            <div>
              <h2 id="settings-panel-title">{panelTitle(settingsPanel)}</h2>
              <p>{panelDescription(settingsPanel)}</p>
            </div>
            <button type="button" className="btn subtle settings-close" onClick={onClose} aria-label="Close settings">
              ✕
            </button>
          </header>

          <div className="settings-content-body">
            {settingsPanel === 'ai' && <AiAssistancePanel />}
            {settingsPanel === 'connections' && <ConnectionsTabPanel />}
            {settingsPanel === 'diagnostics' && <DiagnosticsTabPanel />}
            {settingsPanel === 'general' && <GeneralSettingsPanel />}
          </div>
        </div>
      </section>
    </div>
  );
}
