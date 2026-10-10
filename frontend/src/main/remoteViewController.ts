import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isValidPort,
  serveKey,
  SERVE_MOUNT,
  type ServeConfig,
  type TailscaleCli,
  type TailscaleStatus,
} from './tailscaleCli';

/**
 * Remote View's Mac-side orchestration: Tailscale Serve ownership, the backend
 * lease, readiness, pairing administration and conflict handling.
 *
 * Security rules this file enforces:
 * - Serve is the only exposure; the CLI wrapper cannot produce `funnel` or
 *   `serve reset`.
 * - The app adds or removes only a handler it can prove is its own: the live
 *   handler must equal the target recorded in `serve-owner.json`.
 * - Every other Serve entry is checked unchanged after each change.
 * - A conflict (Funnel, foreign handler, changed target, other account) turns
 *   Remote View off, backend first. Turning it back on is a deliberate action.
 */

export const DEFAULT_PORT = 8448;
export const WATCH_INTERVAL_MS = 5000;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEALTH_TIMEOUT_MS = 120_000;
export const HEALTH_INTERVAL_MS = 2000;

export type StepId = 'installed' | 'signedIn' | 'certificate' | 'port' | 'serving';
export type StepStatus = 'todo' | 'working' | 'ok' | 'blocked';

export interface ReadinessStep {
  id: StepId;
  status: StepStatus;
  detail?: string;
}

export type ConflictKind =
  | 'port-in-use'
  | 'funnel'
  | 'handler-changed'
  | 'account-changed'
  | 'unreachable'
  | 'backend-stopped';

export interface RemoteConflict {
  kind: ConflictKind;
  message: string;
}

export interface PendingPairing {
  pending_id: string;
  label: string;
  user_agent: string;
  login: string;
  created_at: number;
  expires_at: number;
}

export interface PairedDeviceInfo {
  device_id: string;
  label: string;
  user_agent: string;
  login: string;
  approved_at: number;
  last_seen: number;
  connected: boolean;
}

export interface ExposureInfo {
  project_uuid: string;
  folder_path: string;
  shown: boolean;
}

export interface RemoteViewState {
  /** `backend-not-managed`: the app did not start its own backend (plain dev flow). */
  unavailable?: 'backend-not-managed';
  enabled: boolean;
  status: 'off' | 'starting' | 'on' | 'conflict' | 'error';
  port: number;
  host?: string;
  /** `https://<host>:<port>/remote/` once serving. */
  url?: string;
  ownerLogin?: string;
  steps: ReadinessStep[];
  message?: string;
  conflict?: RemoteConflict;
  accountChange?: { previous: string; current: string };
  pending: PendingPairing[];
  devices: PairedDeviceInfo[];
  connected: number;
  exposure: ExposureInfo[];
  keepAwake: boolean;
  networkPath: 'direct' | 'relayed' | 'unknown';
}

export interface PairingCode {
  url: string;
  token: string;
  expiresAt: number;
  qrSvg?: string;
}

export interface BackendEvent {
  event?: string;
  [key: string]: unknown;
}

/** The control channel to the backend (see `remoteControlChannel.ts`). */
export interface BackendControl {
  request(type: string, fields?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  onEvent(listener: (event: BackendEvent) => void): () => void;
  /** Fires once when the backend end of the channel is gone (EOF or error). */
  onLost(listener: () => void): () => void;
}

export interface ServeOwnerRecord {
  host: string;
  port: number;
  mount: string;
  target: string;
  ownerLogin: string;
}

interface Prefs {
  keepAwake: boolean;
  port: number;
  ownerLogin?: string;
}

export interface RemoteViewDeps {
  /** `userData/remote-view`. */
  directory: string;
  /** Resolved lazily so a freshly installed Tailscale is picked up. */
  getCli: () => TailscaleCli | undefined;
  backend: BackendControl | undefined;
  macName: () => string;
  fetchHealth?: (url: string) => Promise<{ instance?: string } | undefined>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  renderQr?: (url: string) => Promise<string>;
  powerSave?: { start: () => number; stop: (id: number) => void };
  setWatchTimer?: (tick: () => void, ms: number) => () => void;
  log?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultFetchHealth = async (url: string): Promise<{ instance?: string } | undefined> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    return (await response.json()) as { instance?: string };
  } catch {
    return undefined;
  }
};

