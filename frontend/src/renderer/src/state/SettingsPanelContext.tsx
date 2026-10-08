import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { SettingsModal, type SettingsPanel } from '../components/SettingsModal';

const SettingsPanelContext = createContext<((panel: SettingsPanel) => void) | null>(null);

export function SettingsPanelProvider({ children }: { children: ReactNode }) {
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel | null>(null);
  const openSettings = useCallback((panel: SettingsPanel) => setSettingsPanel(panel), []);

  return (
    <SettingsPanelContext.Provider value={openSettings}>
      {children}
      {settingsPanel && (
        <SettingsModal initialPanel={settingsPanel} onClose={() => setSettingsPanel(null)} />
      )}
    </SettingsPanelContext.Provider>
  );
}

export function useOpenSettings(): (panel: SettingsPanel) => void {
  const openSettings = useContext(SettingsPanelContext);
  if (!openSettings) throw new Error('useOpenSettings must be used within SettingsPanelProvider');
  return openSettings;
}
