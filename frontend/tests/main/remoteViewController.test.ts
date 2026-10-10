import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkPort,
  conflictCopy,
  networkPathFromStatus,
  RemoteViewController,
  type BackendControl,
  type BackendEvent,
  type RemoteViewDeps,
  type ServeOwnerRecord,
} from '../../src/main/remoteViewController.js';
import {
  CLI_CANDIDATES,
  locateTailscaleCli,
  parseServeConfig,
  parseStatus,
  serveAddArgv,
  serveOffArgv,
  serveStatusArgv,
  statusArgv,
  TailscaleCli,
  type ServeConfig,
} from '../../src/main/tailscaleCli.js';

const HOST = 'macbook-pro.tail1234.ts.net';
const OWNER = 'owner@example.test';
const FIXTURE = resolve(process.cwd(), 'tests/main/fixtures/fake-tailscale.mjs');
const INGRESS = 'A'.repeat(43);

// The owner's real Mac already serves these ports; nothing here may disturb them.
const OTHER_PORTS = [443, 8443, 9443, 9444, 9445, 9446, 10443, 10444];

function otherApps(): ServeConfig {
  const TCP: NonNullable<ServeConfig['TCP']> = {};
  const Web: NonNullable<ServeConfig['Web']> = {};
  OTHER_PORTS.forEach((port, index) => {
    TCP[String(port)] = { HTTPS: true };
    Web[`${HOST}:${port}`] = { Handlers: { '/': { Proxy: `http://127.0.0.1:${3000 + index}` } } };
  });
  return { TCP, Web };
}

function statusJson(overrides: Record<string, unknown> = {}) {
  return {
    BackendState: 'Running',
    Self: { DNSName: `${HOST}.`, UserID: 42 },
    User: { '42': { LoginName: OWNER } },
    Peer: {},
    ...overrides,
  };
}

class FakeBackend implements BackendControl {
  requests: Array<{ type: string; fields?: Record<string, unknown> }> = [];
  order: string[];
  eventListeners: Array<(event: BackendEvent) => void> = [];
  lostListeners: Array<() => void> = [];
  enableCount = 0;
  lastInstance = '';
  failEnable = false;

  constructor(order: string[]) {
    this.order = order;
  }

  async request(type: string, fields?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.requests.push({ type, fields });
    this.order.push(`backend:${type}`);
    switch (type) {
      case 'enable':
        if (this.failEnable) throw new Error('backend refused');
        this.enableCount += 1;
        this.lastInstance = `instance-${this.enableCount}`;
        return { remote_port: 54321, ingress: INGRESS, instance: this.lastInstance };
      case 'get_state':
        return { enabled: true, pending: [], devices: [], connected: 0, exposure: [], network_path: 'unknown' };
      case 'new_pairing_code':
        return { token: 'tok_abc-123', expires_at: 1_900_000_000 };
      default:
        return {};
    }
  }