const defaultWatchTimer = (tick: () => void, ms: number) => {
  const timer = setInterval(tick, ms);
  timer.unref?.();
  return () => clearInterval(timer);
};

// --- pure Serve inspection -----------------------------------------------------------

export type PortVerdict =
  | { ok: true; ownedStale: boolean }
  | { ok: false; conflict: RemoteConflict };

export function conflictCopy(kind: 'port-in-use' | 'funnel', port: number): string {
  return kind === 'port-in-use'
    ? `Remote View is off: port ${port} is in use by another app. Nothing else was changed. Choose another port.`
    : `Remote View is off: port ${port} has Funnel on. Nothing else was changed. Choose another port.`;
}

export function isOwnedHandler(
  cfg: ServeConfig,
  record: ServeOwnerRecord | undefined,
  host: string,
  port: number,
): boolean {
  if (!record || record.host !== host || record.port !== port || record.mount !== SERVE_MOUNT) return false;
  return cfg.Web?.[serveKey(host, port)]?.Handlers?.[SERVE_MOUNT]?.Proxy === record.target;
}

/** Preflight: may we use `<host>:<port>`? Only our own recorded handler may already be there. */
export function checkPort(
  cfg: ServeConfig,
  host: string,
  port: number,
  record: ServeOwnerRecord | undefined,
): PortVerdict {
  const key = serveKey(host, port);
  if (cfg.AllowFunnel?.[key] === true) {
    return { ok: false, conflict: { kind: 'funnel', message: conflictCopy('funnel', port) } };
  }
  const handlers = cfg.Web?.[key]?.Handlers ?? {};
  const owned = isOwnedHandler(cfg, record, host, port);
  const foreign = Object.keys(handlers).filter((path) => !(owned && path === SERVE_MOUNT));
  const tcp = cfg.TCP?.[String(port)];
  const tcpTaken = tcp !== undefined && !tcp.HTTPS && !owned;
  if (foreign.length > 0 || tcpTaken || (tcp?.HTTPS && !cfg.Web?.[key])) {
    return { ok: false, conflict: { kind: 'port-in-use', message: conflictCopy('port-in-use', port) } };
  }
  return { ok: true, ownedStale: owned };
}

