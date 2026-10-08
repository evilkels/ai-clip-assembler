import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { SettingsModal, type SettingsPanel } from '../components/SettingsModal';

const SettingsPanelContext = createContext<((panel: SettingsPanel) => void) | null>(null);

export function SettingsPanelProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ panel: SettingsPanel; id: number } | null>(null);
  const requestId = useRef(0);
  const openSettings = useCallback((panel: SettingsPanel) => {
    requestId.current += 1;
    setRequest({ panel, id: requestId.current });
  }, []);

  return (
    <SettingsPanelContext.Provider value={openSettings}>
      {children}
      {request && (
        <SettingsModal key={request.id} initialPanel={request.panel} onClose={() => setRequest(null)} />
      )}
    </SettingsPanelContext.Provider>
  );
}

export function useOpenSettings(): (panel: SettingsPanel) => void {
  const openSettings = useContext(SettingsPanelContext);
  if (!openSettings) throw new Error('useOpenSettings must be used within SettingsPanelProvider');
  return openSettings;
}
