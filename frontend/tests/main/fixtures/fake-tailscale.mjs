#!/usr/bin/env node
// A fake `tailscale` CLI for the Remote View tests. It never touches real
// Tailscale configuration: Serve state lives in the JSON file named by
// FAKE_TAILSCALE_STATE, and every invocation's argv is appended to the file
// named by FAKE_TAILSCALE_LOG. `reset` and `funnel` are refused (and logged), so
// a test can prove the app never runs them.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const statePath = process.env.FAKE_TAILSCALE_STATE;
const logPath = process.env.FAKE_TAILSCALE_LOG;
const argv = process.argv.slice(2);

if (!statePath || !logPath) {
  console.error('FAKE_TAILSCALE_STATE and FAKE_TAILSCALE_LOG are required');
  process.exit(2);
}

appendFileSync(logPath, JSON.stringify(argv) + '\n');

const load = () => JSON.parse(readFileSync(statePath, 'utf-8'));
const save = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const state = load();
const failures = state.fail ?? {};

function flag(name) {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const [command, sub] = argv;

if (argv.includes('reset') || argv.includes('funnel') || command === 'funnel') {
  fail('FORBIDDEN: the app must never run serve reset or funnel');
}

if (command === 'status') {
  if (failures.status) fail('status failed');
  process.stdout.write(JSON.stringify(state.status) + '\n');
  process.exit(0);
}

if (command === 'serve' && sub === 'status') {
  if (failures.serveStatus) fail('serve status failed');
  process.stdout.write(JSON.stringify(state.serve ?? {}) + '\n');
  process.exit(0);
}

if (command === 'serve') {
  const port = flag('https');
  const path = flag('set-path');
  if (!port || !path) fail('expected --https and --set-path');
  const host = state.status.Self.DNSName.replace(/\.$/, '');
  const key = `${host}:${port}`;
  const target = argv[argv.length - 1];
  state.serve = state.serve ?? {};
  if (target === 'off') {
    if (failures.serveOff) fail('serve off failed');
    const web = state.serve.Web?.[key];
    if (web?.Handlers) {
      delete web.Handlers[path];
      if (Object.keys(web.Handlers).length === 0) {
        delete state.serve.Web[key];
        if (state.serve.TCP) delete state.serve.TCP[port];
      }
    }
    if (state.serve.Web && Object.keys(state.serve.Web).length === 0) delete state.serve.Web;
    if (state.serve.TCP && Object.keys(state.serve.TCP).length === 0) delete state.serve.TCP;
    save(state);
    process.exit(0);
  }
  if (failures.serveAdd) fail('serve add failed');
  if (!argv.includes('--bg')) fail('expected --bg');
  state.serve.TCP = state.serve.TCP ?? {};
  state.serve.Web = state.serve.Web ?? {};
  state.serve.TCP[port] = { HTTPS: true };
  state.serve.Web[key] = state.serve.Web[key] ?? { Handlers: {} };
  state.serve.Web[key].Handlers[path] = { Proxy: target };
  save(state);
  // Optional simulation: another app adds a Serve entry right after we add ours.
  if (state.afterAdd) {
    const next = load();
    for (const [k, v] of Object.entries(state.afterAdd.web ?? {})) next.serve.Web[k] = v;
    delete next.afterAdd;
    save(next);
  }
  process.exit(0);
}

fail(`unsupported command: ${argv.join(' ')}`);
