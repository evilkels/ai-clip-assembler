import { contextBridge, ipcRenderer } from 'electron';
import type { ReviewModelAccountStatus } from '../shared/reviewModelAuth';
import type { UpdateStatus } from '../shared/updateStatus';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';
const BACKEND_URL_ARG = '--clip-assembler-backend-url=';

function resolveBackendUrl(): string {
  const arg = process.argv.find((value) => value.startsWith(BACKEND_URL_ARG));
  return arg?.slice(BACKEND_URL_ARG.length) ?? process.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

const bridge = {
  backendUrl: resolveBackendUrl(),
  platform: process.platform,
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder') as Promise<string | null>,
  listRecentProjects: () =>
    ipcRenderer.invoke('project:recent-list') as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
  getLastOpenedRecentProject: () =>
    ipcRenderer.invoke('project:recent-last-opened') as Promise<
      { folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean } | null
    >,
  addRecentProject: (folderPath: string, name?: string) =>
    ipcRenderer.invoke('project:recent-add', folderPath, name) as Promise<
      Array<{ folderPath: string; lastOpenedAt: string; name?: string; missing?: boolean }>
    >,
  renameRecentProject: (folderPath: string, name: string) =>
    ipcRenderer.invoke('project:recent-rename', folderPath, name) as Promise<
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
  setWindowTitle: (projectName?: string) => ipcRenderer.invoke('window:set-title', projectName),
  openInDaVinci: (exportPath: string, sourceFolder?: string) =>
    ipcRenderer.invoke('davinci:open-handoff', exportPath, sourceFolder) as Promise<{ opened: boolean }>,
  getReviewModelAccountStatus: () =>
    ipcRenderer.invoke('review-model-auth:status') as Promise<ReviewModelAccountStatus>,
  signInReviewModel: () =>
    ipcRenderer.invoke('review-model-auth:sign-in') as Promise<ReviewModelAccountStatus>,
  cancelReviewModelSignIn: () =>
    ipcRenderer.invoke('review-model-auth:cancel') as Promise<ReviewModelAccountStatus>,
  detectMcpClients: () =>
    ipcRenderer.invoke('mcp:detect-clients') as Promise<
      Array<{
        id: 'claude_desktop' | 'codex';
        name: string;
        configPath: string;
        installed: boolean;
        connected: boolean;
        needsRestart: boolean;
      }>
    >,
  checkForAppUpdate: (force?: boolean) =>
    ipcRenderer.invoke('update:check', force) as Promise<UpdateStatus>,
  dismissAppUpdate: (version: string) =>
    ipcRenderer.invoke('update:dismiss', version) as Promise<UpdateStatus>,
  openAppReleasePage: () =>
    ipcRenderer.invoke('update:open-release-page') as Promise<{ opened: boolean }>,
  connectMcpClient: (clientId: 'claude_desktop' | 'codex') =>
    ipcRenderer.invoke('mcp:connect-client', clientId) as Promise<{
      id: 'claude_desktop' | 'codex';
      name: string;
      configPath: string;
      installed: boolean;
      connected: boolean;
      needsRestart: boolean;
      backupPath?: string;
      snippet: string;
    }>,
};

contextBridge.exposeInMainWorld('clipAssembler', bridge);

export type ClipAssemblerBridge = typeof bridge;
