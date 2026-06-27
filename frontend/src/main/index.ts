import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const isDev = !app.isPackaged;
const recentProjectsPath = () => join(app.getPath('userData'), 'recent.json');

interface RecentProject {
  folderPath: string;
  lastOpenedAt: string;
  name?: string;
  missing?: boolean;
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

async function enrichRecentProjects(): Promise<RecentProject[]> {
  const projects = await readRecentProjects();
  return Promise.all(
    projects.map(async (project) => {
      try {
        await stat(project.folderPath);
        return { ...project, missing: false };
      } catch {
        return { ...project, missing: true };
      }
    }),
  );
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

  ipcMain.handle('project:recent-list', async () => enrichRecentProjects());

  ipcMain.handle('project:recent-add', async (_event, folderPath: string, name?: string) => {
    if (typeof folderPath !== 'string' || folderPath.length === 0) return [];
    const now = new Date().toISOString();
    const rest = (await readRecentProjects()).filter((item) => item.folderPath !== folderPath);
    const next = [{ folderPath, lastOpenedAt: now, name }, ...rest].slice(0, 20);
    await writeRecentProjects(next);
    return enrichRecentProjects();
  });

  ipcMain.handle('project:recent-remove', async (_event, folderPath: string) => {
    const next = (await readRecentProjects()).filter((item) => item.folderPath !== folderPath);
    await writeRecentProjects(next);
    return enrichRecentProjects();
  });

  ipcMain.handle('project:recent-relocate', async (_event, oldFolderPath: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Locate Project Folder',
    });
    if (result.canceled || !result.filePaths[0]) return enrichRecentProjects();
    const newFolderPath = result.filePaths[0];
    const now = new Date().toISOString();
    const projects = await readRecentProjects();
    const previous = projects.find((item) => item.folderPath === oldFolderPath);
    const rest = projects.filter((item) => item.folderPath !== oldFolderPath && item.folderPath !== newFolderPath);
    const next = [
      {
        folderPath: newFolderPath,
        lastOpenedAt: now,
        name: previous?.name,
      },
      ...rest,
    ].slice(0, 20);
    await writeRecentProjects(next);
    return enrichRecentProjects();
  });

  ipcMain.handle('window:set-title', (event, projectName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setTitle(projectName ? `AI Clip Assembler — ${projectName}` : 'AI Clip Assembler');
  });

  ipcMain.handle('davinci:open-handoff', async (_event, exportPath: string, sourceFolder?: string) => {
    if (typeof exportPath !== 'string' || !exportPath.toLowerCase().endsWith('.xml')) {
      throw new Error('A DaVinci Resolve XML export is required');
    }
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', ['-a', 'DaVinci Resolve', exportPath], (error) => {
          if (error) reject(new Error('DaVinci Resolve could not be opened. Install it or import the XML manually.'));
          else resolve();
        });
      });
    } else {
      const error = await shell.openPath(exportPath);
      if (error) throw new Error(error);
    }
    if (sourceFolder) shell.showItemInFolder(sourceFolder);
    return { opened: true };
  });
}

function resolveAssetPath(filename: string): string {
  // In packaged builds assets live under resources/assets, in dev they sit
  // next to the compiled main bundle under build/.
  const packaged = join(process.resourcesPath ?? '', 'assets', filename);
  if (!app.isPackaged) {
    return join(__dirname, '..', '..', 'build', filename);
  }
  return packaged;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // Match the OS appearance so there's no light/dark flash before the
    // renderer paints. The renderer can still override the theme at runtime.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0f12' : '#eceef2',
    title: 'AI Clip Assembler',
    show: false,
    icon: resolveAssetPath('icon.png'),
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
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(resolveAssetPath('icon.png'));
  }
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
