import { contextBridge, ipcRenderer } from 'electron';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

const bridge = {
  backendUrl: process.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL,
  platform: process.platform,
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder') as Promise<string | null>,
  listRecentProjects: () =>
    ipcRenderer.invoke('project:recent-list') as Promise<
      Array<{ folderPath: string; lastOpenedAt: string }>
    >,
  addRecentProject: (folderPath: string) =>
    ipcRenderer.invoke('project:recent-add', folderPath) as Promise<
      Array<{ folderPath: string; lastOpenedAt: string }>
    >,
};

contextBridge.exposeInMainWorld('clipAssembler', bridge);

export type ClipAssemblerBridge = typeof bridge;