  onEvent(listener: (event: BackendEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => undefined;
  }

  onLost(listener: () => void): () => void {
    this.lostListeners.push(listener);
    return () => undefined;
  }

  emit(event: BackendEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  lose(): void {
    for (const listener of this.lostListeners) listener();
  }

  count(type: string): number {
    return this.requests.filter((request) => request.type === type).length;
  }
}

interface Rig {
  dir: string;
  statePath: string;
  logPath: string;
  cliPath: string;
  backend: FakeBackend;
  order: string[];
  controller: RemoteViewController;
  cli: TailscaleCli;
  healthCalls: number;
  healthFailures: number;
  powerEvents: string[];
  timers: Array<{ ms: number; cancelled: boolean; tick: () => void }>;
  readState(): { status: ReturnType<typeof statusJson>; serve: ServeConfig; fail?: Record<string, boolean> };
  writeState(patch: Record<string, unknown>): void;
  setServe(serve: ServeConfig): void;
  serveText(): string;
  argvLog(): string[][];
  logDeps: string[];
}

function rig(options: { serve?: ServeConfig; backend?: boolean; cli?: boolean; deps?: Partial<RemoteViewDeps> } = {}): Rig {
  const dir = mkdtempSync(join(tmpdir(), 'remote-view-'));
  const statePath = join(dir, 'fake-state.json');
  const logPath = join(dir, 'argv.log');
  writeFileSync(logPath, '');
  const initial = { status: statusJson(), serve: options.serve ?? otherApps() };
  writeFileSync(statePath, JSON.stringify(initial, null, 2) + '\n');
  const cliPath = join(dir, 'tailscale');
  writeFileSync(
    cliPath,
    `#!/bin/sh\nexport FAKE_TAILSCALE_STATE='${statePath}'\nexport FAKE_TAILSCALE_LOG='${logPath}'\nexec '${process.execPath}' '${FIXTURE}' "$@"\n`,
  );
  chmodSync(cliPath, 0o755);
  const order: string[] = [];
  const backend = options.backend === false ? undefined : new FakeBackend(order);
  const cli = new TailscaleCli(cliPath);
  const timers: Rig['timers'] = [];
  const state = {
    healthCalls: 0,
    healthFailures: 0,
    powerEvents: [] as string[],
    logDeps: [] as string[],
  };
  const deps: RemoteViewDeps = {
    directory: join(dir, 'remote-view'),
    getCli: () => (options.cli === false ? undefined : cli),
    backend,
    macName: () => 'macbook-pro',
    sleep: async () => undefined,
    fetchHealth: async () => {
      state.healthCalls += 1;
      if (state.healthFailures > 0) {
        state.healthFailures -= 1;
        return undefined;
      }
      return { instance: backend?.lastInstance };
    },
    renderQr: async (url) => `<svg data-url="${url}"/>`,
    powerSave: {
      start: () => {
        state.powerEvents.push('start');
        return 7;
      },
      stop: (id) => state.powerEvents.push(`stop:${id}`),
    },
    setWatchTimer: (tick, ms) => {
      const timer = { ms, cancelled: false, tick };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    log: (message) => state.logDeps.push(message),
    ...options.deps,
  };
  const controller = new RemoteViewController(deps);
  const result: Rig = {
    dir,
    statePath,
    logPath,
    cliPath,
    backend: backend as FakeBackend,
    order,
    controller,
    cli,
    get healthCalls() {
      return state.healthCalls;
    },
    set healthCalls(value: number) {
      state.healthCalls = value;
    },
    get healthFailures() {
      return state.healthFailures;
    },
    set healthFailures(value: number) {
      state.healthFailures = value;
    },
    powerEvents: state.powerEvents,
    logDeps: state.logDeps,
    timers,
    readState: () => JSON.parse(readFileSync(statePath, 'utf-8')),
    writeState: (patch) => {
      const next = { ...JSON.parse(readFileSync(statePath, 'utf-8')), ...patch };
      writeFileSync(statePath, JSON.stringify(next, null, 2) + '\n');
    },
    setServe: (serve) => result.writeState({ serve }),
    serveText: () => JSON.stringify(JSON.parse(readFileSync(statePath, 'utf-8')).serve, null, 2),
    argvLog: () =>
      readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
  return result;
}

function assertNoForbiddenCommands(r: Rig): void {
  for (const argv of r.argvLog()) {
    assert.ok(!argv.includes('reset'), `argv must never contain reset: ${argv.join(' ')}`);
    assert.ok(!argv.includes('funnel'), `argv must never contain funnel: ${argv.join(' ')}`);
    const allowed =
      (argv[0] === 'status' && argv.length === 2) ||
      (argv[0] === 'serve' && argv[1] === 'status') ||
      (argv[0] === 'serve' && argv.includes('--bg') && argv.some((a) => a.startsWith('--https=')));
    assert.ok(allowed, `unexpected tailscale command: ${argv.join(' ')}`);
  }
}

function otherEntries(serve: ServeConfig): string {
  const copy = JSON.parse(JSON.stringify(serve)) as ServeConfig;
  const key = `${HOST}:8448`;
  delete copy.Web?.[key];
  delete copy.TCP?.['8448'];
  return JSON.stringify(copy);
}

const EXPECTED_TARGET = `http://127.0.0.1:54321/${INGRESS}/`;

// --- argv builders -------------------------------------------------------------------

test('argv builders emit exactly status, serve status, serve add and serve off', () => {
  assert.deepEqual([...statusArgv()], ['status', '--json']);
  assert.deepEqual([...serveStatusArgv()], ['serve', 'status', '--json']);
  assert.deepEqual(
    [...serveAddArgv(8448, EXPECTED_TARGET)],
    ['serve', '--bg', '--https=8448', '--set-path=/remote', EXPECTED_TARGET],
  );
  assert.deepEqual([...serveOffArgv(8448)], ['serve', '--bg', '--https=8448', '--set-path=/remote', 'off']);
});

test('no input can make an argv builder produce reset or funnel', () => {
  const targets = [
    EXPECTED_TARGET,
    'reset',
    'funnel',
    'http://127.0.0.1:1/reset/',
    'http://evil.example:80/AAAAAAAAAAAAAAAAAAAA/',
    'https://127.0.0.1:1/AAAAAAAAAAAAAAAAAAAA/',
    'http://127.0.0.1:54321/AAAAAAAAAAAAAAAAAAAA/ --funnel',
    '',
  ];
  const ports: unknown[] = [8448, 1024, 65535, 80, 443, 1023, 65536, -1, 1.5, NaN, '8448', undefined, null];
  for (const port of ports) {
    for (const target of targets) {
      for (const build of [
        () => serveAddArgv(port as number, target),
        () => serveOffArgv(port as number),
      ]) {
        try {
          const argv = build();
          assert.ok(!argv.some((arg) => /reset|funnel/i.test(arg)), `${argv.join(' ')}`);
          assert.equal(argv[0], 'serve');
          assert.ok(argv.includes('--bg'));
        } catch (error) {
          assert.match((error as Error).message, /Port must be|Serve target must be/);
        }
      }
    }
  }
  assert.throws(() => serveAddArgv(80, EXPECTED_TARGET), /Port must be/);
  assert.throws(() => serveAddArgv(8448, 'http://127.0.0.1:1/reset/'), /Serve target/);
});

test('the CLI wrapper refuses any argv that a builder did not make', async () => {
  const r = rig();
  const loose = r.cli as unknown as { run(argv: string[]): Promise<unknown> };
  await assert.rejects(() => loose.run(['serve', 'reset']), /not built by an argv builder/);
  await assert.rejects(() => loose.run(['funnel', '8448', 'on']), /not built by an argv builder/);
  assert.deepEqual(r.argvLog(), []);
});

test('the fake CLI itself refuses reset and funnel, so a test would notice them', async () => {
  const r = rig();
  const run = (args: string[]) =>
    new Promise<number>((done) => {
      execFile(r.cliPath, args, (error) => done(error ? 1 : 0));
    });
  assert.notEqual(await run(['serve', 'reset']), 0);
  assert.notEqual(await run(['funnel', '8448', 'on']), 0);
  assert.ok(r.argvLog().some((argv) => argv.includes('reset')));
});

test('locateTailscaleCli tries the app bundle, then Homebrew, then /usr/local', () => {
  assert.deepEqual([...CLI_CANDIDATES], [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
  ]);
  assert.equal(locateTailscaleCli(() => true), CLI_CANDIDATES[0]);
  assert.equal(locateTailscaleCli((p) => p !== CLI_CANDIDATES[0]), CLI_CANDIDATES[1]);
  assert.equal(locateTailscaleCli((p) => p === CLI_CANDIDATES[2]), CLI_CANDIDATES[2]);
  assert.equal(locateTailscaleCli(() => false), undefined);
});

test('status parsing reads the state, host without trailing dot and owner login', () => {
  const parsed = parseStatus(JSON.stringify(statusJson()));
  assert.equal(parsed.running, true);
  assert.equal(parsed.host, HOST);
  assert.equal(parsed.ownerLogin, OWNER);
  assert.equal(parseStatus(JSON.stringify(statusJson({ BackendState: 'NeedsLogin' }))).running, false);
  assert.equal(parseStatus(JSON.stringify({ BackendState: 'Running' })).ownerLogin, '');
  assert.deepEqual(parseServeConfig(''), {});
  assert.deepEqual(parseServeConfig('null'), {});
});

// --- enable / disable ------------------------------------------------------------------------

test('enable then disable leaves unrelated Serve entries byte-identical', async () => {
  const r = rig();
  const before = r.serveText();

  const on = await r.controller.enable();

  assert.equal(on.status, 'on');
  assert.equal(on.url, `https://${HOST}:8448/remote/`);
  const live = r.readState().serve;
  assert.deepEqual(live.Web?.[`${HOST}:8448`]?.Handlers, { '/remote': { Proxy: EXPECTED_TARGET } });
  assert.deepEqual(live.TCP?.['8448'], { HTTPS: true });
  assert.equal(otherEntries(live), JSON.stringify(JSON.parse(before)));

  const off = await r.controller.disable();

  assert.equal(off.status, 'off');
  assert.equal(r.serveText(), before, 'Serve config must be byte-identical after disable');
  assert.equal(existsSync(join(r.dir, 'remote-view', 'serve-owner.json')), false);
  assertNoForbiddenCommands(r);
});

test('enable asks the backend first, then adds the handler; disable closes the backend first', async () => {
  const r = rig();
  await r.controller.enable();
  await r.controller.disable();

  const enableAt = r.order.indexOf('backend:enable');
  assert.ok(enableAt >= 0);
  const argv = r.argvLog();
  const addAt = argv.findIndex((a) => a.includes(EXPECTED_TARGET));
  const offAt = argv.findIndex((a) => a.at(-1) === 'off');
  assert.ok(addAt >= 0 && offAt > addAt);
  // The backend saw `enable` before any Serve add, and `disable` before the Serve off.
  assert.deepEqual(
    r.backend.requests.map((x) => x.type).filter((t) => t === 'enable' || t === 'disable'),
    ['enable', 'disable'],
  );
  assert.deepEqual(r.backend.requests.find((x) => x.type === 'enable')?.fields, {
    owner_login: OWNER,
    public_origin: `https://${HOST}:8448`,
    mac_name: 'macbook-pro',
  });
  const orderLog = r.order.join(',');
  assert.ok(orderLog.indexOf('backend:enable') < orderLog.indexOf('backend:disable'));
});

test('the ownership record and prefs are private files', async () => {
  const r = rig();
  await r.controller.enable();
  const recordPath = join(r.dir, 'remote-view', 'serve-owner.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf-8')) as ServeOwnerRecord;
  assert.deepEqual(record, { host: HOST, port: 8448, mount: '/remote', target: EXPECTED_TARGET, ownerLogin: OWNER });
  assert.equal(statSync(recordPath).mode & 0o777, 0o600);
  assert.equal(statSync(join(r.dir, 'remote-view')).mode & 0o777, 0o700);
  assert.equal(statSync(join(r.dir, 'remote-view', 'prefs.json')).mode & 0o777, 0o600);
});

test('8448 held by another target is refused with the conflict copy and nothing is changed', async () => {
  const serve = otherApps();
  serve.TCP!['8448'] = { HTTPS: true };
  serve.Web![`${HOST}:8448`] = { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } };
  const r = rig({ serve });
  const before = r.serveText();

  const state = await r.controller.enable();

  assert.equal(state.status, 'conflict');
  assert.equal(
    state.message,
    'Remote View is off: port 8448 is in use by another app. Nothing else was changed. Choose another port.',
  );
  assert.equal(state.conflict?.kind, 'port-in-use');
  assert.equal(state.steps.find((s) => s.id === 'port')?.status, 'blocked');
  assert.equal(r.serveText(), before);
  assert.equal(r.backend.count('enable'), 0, 'the backend must never be enabled');
  assert.ok(!r.argvLog().some((argv) => argv.includes('--set-path=/remote')));
  assertNoForbiddenCommands(r);
});

test('a different handler on a sibling path of 8448 also counts as in use', async () => {
  const serve = otherApps();
  serve.TCP!['8448'] = { HTTPS: true };
  serve.Web![`${HOST}:8448`] = { Handlers: { '/other': { Proxy: 'http://127.0.0.1:9000' } } };
  const r = rig({ serve });
  const state = await r.controller.enable();
  assert.equal(state.conflict?.kind, 'port-in-use');
  assert.equal(r.backend.count('enable'), 0);
});

test('Funnel on 8448 is refused', async () => {
  const serve = otherApps();
  serve.AllowFunnel = { [`${HOST}:8448`]: true };
  const r = rig({ serve });
  const before = r.serveText();

  const state = await r.controller.enable();

  assert.equal(state.status, 'conflict');
  assert.equal(
    state.message,
    'Remote View is off: port 8448 has Funnel on. Nothing else was changed. Choose another port.',
  );
  assert.equal(state.conflict?.kind, 'funnel');
  assert.equal(r.serveText(), before);
  assert.equal(r.backend.count('enable'), 0);
  assertNoForbiddenCommands(r);
});

test('conflict copy matches the plan for both kinds', () => {
  assert.equal(
    conflictCopy('port-in-use', 9000),
    'Remote View is off: port 9000 is in use by another app. Nothing else was changed. Choose another port.',
  );
  assert.equal(
    conflictCopy('funnel', 9000),
    'Remote View is off: port 9000 has Funnel on. Nothing else was changed. Choose another port.',
  );
});

test('Funnel turned on mid-session disables Remote View and removes only our handler', async () => {
  const r = rig();
  await r.controller.enable();
  const live = r.readState().serve;
  live.AllowFunnel = { [`${HOST}:8448`]: true };
  r.setServe(live);
  const funnelledOthers = otherEntries(live);

  await r.controller.watchOnce();

  const state = await r.controller.getState();
  assert.equal(state.status, 'conflict');
  assert.equal(state.conflict?.kind, 'funnel');
  assert.equal(state.enabled, false);
  assert.equal(state.url, undefined);
  const after = r.readState().serve;
  assert.equal(after.Web?.[`${HOST}:8448`], undefined, 'our handler is gone');
  assert.equal(otherEntries(after), funnelledOthers, 'every other entry is untouched');
  assert.equal(r.backend.count('disable'), 1);
  const orderLog = r.order.join(',');
  assert.ok(orderLog.lastIndexOf('backend:disable') > orderLog.indexOf('backend:enable'));
  assert.equal(r.timers.at(-1)?.cancelled, true, 'watching stops');
  assertNoForbiddenCommands(r);
});

test('a replaced handler is not removed', async () => {
  const r = rig();
  await r.controller.enable();
  const live = r.readState().serve;
  live.Web![`${HOST}:8448`].Handlers!['/remote'] = { Proxy: 'http://127.0.0.1:7777/theirs/' };
  r.setServe(live);

  await r.controller.watchOnce();

  const state = await r.controller.getState();
  assert.equal(state.status, 'conflict');
  assert.equal(state.conflict?.kind, 'handler-changed');
  assert.deepEqual(r.readState().serve.Web?.[`${HOST}:8448`]?.Handlers?.['/remote'], {
    Proxy: 'http://127.0.0.1:7777/theirs/',
  });
  assert.ok(!r.argvLog().some((argv) => argv.at(-1) === 'off'), 'no serve off may be issued');
  assert.equal(r.backend.count('disable'), 1, 'the backend gate still closes');
  assertNoForbiddenCommands(r);
});

test('another handler appearing on our port mid-session disables Remote View', async () => {
  const r = rig();
  await r.controller.enable();
  const live = r.readState().serve;
  live.Web![`${HOST}:8448`].Handlers!['/other'] = { Proxy: 'http://127.0.0.1:1234' };
  r.setServe(live);

  await r.controller.watchOnce();

  const state = await r.controller.getState();
  assert.equal(state.conflict?.kind, 'port-in-use');
  const handlers = r.readState().serve.Web?.[`${HOST}:8448`]?.Handlers;
  assert.deepEqual(Object.keys(handlers ?? {}), ['/other'], 'ours removed, theirs kept');
});

test('a different Tailscale account mid-session disables Remote View', async () => {
  const r = rig();
  await r.controller.enable();
  r.writeState({
    status: statusJson({ Self: { DNSName: `${HOST}.`, UserID: 43 }, User: { '43': { LoginName: 'someone@else.test' } } }),
  });

  await r.controller.watchOnce();

  const state = await r.controller.getState();
  assert.equal(state.status, 'conflict');
  assert.equal(state.conflict?.kind, 'account-changed');
  assert.equal(r.readState().serve.Web?.[`${HOST}:8448`], undefined);
});

test('a transient CLI failure while watching does not disable Remote View', async () => {
  const r = rig();
  await r.controller.enable();
  r.writeState({ fail: { serveStatus: true } });
  await r.controller.watchOnce();
  assert.equal((await r.controller.getState()).status, 'on');
  assert.equal(r.backend.count('disable'), 0);
});

test('a healthy watch tick changes nothing and the watch runs every 5 seconds', async () => {
  const r = rig();
  await r.controller.enable();
  const timer = r.timers.at(-1)!;
  assert.equal(timer.ms, 5000);
  const before = r.serveText();
  await r.controller.watchOnce();
  assert.equal(r.serveText(), before);
  assert.equal((await r.controller.getState()).status, 'on');
});

test('watching reports the network path to the backend when it changes', async () => {
  const r = rig();
  await r.controller.enable();
  r.writeState({
    status: statusJson({ Peer: { a: { UserID: 42, OS: 'iOS', Online: true, Active: true, CurAddr: '', Relay: 'fra' } } }),
  });
  await r.controller.watchOnce();
  assert.deepEqual(r.backend.requests.filter((x) => x.type === 'set_network_path').map((x) => x.fields), [
    { path: 'relayed' },
  ]);
  await r.controller.watchOnce();
  assert.equal(r.backend.count('set_network_path'), 1, 'only on change');
  assert.equal(networkPathFromStatus(parseStatus(JSON.stringify(statusJson({
    Peer: { a: { OS: 'iOS', Active: true, CurAddr: '1.2.3.4:41641' } },
  })))), 'direct');
  assert.equal(networkPathFromStatus(parseStatus(JSON.stringify(statusJson()))), 'unknown');
});

// --- the startup sweep ----------------------------------------------------------------------------

async function leaveStaleHandler(r: Rig): Promise<ServeOwnerRecord> {
  await r.controller.enable();
  const record = JSON.parse(readFileSync(join(r.dir, 'remote-view', 'serve-owner.json'), 'utf-8')) as ServeOwnerRecord;
  return record;
}

test('a stale owned handler from a crashed run is removed by the startup sweep', async () => {
  const first = rig();
  const before = first.serveText();
  await leaveStaleHandler(first);
  // "kill -9": no disable. A new app run starts with the same files.
  const second = new RemoteViewController({
    directory: join(first.dir, 'remote-view'),
    getCli: () => first.cli,
    backend: first.backend,
    macName: () => 'macbook-pro',
  });

  const result = await second.startupSweep();

  assert.equal(result, 'removed');
  assert.equal(first.serveText(), before, 'only our handler went away');
  assert.equal(existsSync(join(first.dir, 'remote-view', 'serve-owner.json')), false);
  assertNoForbiddenCommands(first);
});

test('the startup sweep leaves a handler that is no longer ours alone', async () => {
  const first = rig();
  await leaveStaleHandler(first);
  const live = first.readState().serve;
  live.Web![`${HOST}:8448`].Handlers!['/remote'] = { Proxy: 'http://127.0.0.1:7777/theirs/' };
  first.setServe(live);
  const second = new RemoteViewController({
    directory: join(first.dir, 'remote-view'),
    getCli: () => first.cli,
    backend: first.backend,
    macName: () => 'macbook-pro',
  });

  assert.equal(await second.startupSweep(), 'not-ours');

  assert.deepEqual(first.readState().serve.Web?.[`${HOST}:8448`]?.Handlers?.['/remote'], {
    Proxy: 'http://127.0.0.1:7777/theirs/',
  });
  assert.ok(!first.argvLog().some((argv) => argv.at(-1) === 'off'));
  assert.equal(existsSync(join(first.dir, 'remote-view', 'serve-owner.json')), false);
});

test('the startup sweep with no record or no Tailscale does nothing', async () => {
  const clean = rig();
  assert.equal(await clean.controller.startupSweep(), 'none');
  assert.deepEqual(clean.argvLog(), []);

  const first = rig();
  await leaveStaleHandler(first);
  const noCli = new RemoteViewController({
    directory: join(first.dir, 'remote-view'),
    getCli: () => undefined,
    backend: first.backend,
    macName: () => 'x',
  });
  assert.equal(await noCli.startupSweep(), 'unavailable');
  assert.equal(existsSync(join(first.dir, 'remote-view', 'serve-owner.json')), true, 'kept for next time');
});

test('a stale owned handler found at enable time is replaced, not treated as a conflict', async () => {
  const first = rig();
  await leaveStaleHandler(first);
  const second = new RemoteViewController({
    directory: join(first.dir, 'remote-view'),
    getCli: () => first.cli,
    backend: first.backend,
    macName: () => 'macbook-pro',
    fetchHealth: async () => ({ instance: first.backend.lastInstance }),
    sleep: async () => undefined,
    setWatchTimer: () => () => undefined,
  });
  const state = await second.enable();
  assert.equal(state.status, 'on');
  assert.deepEqual(first.readState().serve.Web?.[`${HOST}:8448`]?.Handlers, { '/remote': { Proxy: EXPECTED_TARGET } });
});

// --- readiness and failure paths --------------------------------------------------------------------

test('without Tailscale the readiness line says to install it and nothing is changed', async () => {
  const r = rig({ cli: false });
  const state = await r.controller.enable();
  assert.equal(state.status, 'error');
  assert.equal(state.message, 'Install Tailscale and sign in, then turn Remote View on.');
  assert.equal(state.steps.find((s) => s.id === 'installed')?.status, 'blocked');
  assert.equal(r.backend.count('enable'), 0);
});

test('not signed in to Tailscale blocks the signed-in step', async () => {
  const r = rig();
  r.writeState({ status: statusJson({ BackendState: 'NeedsLogin' }) });
  const state = await r.controller.enable();
  assert.equal(state.status, 'error');
  assert.equal(state.steps.find((s) => s.id === 'signedIn')?.status, 'blocked');
  assert.equal(r.backend.count('enable'), 0);
});

test('a successful enable walks all five readiness steps to ok', async () => {
  const r = rig();
  const state = await r.controller.enable();
  assert.deepEqual(state.steps.map((s) => [s.id, s.status]), [
    ['installed', 'ok'],
    ['signedIn', 'ok'],
    ['certificate', 'ok'],
    ['port', 'ok'],
    ['serving', 'ok'],
  ]);
  assert.equal(state.steps.find((s) => s.id === 'signedIn')?.detail, OWNER);
  assert.equal(state.ownerLogin, OWNER);
  assert.equal(state.host, HOST);
});

test('certificate provisioning retries the health check until the instance matches', async () => {
  const r = rig();
  r.healthFailures = 3;
  const seen: string[] = [];
  r.controller.onChange((state) => {
    const step = state.steps.find((s) => s.id === 'certificate');
    if (step?.detail) seen.push(step.detail);
  });

  const state = await r.controller.enable();

  assert.equal(state.status, 'on');
  assert.equal(r.healthCalls, 4);
  assert.ok(seen.includes('certificate provisioning…'));
});

test('if the health check never matches, enable fails closed and removes what it added', async () => {
  let clock = 0;
  const r = rig({ deps: { now: () => clock, sleep: async (ms) => { clock += ms; } } });
  r.healthFailures = 10_000;
  const before = r.serveText();

  const state = await r.controller.enable();

  assert.equal(state.status, 'error');
  assert.match(state.message ?? '', /Couldn't reach https:\/\/macbook-pro\.tail1234\.ts\.net:8448\/remote\//);
  assert.equal(state.enabled, false);
  assert.equal(r.serveText(), before);
  assert.equal(r.backend.count('disable'), 1);
  assert.ok(clock >= 120_000, 'it retried for up to two minutes');
  assertNoForbiddenCommands(r);
});

test('a health check answering with another instance does not count as serving', async () => {
  let clock = 0;
  const r = rig({
    deps: { now: () => clock, sleep: async (ms) => { clock += ms; }, fetchHealth: async () => ({ instance: 'someone-else' }) },
  });
  const state = await r.controller.enable();
  assert.equal(state.status, 'error');
  assert.equal(r.readState().serve.Web?.[`${HOST}:8448`], undefined);
});

test('another Serve entry changing while ours is added aborts and removes only ours', async () => {
  const r = rig();
  r.writeState({
    afterAdd: { web: { [`${HOST}:5555`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:5555' } } } } },
  });

  const state = await r.controller.enable();

  assert.equal(state.status, 'conflict');
  assert.equal(state.conflict?.kind, 'handler-changed');
  const live = r.readState().serve;
  assert.equal(live.Web?.[`${HOST}:8448`], undefined, 'our handler removed');
  assert.ok(live.Web?.[`${HOST}:5555`], 'the other app\'s entry is not ours to undo');
  assert.equal(r.backend.count('disable'), 1);
});

test('a backend refusing enable leaves Serve untouched', async () => {
  const r = rig();
  r.backend.failEnable = true;
  const before = r.serveText();
  const state = await r.controller.enable();
  assert.equal(state.status, 'error');
  assert.equal(r.serveText(), before);
  assert.ok(!r.argvLog().some((argv) => argv.includes('--set-path=/remote')));
});

test('serve add failing rolls back the backend gate', async () => {
  const r = rig();
  r.writeState({ fail: { serveAdd: true } });
  const state = await r.controller.enable();
  assert.equal(state.status, 'error');
  assert.equal(r.backend.count('disable'), 1);
  assert.equal(existsSync(join(r.dir, 'remote-view', 'serve-owner.json')), false);
});

test('without an app-managed backend the state is unavailable and enable does nothing', async () => {
  const r = rig({ backend: false });
  const state = await r.controller.getState();
  assert.equal(state.unavailable, 'backend-not-managed');
  const after = await r.controller.enable();
  assert.equal(after.unavailable, 'backend-not-managed');
  assert.equal(after.status, 'off');
  assert.deepEqual(r.argvLog(), []);
});

test('Remote View is off by default and ports default to 8448', async () => {
  const r = rig();
  const state = await r.controller.getState();
  assert.equal(state.status, 'off');
  assert.equal(state.enabled, false);
  assert.equal(state.port, 8448);
  assert.equal(state.keepAwake, true);
  assert.deepEqual(r.argvLog(), []);
});

test('the port is configurable within 1024-65535 and used for Serve', async () => {
  const r = rig();
  await assert.rejects(() => r.controller.setPort(80), /between 1024 and 65535/);
  await assert.rejects(() => r.controller.setPort(70000), /between 1024 and 65535/);
  await r.controller.setPort(9100);
  const state = await r.controller.enable();
  assert.equal(state.url, `https://${HOST}:9100/remote/`);
  assert.ok(r.argvLog().some((argv) => argv.includes('--https=9100')));
  assert.ok(!r.argvLog().some((argv) => argv.includes('--https=8448')));
  await assert.rejects(() => r.controller.setPort(9200), /Turn Remote View off/);
  // the choice survives a restart
  await r.controller.disable();
  const again = new RemoteViewController({
    directory: join(r.dir, 'remote-view'), getCli: () => r.cli, backend: r.backend, macName: () => 'x',
  });
  assert.equal((await again.getState()).port, 9100);
});

test('a port conflict never switches ports by itself', async () => {
  const serve = otherApps();
  serve.TCP!['8448'] = { HTTPS: true };
  serve.Web![`${HOST}:8448`] = { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } };
  const r = rig({ serve });
  await r.controller.enable();
  assert.equal((await r.controller.getState()).port, 8448);
  assert.ok(!r.argvLog().some((argv) => argv.some((a) => a.startsWith('--https=') && a !== '--https=8448')));
});

test('a changed Tailscale account is not adopted silently', async () => {
  const r = rig();
  await r.controller.enable();
  await r.controller.disable();
  r.writeState({
    status: statusJson({ Self: { DNSName: `${HOST}.`, UserID: 43 }, User: { '43': { LoginName: 'new@else.test' } } }),
  });
  const before = r.serveText();

  const blocked = await r.controller.enable();

  assert.equal(blocked.status, 'conflict');
  assert.deepEqual(blocked.accountChange, { previous: OWNER, current: 'new@else.test' });
  assert.equal(r.serveText(), before);
  assert.equal(r.backend.count('enable'), 1, 'the second enable never reached the backend');

  const switched = await r.controller.enable({ switchOwner: true });
  assert.equal(switched.status, 'on');
  assert.equal(r.backend.requests.filter((x) => x.type === 'enable').at(-1)?.fields?.owner_login, 'new@else.test');
});

// --- backend events and keep-awake -------------------------------------------------------------------

test('the backend closing the gate by itself turns Remote View off and removes our handler', async () => {
  const r = rig();
  const before = r.serveText();
  await r.controller.enable();

  r.backend.emit({ event: 'state', enabled: false, reason: 'lease-expired', pending: [], devices: [], connected: 0, exposure: [] });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const state = await r.controller.getState();
  assert.equal(state.status, 'off');
  assert.equal(r.serveText(), before);
});

test('EOF from the backend marks Remote View off and removes our handler', async () => {
  const r = rig();
  const before = r.serveText();
  await r.controller.enable();

  r.backend.lose();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(r.controller.getState !== undefined, true);
  const state = (r.controller as unknown as { state: { status: string } }).state;
  assert.equal(state.status, 'off');
  assert.equal(r.serveText(), before);
});

test('pending approvals and devices from the backend reach the state', async () => {
  const r = rig();
  await r.controller.enable();
  r.backend.emit({
    event: 'pending_pairing',
    pending: [{ pending_id: 'p1', label: 'iPhone', user_agent: 'iPhone · Safari', login: OWNER, created_at: 1, expires_at: 2 }],
  });
  r.backend.emit({
    event: 'sessions_changed',
    devices: [{ device_id: 'd1', label: 'iPhone', user_agent: '', login: OWNER, approved_at: 1, last_seen: 2, connected: true }],
    connected: 1,
  });
  const state = (r.controller as unknown as { state: { pending: unknown[]; devices: unknown[]; connected: number } }).state;
  assert.equal(state.pending.length, 1);
  assert.equal(state.devices.length, 1);
  assert.equal(state.connected, 1);
});

test('keep awake is on by default, runs only while enabled and is stored', async () => {
  const r = rig();
  await r.controller.enable();
  assert.deepEqual(r.powerEvents, ['start']);
  await r.controller.setKeepAwake(false);
  assert.deepEqual(r.powerEvents, ['start', 'stop:7']);
  await r.controller.setKeepAwake(true);
  assert.deepEqual(r.powerEvents, ['start', 'stop:7', 'start']);
  await r.controller.disable();
  assert.deepEqual(r.powerEvents, ['start', 'stop:7', 'start', 'stop:7']);
  const prefs = JSON.parse(readFileSync(join(r.dir, 'remote-view', 'prefs.json'), 'utf-8'));
  assert.equal(prefs.keepAwake, true);
});

test('with keep awake off nothing is started', async () => {
  const r = rig();
  await r.controller.setKeepAwake(false);
  await r.controller.enable();
  assert.deepEqual(r.powerEvents, []);
});

test('pairing helpers pass through to the backend and the code carries a QR', async () => {
  const r = rig();
  await r.controller.enable();
  const code = await r.controller.newCode();
  assert.equal(code.url, `https://${HOST}:8448/remote/#pair=tok_abc-123`);
  assert.equal(code.expiresAt, 1_900_000_000);
  assert.ok(code.qrSvg?.includes(code.url));
  await r.controller.approve('p1');
  await r.controller.deny('p2');
  await r.controller.revoke('d1');
  await r.controller.revokeAll();
  await r.controller.setExposure('/Users/me/Footage', true);
  assert.deepEqual(
    r.backend.requests.map((x) => x.type).filter((t) => ['approve', 'deny', 'revoke', 'revoke_all', 'set_exposure'].includes(t)),
    ['approve', 'deny', 'revoke', 'revoke_all', 'set_exposure'],
  );
  await r.controller.disable();
  await assert.rejects(() => r.controller.newCode(), /Remote View is off/);
});

test('the shutdown path disables Remote View and never throws', async () => {
  const r = rig();
  const before = r.serveText();
  await r.controller.enable();
  await r.controller.shutdown();
  assert.equal(r.serveText(), before);
  assert.equal(r.backend.count('disable'), 1);
  await r.controller.shutdown();
});

test('checkPort accepts a free port and our own recorded handler only', () => {
  const cfg = otherApps();
  assert.deepEqual(checkPort(cfg, HOST, 8448, undefined), { ok: true, ownedStale: false });
  const record: ServeOwnerRecord = { host: HOST, port: 8448, mount: '/remote', target: EXPECTED_TARGET, ownerLogin: OWNER };
  cfg.TCP!['8448'] = { HTTPS: true };
  cfg.Web![`${HOST}:8448`] = { Handlers: { '/remote': { Proxy: EXPECTED_TARGET } } };
  assert.deepEqual(checkPort(cfg, HOST, 8448, record), { ok: true, ownedStale: true });
  assert.equal(checkPort(cfg, HOST, 8448, undefined).ok, false, 'without a record it is someone else\'s');
  assert.equal(checkPort(cfg, HOST, 8448, { ...record, target: 'http://127.0.0.1:1/BBBBBBBBBBBBBBBBBBBB/' }).ok, false);
  // 8443 is the owner's other app; 8448 differs from it
  assert.deepEqual(checkPort(cfg, HOST, 8444, undefined), { ok: true, ownedStale: false });
  assert.equal(checkPort(cfg, HOST, 8443, undefined).ok, false);
});
