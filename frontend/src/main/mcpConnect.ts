import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type McpClientId = 'claude_desktop' | 'codex';

export interface McpClientStatus {
  id: McpClientId;
  name: string;
  configPath: string;
  installed: boolean;
  connected: boolean;
  needsRestart: boolean;
  /** Set when the client's config exists but could not be read — connect is unsafe. */
  detectError?: string;
}

export interface McpConnectResult extends McpClientStatus {
  backupPath?: string;
  snippet: string;
}

const SERVER_NAME = 'ai-clip-assembler';
const CODEX_SECTION = `[mcp_servers.${SERVER_NAME}]`;

function serverConfig(command: string, runtimeFile: string) {
  return { command, args: ['--mcp-stdio', '--runtime-file', runtimeFile] };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function claudeConfigPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

export function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

export function mergeClaudeConfig(raw: string, command: string, runtimeFile: string): string {
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  const next = {
    ...parsed,
    mcpServers: {
      ...(parsed.mcpServers ?? {}),
      [SERVER_NAME]: serverConfig(command, runtimeFile),
    },
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}

export function mergeCodexConfig(raw: string, command: string, runtimeFile: string): string {
  const lines = raw.split(/\r?\n/);
  const filtered: string[] = [];
  let skippingServerSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === CODEX_SECTION) {
      skippingServerSection = true;
      continue;
    }
    if (skippingServerSection && trimmed.startsWith('[')) {
      skippingServerSection = false;
    }
    if (!skippingServerSection) filtered.push(line);
  }

  const suffix = [
    CODEX_SECTION,
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(['--mcp-stdio', '--runtime-file', runtimeFile])}`,
  ].join('\n');
  const prefix = filtered.join('\n').trimEnd();
  return `${prefix ? `${prefix}\n\n` : ''}${suffix}\n`;
}

/**
 * Reads a client config. Only a genuinely missing file maps to '' — any other
 * read failure (permissions, IO) throws, because treating it as empty would
 * let a later merge overwrite the user's real config with just our entry.
 */
async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function writeWithBackup(path: string, content: string): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (existsSync(path)) {
    backupPath = `${path}.${timestamp()}.bak`;
    await copyFile(path, backupPath);
  }
  // Atomic replace: a crash mid-write must not leave the client's config truncated.
  const tempPath = `${path}.${timestamp()}.tmp`;
  try {
    await writeFile(tempPath, content, 'utf-8');
    if (backupPath) {
      // Preserve the original mode — the config may be 0600 and hold secrets.
      await chmod(tempPath, (await stat(path)).mode);
    }
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  return backupPath;
}

function snippetFor(clientId: McpClientId, command: string, runtimeFile: string): string {
  if (clientId === 'claude_desktop') {
    return JSON.stringify({ mcpServers: { [SERVER_NAME]: serverConfig(command, runtimeFile) } }, null, 2);
  }
  return [
    CODEX_SECTION,
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(['--mcp-stdio', '--runtime-file', runtimeFile])}`,
  ].join('\n');
}

function isClientConnected(raw: string, command: string, runtimeFile: string): boolean {
  return raw.includes(SERVER_NAME) && raw.includes(command) && raw.includes(runtimeFile);
}

export async function detectMcpClients(command: string, runtimeFile: string): Promise<McpClientStatus[]> {
  const clients: Array<{ id: McpClientId; name: string; configPath: string }> = [
    { id: 'claude_desktop', name: 'Claude Desktop', configPath: claudeConfigPath() },
    { id: 'codex', name: 'Codex', configPath: codexConfigPath() },
  ];
  return Promise.all(
    clients.map(async (client) => {
      const installed =
        client.id === 'claude_desktop'
          ? existsSync('/Applications/Claude.app') || existsSync(dirname(client.configPath))
          : existsSync(dirname(client.configPath));
      let raw = '';
      let detectError: string | undefined;
      try {
        raw = await readConfig(client.configPath);
      } catch (error) {
        detectError = error instanceof Error ? error.message : String(error);
      }
      const connected = !detectError && isClientConnected(raw, command, runtimeFile);
      return {
        id: client.id,
        name: client.name,
        configPath: client.configPath,
        installed,
        connected,
        needsRestart: connected,
        ...(detectError ? { detectError } : {}),
      };
    }),
  );
}

export async function connectMcpClient(
  clientId: McpClientId,
  command: string,
  runtimeFile: string,
): Promise<McpConnectResult> {
  if (clientId !== 'claude_desktop' && clientId !== 'codex') {
    throw new Error(`Unsupported MCP client: ${clientId}`);
  }
  const configPath = clientId === 'claude_desktop' ? claudeConfigPath() : codexConfigPath();
  const raw = await readConfig(configPath);
  const next =
    clientId === 'claude_desktop'
      ? mergeClaudeConfig(raw, command, runtimeFile)
      : mergeCodexConfig(raw, command, runtimeFile);
  const backupPath = await writeWithBackup(configPath, next);
  const status = (await detectMcpClients(command, runtimeFile)).find((item) => item.id === clientId);
  if (!status) throw new Error(`Unsupported MCP client: ${clientId}`);
  return { ...status, backupPath, snippet: snippetFor(clientId, command, runtimeFile) };
}