/** The config with our handler (and the TCP entry it implies) removed, for before/after comparison. */
export function withoutOurHandler(cfg: ServeConfig, host: string, port: number): ServeConfig {
  const copy = JSON.parse(JSON.stringify(cfg)) as ServeConfig;
  const key = serveKey(host, port);
  const web = copy.Web?.[key];
  if (web?.Handlers) {
    delete web.Handlers[SERVE_MOUNT];
    if (Object.keys(web.Handlers).length === 0) {
      delete copy.Web![key];
      if (copy.TCP) delete copy.TCP[String(port)];
    }
  }
  if (copy.Web && Object.keys(copy.Web).length === 0) delete copy.Web;
  if (copy.TCP && Object.keys(copy.TCP).length === 0) delete copy.TCP;
  return copy;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameConfig(a: ServeConfig, b: ServeConfig): boolean {
  return stable(a) === stable(b);
}

export function networkPathFromStatus(status: TailscaleStatus): 'direct' | 'relayed' | 'unknown' {
  const mine = status.peers.filter((peer) => peer.active && peer.os === 'iOS');
  if (mine.length === 0) return 'unknown';
  if (mine.some((peer) => peer.curAddr)) return 'direct';
  return mine.some((peer) => peer.relay) ? 'relayed' : 'unknown';
}

// --- small file helpers -------------------------------------------------------------

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonPrivate(path: string, value: unknown, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await rename(temp, path);
}

// --- the controller --------------------------------------------------------------------

const STEP_ORDER: StepId[] = ['installed', 'signedIn', 'certificate', 'port', 'serving'];

function freshSteps(): ReadinessStep[] {
  return STEP_ORDER.map((id) => ({ id, status: 'todo' }));
}

export class RemoteViewController {
  private readonly deps: RemoteViewDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly listeners = new Set<(state: RemoteViewState) => void>();
  private prefs: Prefs = { keepAwake: true, port: DEFAULT_PORT };
  private prefsLoaded = false;
  private state: RemoteViewState;
  private record: ServeOwnerRecord | undefined;
  private busy = false;
  private stopWatching: (() => void) | undefined;
  private powerSaveId: number | undefined;
  private currentHost: string | undefined;
  private currentOwner: string | undefined;
  private unsubscribers: Array<() => void> = [];
  private lastPath: 'direct' | 'relayed' | 'unknown' = 'unknown';
  private backendDisableTask: Promise<void> | undefined;

  constructor(deps: RemoteViewDeps) {
    this.deps = deps;
    this.sleep = deps.sleep ?? defaultSleep;
    this.state = this.baseState();
    if (deps.backend) {
      this.unsubscribers.push(deps.backend.onEvent((event) => this.handleBackendEvent(event)));
      this.unsubscribers.push(deps.backend.onLost(() => void this.handleBackendLost()));
    }
  }

  // -- state ----------------------------------------------------------------------

  private baseState(): RemoteViewState {
    return {
      ...(this.deps.backend ? {} : { unavailable: 'backend-not-managed' as const }),
      enabled: false,
      status: 'off',
      port: this.prefs.port,
      steps: freshSteps(),
      pending: [],
      devices: [],
      connected: 0,
      exposure: [],
      keepAwake: this.prefs.keepAwake,
      networkPath: 'unknown',
    };
  }

  private recordPath(): string {
    return join(this.deps.directory, 'serve-owner.json');
  }

  private prefsPath(): string {
    return join(this.deps.directory, 'prefs.json');
  }

  private async loadPrefs(): Promise<void> {
    if (this.prefsLoaded) return;
    this.prefsLoaded = true;
    const stored = await readJson<Partial<Prefs>>(this.prefsPath());
    if (stored) {
      this.prefs = {
        keepAwake: stored.keepAwake !== false,
        port: isValidPort(stored.port) ? stored.port : DEFAULT_PORT,
        ownerLogin: typeof stored.ownerLogin === 'string' ? stored.ownerLogin : undefined,
      };
    }
    this.state = { ...this.state, port: this.prefs.port, keepAwake: this.prefs.keepAwake };
  }

  private async savePrefs(): Promise<void> {
    await writeJsonPrivate(this.prefsPath(), this.prefs, this.deps.directory);
  }

  private async loadRecord(): Promise<ServeOwnerRecord | undefined> {
    const stored = await readJson<ServeOwnerRecord>(this.recordPath());
    this.record =
      stored && typeof stored.host === 'string' && typeof stored.target === 'string' && isValidPort(stored.port)
        ? stored
        : undefined;
    return this.record;
  }

  private async saveRecord(record: ServeOwnerRecord): Promise<void> {
    this.record = record;
    await writeJsonPrivate(this.recordPath(), record, this.deps.directory);
  }

  private async clearRecord(): Promise<void> {
    this.record = undefined;
    try {
      await unlink(this.recordPath());
    } catch {
      // already gone
    }
  }

  private set(patch: Partial<RemoteViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private setStep(id: StepId, status: StepStatus, detail?: string): void {
    this.set({
      steps: this.state.steps.map((step) => (step.id === id ? { id, status, ...(detail ? { detail } : {}) } : step)),
    });
  }

  onChange(listener: (state: RemoteViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getState(): Promise<RemoteViewState> {
    await this.loadPrefs();
    await this.backendDisableTask;
    if (this.deps.backend && this.state.status !== 'starting') {
      try {
        this.mergeBackendState(await this.deps.backend.request('get_state'));
      } catch {
        // keep the last known state; a lost channel is handled by onLost
      }
    }
    await this.backendDisableTask;
    return this.state;
  }

  private mergeBackendState(result: Record<string, unknown>): void {
    this.set({
      pending: (result.pending as PendingPairing[]) ?? [],
      devices: (result.devices as PairedDeviceInfo[]) ?? [],
      connected: typeof result.connected === 'number' ? result.connected : 0,
      exposure: (result.exposure as ExposureInfo[]) ?? [],
      networkPath: (result.network_path as RemoteViewState['networkPath']) ?? 'unknown',
    });
  }

  // -- backend events -----------------------------------------------------------------

  private handleBackendEvent(event: BackendEvent): void {
    if (event.event === 'pending_pairing') {
      this.set({ pending: (event.pending as PendingPairing[]) ?? [] });
    } else if (event.event === 'sessions_changed') {
      this.set({
        devices: (event.devices as PairedDeviceInfo[]) ?? [],
        connected: typeof event.connected === 'number' ? event.connected : 0,
      });
    } else if (event.event === 'state') {
      const enabled = event.enabled === true;
      this.mergeBackendState(event as Record<string, unknown>);
      if (!enabled && this.state.enabled && !this.busy) {
        // The backend closed the gate by itself (lease lapsed, channel lost).
        void this.afterBackendDisabled(String(event.reason ?? 'backend-stopped'));
      }
    }
  }

  private async handleBackendLost(): Promise<void> {
    if (!this.state.enabled && this.state.status !== 'starting') return;
    await this.afterBackendDisabled('control channel closed');
  }

  private afterBackendDisabled(reason: string): Promise<void> {
    if (this.backendDisableTask) return this.backendDisableTask;
    const task = this.finishBackendDisabled(reason);
    this.backendDisableTask = task.finally(() => {
      this.backendDisableTask = undefined;
    });
    return this.backendDisableTask;
  }

  private async finishBackendDisabled(reason: string): Promise<void> {
    this.deps.log?.(`[remote-view] backend closed the gate: ${reason}`);
    this.stopWatch();
    await this.removeOwnedHandler().catch(() => undefined);
    this.releasePower();
    this.set({
      enabled: false,
      status: 'off',
      url: undefined,
      connected: 0,
      steps: freshSteps(),
      message: undefined,
      conflict: undefined,
    });
  }

  // -- enabling --------------------------------------------------------------------------

  async enable(options: { switchOwner?: boolean } = {}): Promise<RemoteViewState> {
    await this.loadPrefs();
    if (!this.deps.backend) return this.state;
    if (this.busy || this.state.status === 'on') return this.state;
    this.busy = true;
    this.set({
      status: 'starting',
      enabled: false,
      conflict: undefined,
      accountChange: undefined,
      message: undefined,
      steps: freshSteps(),
    });
    try {
      await this.enableSteps(options);
    } catch (error) {
      await this.rollback();
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log?.(`[remote-view] enable failed: ${message}`);
      if (this.state.status !== 'conflict') this.set({ status: 'error', enabled: false, message });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  private fail(status: 'conflict' | 'error', message: string, extra: Partial<RemoteViewState> = {}): never {
    this.set({ status, enabled: false, message, ...extra });
    throw new Error(message);
  }

  private async enableSteps(options: { switchOwner?: boolean }): Promise<void> {
    const backend = this.deps.backend!;
    const cli = this.deps.getCli();
    if (!cli) {
      this.setStep('installed', 'blocked', 'Install Tailscale and sign in, then turn Remote View on.');
      this.fail('error', 'Install Tailscale and sign in, then turn Remote View on.');
    }
    this.setStep('installed', 'ok');

    this.setStep('signedIn', 'working');
    let status: TailscaleStatus;
    try {
      status = await cli.status();
    } catch {
      this.setStep('signedIn', 'blocked');
      this.fail('error', "Couldn't talk to Tailscale. Open Tailscale, sign in, then turn Remote View on.");
    }
    if (!status.running || !status.host || !status.ownerLogin) {
      this.setStep('signedIn', 'blocked', 'Tailscale is not signed in');
      this.fail('error', 'Install Tailscale and sign in, then turn Remote View on.');
    }
    this.setStep('signedIn', 'ok', status.ownerLogin);
    this.set({ host: status.host, ownerLogin: status.ownerLogin });

    if (this.prefs.ownerLogin && this.prefs.ownerLogin !== status.ownerLogin && !options.switchOwner) {
      const accountChange = { previous: this.prefs.ownerLogin, current: status.ownerLogin };
      this.setStep('signedIn', 'blocked', `signed in as ${status.ownerLogin}`);
      this.fail(
        'conflict',
        `Tailscale is signed in as ${status.ownerLogin}, but Remote View was set up for ${this.prefs.ownerLogin}. Nothing was changed.`,
        {
          accountChange,
          conflict: {
            kind: 'account-changed',
            message: `Tailscale is signed in as ${status.ownerLogin}, but Remote View was set up for ${this.prefs.ownerLogin}.`,
          },
        },
      );
    }

    const port = this.prefs.port;
    const host = status.host;
    this.setStep('port', 'working');
    const record = await this.loadRecord();
    const before = await cli.serveStatus();
    const verdict = checkPort(before, host, port, record);
    if (!verdict.ok) {
      this.setStep('port', 'blocked', verdict.conflict.message);
      this.fail('conflict', verdict.conflict.message, { conflict: verdict.conflict });
    }
    if (verdict.ownedStale) {
      await cli.serveOff(port); // our own leftover from a crashed run
      await this.clearRecord();
    }
    const baseline = withoutOurHandler(await cli.serveStatus(), host, port);
    this.setStep('port', 'ok');

    this.currentHost = host;
    this.currentOwner = status.ownerLogin;
    const publicOrigin = `https://${host}:${port}`;
    const reply = await backend.request('enable', {
      owner_login: status.ownerLogin,
      public_origin: publicOrigin,
      mac_name: this.deps.macName(),
    });
    const remotePort = Number(reply.remote_port);
    const ingress = String(reply.ingress);
    const instance = String(reply.instance);
    const target = `http://127.0.0.1:${remotePort}/${ingress}/`;

    this.setStep('serving', 'working');
    await this.saveRecord({ host, port, mount: SERVE_MOUNT, target, ownerLogin: status.ownerLogin });
    await cli.serveAdd(port, target);

    const after = await cli.serveStatus();
    if (!sameConfig(withoutOurHandler(after, host, port), baseline)) {
      this.setStep('serving', 'blocked');
      const message =
        'Remote View is off: another Tailscale Serve entry changed while it was turning on. Nothing else was changed.';
      this.fail('conflict', message, { conflict: { kind: 'handler-changed', message } });
    }

    this.setStep('certificate', 'working', 'certificate provisioning…');
    const healthUrl = `${publicOrigin}${SERVE_MOUNT}/api/health`;
    const served = await this.proveServing(healthUrl, instance);
    if (!served) {
      this.setStep('certificate', 'blocked');
      this.fail(
        'error',
        `Couldn't reach ${publicOrigin}${SERVE_MOUNT}/ from this Mac. Check that HTTPS certificates are enabled for your tailnet, then try again.`,
      );
    }
    this.setStep('certificate', 'ok');
    this.setStep('serving', 'ok');

    this.prefs = { ...this.prefs, ownerLogin: status.ownerLogin };
    await this.savePrefs();
    this.set({
      status: 'on',
      enabled: true,
      url: `${publicOrigin}${SERVE_MOUNT}/`,
      message: undefined,
    });
    this.startWatch();
    this.applyPower();
    try {
      this.mergeBackendState(await backend.request('get_state'));
    } catch {
      // state events will fill it in
    }
  }

  private async proveServing(url: string, instance: string): Promise<boolean> {
    const fetchHealth = this.deps.fetchHealth ?? defaultFetchHealth;
    const now = this.deps.now ?? Date.now;
    const deadline = now() + HEALTH_TIMEOUT_MS;
    for (;;) {
      const health = await fetchHealth(url);
      if (health?.instance === instance) return true;
      if (now() >= deadline) return false;
      await this.sleep(HEALTH_INTERVAL_MS);
    }
  }

  /** Undo a half-finished enable: close the backend gate first, then remove only our handler. */
  private async rollback(): Promise<void> {
    this.stopWatch();
    try {
      await this.deps.backend?.request('disable');
    } catch {
      // the lease lapses by itself
    }
    await this.removeOwnedHandler().catch(() => undefined);
    this.releasePower();
  }

  // -- disabling ----------------------------------------------------------------------------

  async disable(): Promise<RemoteViewState> {
    await this.loadPrefs();
    this.stopWatch();
    this.busy = true;
    try {
      try {
        await this.deps.backend?.request('disable');
      } catch {
        // a lost channel already disabled it
      }
      await this.removeOwnedHandler().catch((error) =>
        this.deps.log?.(`[remote-view] removing the Serve handler failed: ${String(error)}`),
      );
    } finally {
      this.busy = false;
    }
    this.releasePower();
    this.set({
      enabled: false,
      status: 'off',
      url: undefined,
      message: undefined,
      conflict: undefined,
      accountChange: undefined,
      steps: freshSteps(),
      connected: 0,
    });
    return this.state;
  }

  /** On quit: stop everything quickly and never throw. */
  async shutdown(): Promise<void> {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    try {
      await this.disable();
    } catch {
      // best effort
    }
  }

  /**
   * Remove our Serve handler, but only if the live handler is the one recorded.
   * Anything else (replaced by another app, already gone) is left untouched.
   */
  private async removeOwnedHandler(): Promise<void> {
    const record = this.record ?? (await this.loadRecord());
    if (!record) return;
    const cli = this.deps.getCli();
    if (!cli) return;
    const before = await cli.serveStatus();
    if (isOwnedHandler(before, record, record.host, record.port)) {
      await cli.serveOff(record.port);
      const after = await cli.serveStatus();
      if (isOwnedHandler(after, record, record.host, record.port)) {
        throw new Error('Tailscale did not remove the Remote View handler');
      }
      if (!sameConfig(after, withoutOurHandler(before, record.host, record.port))) {
        this.deps.log?.('[remote-view] other Serve entries changed while removing our handler');
      }
    }
    await this.clearRecord();
  }

  /** After a crash: remove a handler left by the previous run, if it is provably ours. */
  async startupSweep(): Promise<'removed' | 'not-ours' | 'none' | 'unavailable'> {
    const record = await this.loadRecord();
    if (!record) return 'none';
    const cli = this.deps.getCli();
    if (!cli) return 'unavailable';
    let cfg: ServeConfig;
    try {
      cfg = await cli.serveStatus();
    } catch {
      return 'unavailable'; // keep the record for the next start
    }
    if (isOwnedHandler(cfg, record, record.host, record.port)) {
      await cli.serveOff(record.port);
      await this.clearRecord();
      this.deps.log?.('[remote-view] removed a stale Serve handler left by a previous run');
      return 'removed';
    }
    await this.clearRecord(); // gone, or replaced by someone else: not ours to touch
    return 'not-ours';
  }

  // -- watching ---------------------------------------------------------------------------------

  private startWatch(): void {
    this.stopWatch();
    const timer = this.deps.setWatchTimer ?? defaultWatchTimer;
    this.stopWatching = timer(() => void this.watchOnce(), WATCH_INTERVAL_MS);
  }

  private stopWatch(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  /** One watch tick: fail closed on any Serve conflict. Exposed for tests. */
  async watchOnce(): Promise<void> {
    if (this.state.status !== 'on' || this.busy) return;
    const cli = this.deps.getCli();
    const record = this.record;
    const host = this.currentHost;
    if (!cli || !record || !host) return;
    let status: TailscaleStatus;
    let cfg: ServeConfig;
    try {
      status = await cli.status();
      cfg = await cli.serveStatus();
    } catch {
      return; // a transient CLI failure is not proof of a conflict
    }
    const finding = this.evaluate(status, cfg, record, host);
    if (finding) {
      await this.disableForConflict(finding);
      return;
    }
    const path = networkPathFromStatus(status);
    if (path !== this.lastPath) {
      this.lastPath = path;
      this.set({ networkPath: path });
      try {
        await this.deps.backend?.request('set_network_path', { path });
      } catch {
        // cosmetic
      }
    }
  }

  private evaluate(
    status: TailscaleStatus,
    cfg: ServeConfig,
    record: ServeOwnerRecord,
    host: string,
  ): RemoteConflict | undefined {
    const port = record.port;
    if (!status.running || status.ownerLogin !== this.currentOwner || status.host !== host) {
      return {
        kind: 'account-changed',
        message: `Remote View is off: Tailscale is now signed in as ${status.ownerLogin || 'another account'}. Turn it on again to use it with this account. Nothing else was changed.`,
      };
    }
    if (cfg.AllowFunnel?.[serveKey(host, port)] === true) {
      return { kind: 'funnel', message: conflictCopy('funnel', port) };
    }
    if (!isOwnedHandler(cfg, record, host, port)) {
      return {
        kind: 'handler-changed',
        message: `Remote View is off: the Tailscale Serve entry for port ${port} was changed by another app. Nothing else was changed.`,
      };
    }
    const handlers = Object.keys(cfg.Web?.[serveKey(host, port)]?.Handlers ?? {});
    if (handlers.some((path) => path !== SERVE_MOUNT)) {
      return { kind: 'port-in-use', message: conflictCopy('port-in-use', port) };
    }
    return undefined;
  }

  private async disableForConflict(conflict: RemoteConflict): Promise<void> {
    this.busy = true;
    this.stopWatch();
    try {
      try {
        await this.deps.backend?.request('disable'); // the backend gate closes first
      } catch {
        // the lease lapses by itself
      }
      await this.removeOwnedHandler().catch(() => undefined);
    } finally {
      this.busy = false;
    }
    this.releasePower();
    this.set({
      status: 'conflict',
      enabled: false,
      url: undefined,
      connected: 0,
      message: conflict.message,
      conflict,
    });
  }

  // -- pairing and administration ---------------------------------------------------------------------

  async newCode(): Promise<PairingCode> {
    if (!this.deps.backend || this.state.status !== 'on' || !this.state.url) {
      throw new Error('Remote View is off');
    }
    const reply = await this.deps.backend.request('new_pairing_code');
    const token = String(reply.token);
    const url = `${this.state.url}#pair=${token}`;
    const qrSvg = this.deps.renderQr ? await this.deps.renderQr(url) : undefined;
    return { url, token, expiresAt: Number(reply.expires_at), ...(qrSvg ? { qrSvg } : {}) };
  }

  async approve(pendingId: string): Promise<void> {
    await this.deps.backend?.request('approve', { pending_id: pendingId });
  }

  async deny(pendingId: string): Promise<void> {
    await this.deps.backend?.request('deny', { pending_id: pendingId });
  }

  async revoke(deviceId: string): Promise<void> {
    await this.deps.backend?.request('revoke', { device_id: deviceId });
  }

  async revokeAll(): Promise<void> {
    await this.deps.backend?.request('revoke_all');
  }

  async setExposure(folderPath: string, shown: boolean): Promise<ExposureInfo[]> {
    const backend = this.deps.backend;
    if (!backend) return [];
    await backend.request('set_exposure', { folder_path: folderPath, shown });
    const state = await backend.request('get_state');
    this.mergeBackendState(state);
    return this.state.exposure;
  }

  async setPort(port: number): Promise<RemoteViewState> {
    await this.loadPrefs();
    if (!isValidPort(port)) throw new Error('Port must be between 1024 and 65535');
    if (this.state.status === 'on' || this.state.status === 'starting') {
      throw new Error('Turn Remote View off before changing the port');
    }
    this.prefs = { ...this.prefs, port };
    await this.savePrefs();
    this.set({ port, conflict: undefined, message: undefined, status: 'off' });
    return this.state;
  }

  async setKeepAwake(keepAwake: boolean): Promise<RemoteViewState> {
    await this.loadPrefs();
    this.prefs = { ...this.prefs, keepAwake };
    await this.savePrefs();
    this.set({ keepAwake });
    if (this.state.status === 'on') {
      this.releasePower();
      this.applyPower();
    }
    return this.state;
  }

  private applyPower(): void {
    if (this.prefs.keepAwake && this.deps.powerSave && this.powerSaveId === undefined) {
      this.powerSaveId = this.deps.powerSave.start();
    }
  }

  private releasePower(): void {
    if (this.powerSaveId !== undefined && this.deps.powerSave) {
      this.deps.powerSave.stop(this.powerSaveId);
    }
    this.powerSaveId = undefined;
  }
}
