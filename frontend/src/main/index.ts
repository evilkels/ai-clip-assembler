import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { connectMcpClient, detectMcpClients, type McpClientId } from './mcpConnect';

const isDev = !app.isPackaged;
const recentProjectsPath = () => join(app.getPath('userData'), 'recent.json');
const runtimeFilePath = () => join(app.getPath('userData'), '.ai-clip-assembler', 'runtime.json');
let backendProcess: ChildProcessWithoutNullStreams | undefined;
let packagedBackendUrl: string | undefined;

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

function packagedBackendExecutablePath(): string {
  return join(process.resourcesPath, 'backend', 'ai-clip-backend');
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

  ipcMain.handle('mcp:detect-clients', async () => {
    return detectMcpClients(packagedBackendExecutablePath(), runtimeFilePath());
  });

  ipcMain.handle('mcp:connect-client', async (_event, clientId: McpClientId) => {
    return connectMcpClient(clientId, packagedBackendExecutablePath(), runtimeFilePath());
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

function resolveOptionalAssetPath(filename: string): string | undefined {
  const assetPath = resolveAssetPath(filename);
  return existsSync(assetPath) ? assetPath : undefined;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) resolve(address.port);
        else reject(new Error('Could not allocate a backend port'));
      });
    });
  });
}

async function waitForBackend(backendUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${backendUrl}/`, { cache: 'no-store' });
      if (res.ok) return;
      lastError = new Error(`Backend health check returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error('Backend health check timed out');
}

async function resolvePiBinFromLoginShell(): Promise<string | undefined> {
  if (process.env.PI_BIN) return process.env.PI_BIN;
  if (process.platform !== 'darwin') return undefined;

  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', 'command -v pi'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }

      const piBin = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(piBin);
    });
  });
}

function buildPackagedBackendPath(piBin: string | undefined): string {
  const paths = [
    piBin ? dirname(piBin) : undefined,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(paths)].join(':');
}

async function startPackagedBackend(): Promise<void> {
  if (!app.isPackaged) return;

  const backendExecutable = packagedBackendExecutablePath();
  const runtimeFile = runtimeFilePath();
  if (!existsSync(backendExecutable)) {
    throw new Error(`Packaged backend not found at ${backendExecutable}`);
  }

  const port = await findFreePort();
  const backendUrl = `http://127.0.0.1:${port}`;
  const piBin = await resolvePiBinFromLoginShell();
  const extraPath = buildPackagedBackendPath(piBin);
  backendProcess = spawn(backendExecutable, [], {
    cwd: app.getPath('userData'),
    env: {
      ...process.env,
      CLIP_ASSEMBLER_PORT: String(port),
      CLIP_ASSEMBLER_RUNTIME_FILE: runtimeFile,
      PATH: extraPath,
      ...(piBin ? { PI_BIN: piBin } : {}),
      PYTHONUNBUFFERED: '1',
    },
  });

  backendProcess.stdout.on('data', (chunk) => console.log(`[backend] ${chunk.toString().trimEnd()}`));
  backendProcess.stderr.on('data', (chunk) => console.error(`[backend] ${chunk.toString().trimEnd()}`));
  backendProcess.once('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[backend] exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    }
  });

  await waitForBackend(backendUrl);
  packagedBackendUrl = backendUrl;
}

function stopPackagedBackend(): void {
  if (!backendProcess || backendProcess.killed) return;
  backendProcess.kill();
  backendProcess = undefined;
}

function createWindow(): void {
  const icon = resolveOptionalAssetPath('icon.png');
  const additionalArguments = packagedBackendUrl
    ? [`--clip-assembler-backend-url=${packagedBackendUrl}`]
    : [];
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
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments,
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

app.whenReady()
  .then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      const icon = resolveOptionalAssetPath('icon.png');
      if (icon) app.dock.setIcon(icon);
    }
    await startPackagedBackend();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('AI Clip Assembler failed to start', message);
    app.quit();
  });

app.on('will-quit', stopPackagedBackend);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
