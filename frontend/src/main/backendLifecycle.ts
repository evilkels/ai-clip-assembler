import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, normalize } from 'node:path';

export interface RuntimeDescriptor {
  port: number;
  pid: number;
  active_project_id: string | null;
  updated_at: string;
}

export type ProcessInspector = (pid: number) => Promise<string | undefined>;
export type ProcessKiller = (pid: number, signal: NodeJS.Signals) => void;
export type ExitWaiter = (pid: number, signal: NodeJS.Signals, timeoutMs: number) => Promise<boolean>;

export type CleanupReason =
  | 'missing-runtime'
  | 'invalid-runtime'
  | 'not-running'
  | 'pid-reused'
  | 'terminated'
  | 'killed'
  | 'still-running';

export interface CleanupResult {
  cleaned: boolean;
  reason: CleanupReason;
}

export interface CleanupOptions {
  runtimeFile: string;
  backendExecutable: string;
  inspectProcessCommand?: ProcessInspector;
  killPid?: ProcessKiller;
  waitForExit?: ExitWaiter;
  terminateTimeoutMs?: number;
  killTimeoutMs?: number;
}

export type RuntimeToolStatus =
  | { ready: true; ffmpegPath: string; ffprobePath: string; toolDirectory: string }
  | {
    ready: false;
    reason: 'missing-ffmpeg' | 'missing-ffprobe' | 'not-executable' | 'missing-vidstabdetect' | 'preflight-failed';
    detail: string;
  };

export interface RuntimeToolPreflightOptions {
  ffmpegPath: string;
  ffprobePath: string;
  access?: (path: string) => Promise<void>;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

async function runRuntimeToolPreflightCommand(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function preflightRuntimeTools(options: RuntimeToolPreflightOptions): Promise<RuntimeToolStatus> {
  const checkAccess = options.access ?? ((path: string) => access(path, constants.X_OK));
  try {
    await checkAccess(options.ffmpegPath);
  } catch {
    return { ready: false, reason: 'missing-ffmpeg', detail: 'Bundled ffmpeg was not found or is not executable.' };
  }
  try {
    await checkAccess(options.ffprobePath);
  } catch {
    return { ready: false, reason: 'missing-ffprobe', detail: 'Bundled ffprobe was not found or is not executable.' };
  }

  try {
    const run = options.execFile ?? runRuntimeToolPreflightCommand;
    const output = await run(options.ffmpegPath, ['-hide_banner', '-filters']);
    if (!`${output.stdout}\n${output.stderr}`.includes('vidstabdetect')) {
      return {
        ready: false,
        reason: 'missing-vidstabdetect',
        detail: 'Bundled ffmpeg does not include the required vidstabdetect filter.',
      };
    }
  } catch {
    return { ready: false, reason: 'preflight-failed', detail: 'Bundled ffmpeg could not complete its startup check.' };
  }

  return {
    ready: true,
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath,
    toolDirectory: dirname(options.ffmpegPath),
  };
}

function isRuntimeDescriptor(value: unknown): value is RuntimeDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Partial<RuntimeDescriptor>;
  return (
    typeof descriptor.port === 'number' &&
    Number.isInteger(descriptor.port) &&
    descriptor.port > 0 &&
    typeof descriptor.pid === 'number' &&
    Number.isInteger(descriptor.pid) &&
    descriptor.pid > 0 &&
    (typeof descriptor.active_project_id === 'string' || descriptor.active_project_id === null) &&
    typeof descriptor.updated_at === 'string'
  );
}

export async function readRuntimeDescriptor(runtimeFile: string): Promise<RuntimeDescriptor | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(runtimeFile, 'utf-8'));
    return isRuntimeDescriptor(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function removeRuntimeDescriptor(runtimeFile: string): Promise<void> {
  try {
    await unlink(runtimeFile);
  } catch {
    // Missing or locked runtime descriptors are non-fatal; the backend rewrites
    // the descriptor after startup.
  }
}

export function runtimeDescriptorMatchesBackend(
  command: string | undefined,
  options: { pid: number; command?: string; backendExecutable: string },
): boolean {
  const inspectedCommand = command ?? options.command;
  if (!inspectedCommand) return false;
  const executable = normalize(options.backendExecutable);
  const executableName = basename(executable);
  return inspectedCommand.includes(executable) || inspectedCommand.includes(executableName);
}

export async function inspectProcessCommand(pid: number): Promise<string | undefined> {
  const command: { file: string; args: string[] } = process.platform === 'win32'
    ? { file: 'wmic', args: ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'] }
    : { file: 'ps', args: ['-p', String(pid), '-o', 'command='] };

  return new Promise((resolve) => {
    execFileCallback(command.file, command.args, { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.length > 0 && !value.startsWith('CommandLine='));
      if (line) {
        resolve(line);
        return;
      }
      const commandLine = stdout.match(/CommandLine=(.*)/)?.[1]?.trim();
      resolve(commandLine || undefined);
    });
  });
}

export function killPid(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function isProcessNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ESRCH',
  );
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessExit(pid: number, _signal: NodeJS.Signals, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

export async function cleanupStaleBackend(options: CleanupOptions): Promise<CleanupResult> {
  const descriptor = await readRuntimeDescriptor(options.runtimeFile);
  if (!descriptor) {
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: false, reason: 'missing-runtime' };
  }

  const inspect = options.inspectProcessCommand ?? inspectProcessCommand;
  const command = await inspect(descriptor.pid);
  if (!command) {
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: true, reason: 'not-running' };
  }

  if (!runtimeDescriptorMatchesBackend(command, { pid: descriptor.pid, backendExecutable: options.backendExecutable })) {
    return { cleaned: false, reason: 'pid-reused' };
  }

  const killer = options.killPid ?? killPid;
  const wait = options.waitForExit ?? waitForProcessExit;
  const terminateTimeoutMs = options.terminateTimeoutMs ?? 2500;
  const killTimeoutMs = options.killTimeoutMs ?? 1500;
  try {
    killer(descriptor.pid, 'SIGTERM');
  } catch (error) {
    if (!isProcessNotFoundError(error)) throw error;
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: true, reason: 'not-running' };
  }
  if (await wait(descriptor.pid, 'SIGTERM', terminateTimeoutMs)) {
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: true, reason: 'terminated' };
  }

  try {
    killer(descriptor.pid, 'SIGKILL');
  } catch (error) {
    if (!isProcessNotFoundError(error)) throw error;
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: true, reason: 'not-running' };
  }
  if (await wait(descriptor.pid, 'SIGKILL', killTimeoutMs)) {
    await removeRuntimeDescriptor(options.runtimeFile);
    return { cleaned: true, reason: 'killed' };
  }

  return { cleaned: false, reason: 'still-running' };
}

export async function findFreePort(): Promise<number> {
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

export async function waitForBackend(backendUrl: string, timeoutMs = 15000): Promise<void> {
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

export async function waitForRuntimeDescriptorPort(runtimeFile: string, port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptor = await readRuntimeDescriptor(runtimeFile);
    if (descriptor?.port === port) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Backend runtime descriptor did not update for port ${port}`);
}
