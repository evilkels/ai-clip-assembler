import { execFile as execFileCallback } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

/**
 * The only Tailscale commands Remote View may run.
 *
 * The argv builders below are the single way an argv is produced: they take
 * validated inputs and emit exactly `status`, `serve status`, `serve add` or
 * `serve off`. Nothing here can produce `serve reset` or `funnel`; the exec
 * wrapper refuses any argv it did not get from a builder.
 */

export const CLI_CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
] as const;

export const SERVE_MOUNT = '/remote';
export const CLI_TIMEOUT_MS = 10_000;
export const MIN_PORT = 1024;
export const MAX_PORT = 65_535;

declare const argvBrand: unique symbol;
/** An argv built by one of the four builders. */
export type TailscaleArgv = readonly string[] & { readonly [argvBrand]: true };

const TARGET_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9_-]{16,}\/$/;
const BUILT = new WeakSet<object>();

function brand(argv: string[]): TailscaleArgv {
  const frozen = Object.freeze(argv) as unknown as TailscaleArgv;
  BUILT.add(frozen);
  return frozen;
}

export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function assertPort(port: unknown): number {
  if (!isValidPort(port)) throw new Error(`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
  return port;
}

export function statusArgv(): TailscaleArgv {
  return brand(['status', '--json']);
}

export function serveStatusArgv(): TailscaleArgv {
  return brand(['serve', 'status', '--json']);
}

export function serveAddArgv(port: number, target: string): TailscaleArgv {
  if (!TARGET_PATTERN.test(target)) {
    throw new Error('Serve target must be a loopback URL with an ingress path');
  }
  return brand(['serve', '--bg', `--https=${assertPort(port)}`, `--set-path=${SERVE_MOUNT}`, target]);
}

export function serveOffArgv(port: number): TailscaleArgv {
  return brand(['serve', '--bg', `--https=${assertPort(port)}`, `--set-path=${SERVE_MOUNT}`, 'off']);
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<ExecResult>;

export const defaultExecFile: ExecFile = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFileCallback(file, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

export function locateTailscaleCli(
  isExecutable: (path: string) => boolean = (path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): string | undefined {
  return CLI_CANDIDATES.find((candidate) => isExecutable(candidate));
}

// --- parsed shapes ------------------------------------------------------------

export interface TailscalePeer {
  userId?: number;
  os?: string;
  online: boolean;
  active: boolean;
  /** Set when the peer is reached directly; empty when relayed. */
  curAddr: string;
  relay: string;
}

export interface TailscaleStatus {
  backendState: string;
  running: boolean;
  /** `Self.DNSName` without the trailing dot. */
  host: string;
  ownerLogin: string;
  peers: TailscalePeer[];
}

export interface ServeHandler {
  Proxy?: string;
  Path?: string;
  Text?: string;
  Redirect?: string;
}

export interface ServeConfig {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean; TCPForward?: string }>;
  Web?: Record<string, { Handlers?: Record<string, ServeHandler> }>;
  AllowFunnel?: Record<string, boolean>;
  [key: string]: unknown;
}

export function parseStatus(raw: string): TailscaleStatus {
  const json = JSON.parse(raw) as {
    BackendState?: string;
    Self?: { DNSName?: string; UserID?: number };
    User?: Record<string, { LoginName?: string }>;
    Peer?: Record<string, {
      UserID?: number;
      OS?: string;
      Online?: boolean;
      Active?: boolean;
      CurAddr?: string;
      Relay?: string;
    }>;
  };
  const backendState = json.BackendState ?? '';
  const host = (json.Self?.DNSName ?? '').replace(/\.$/, '');
  const userId = json.Self?.UserID;
  const ownerLogin = userId === undefined ? '' : json.User?.[String(userId)]?.LoginName ?? '';
  const peers = Object.values(json.Peer ?? {}).map((peer) => ({
    userId: peer.UserID,
    os: peer.OS,
    online: peer.Online === true,
    active: peer.Active === true,
    curAddr: peer.CurAddr ?? '',
    relay: peer.Relay ?? '',
  }));
  return { backendState, running: backendState === 'Running', host, ownerLogin, peers };
}

export function parseServeConfig(raw: string): ServeConfig {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return {};
  const parsed: unknown = JSON.parse(trimmed);
  return parsed && typeof parsed === 'object' ? (parsed as ServeConfig) : {};
}

export class TailscaleCli {
  constructor(
    private readonly binary: string,
    private readonly execFile: ExecFile = defaultExecFile,
  ) {}

  private async run(argv: TailscaleArgv): Promise<ExecResult> {
    if (!BUILT.has(argv as object)) throw new Error('Refusing a Tailscale command that was not built by an argv builder');
    return this.execFile(this.binary, argv, CLI_TIMEOUT_MS);
  }

  async status(): Promise<TailscaleStatus> {
    return parseStatus((await this.run(statusArgv())).stdout);
  }

  async serveStatus(): Promise<ServeConfig> {
    return parseServeConfig((await this.run(serveStatusArgv())).stdout);
  }

  async serveAdd(port: number, target: string): Promise<void> {
    await this.run(serveAddArgv(port, target));
  }

  async serveOff(port: number): Promise<void> {
    await this.run(serveOffArgv(port));
  }
}

/** The Serve key for a host and port. */
export function serveKey(host: string, port: number): string {
  return `${host}:${port}`;
}
