import { contextBridge, ipcRenderer } from 'electron';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

const bridge = {
  backendUrl: process.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL,
  platform: process.platform,
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder') as Promise<string | null>,
  listRecentProjects: () =>
    ipcRenderer.invoke('project:recent-list') as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
  addRecentProject: (folderPath: string, name?: string) =>
    ipcRenderer.invoke('project:recent-add', folderPath, name) as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
  removeRecentProject: (folderPath: string) =>
    ipcRenderer.invoke('project:recent-remove', folderPath) as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
  relocateRecentProject: (folderPath: string) =>
    ipcRenderer.invoke('project:recent-relocate', folderPath) as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
};

contextBridge.exposeInMainWorld('clipAssembler', bridge);

export type ClipAssemblerBridge = typeof bridge;
