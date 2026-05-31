import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const isDev = !app.isPackaged;
const recentProjectsPath = () => join(app.getPath('userData'), 'recent.json');

interface RecentProject {
  folderPath: string;
  lastOpenedAt: string;
}

async function readRecentProjects(): Promise<RecentProject[]> {
  try {
    const raw = await readFile(recentProjectsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentProject =>
        typeof item?.folderPath === 'string' && typeof item?.lastOpenedAt === 'string',
    );
  } catch {
    return [];
  }
}

async function writeRecentProjects(projects: RecentProject[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(recentProjectsPath(), JSON.stringify(projects, null, 2) + '\n', 'utf-8');
}

function registerIpcHandlers(): void {
  ipcMain.handle('project:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose Project Folder',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('project:recent-list', async () => readRecentProjects());

  ipcMain.handle('project:recent-add', async (_event, folderPath: string) => {
    if (typeof folderPath !== 'string' || folderPath.length === 0) return [];
    const now = new Date().toISOString();
    const rest = (await readRecentProjects()).filter((item) => item.folderPath !== folderPath);
    const next = [{ folderPath, lastOpenedAt: now }, ...rest].slice(0, 20);
    await writeRecentProjects(next);
    return next;
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e0f12',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch {
      // Deny malformed URLs.
    }
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
