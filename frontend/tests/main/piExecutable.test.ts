import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  firstExecutableCandidate,
  piExecutableCandidates,
  PI_BIN_RESOLUTION_MARKER,
  resolvePiBinFromLoginShell,
  resolvePiExecutableFromShellOutput,
} from '../../src/main/piExecutable.js';

test('resolves the marked absolute executable after noisy shell output', async () => {
  const checked: string[] = [];
  const result = await resolvePiExecutableFromShellOutput(
    [
      'Welcome to the editor shell',
      'pi: aliased to pnpm pi',
      `${PI_BIN_RESOLUTION_MARKER}/opt/homebrew/bin/pi`,
      '',
    ].join('\n'),
    async (candidate: string) => {
      checked.push(candidate);
    },
  );

  assert.equal(result, '/opt/homebrew/bin/pi');
  assert.deepEqual(checked, ['/opt/homebrew/bin/pi']);
});

test('rejects non-absolute and non-executable marked shell results', async () => {
  let accessCalls = 0;
  assert.equal(
    await resolvePiExecutableFromShellOutput(
      `${PI_BIN_RESOLUTION_MARKER}pi\n`,
      async () => {
        accessCalls += 1;
      },
    ),
    undefined,
  );
  assert.equal(accessCalls, 0);

  assert.equal(
    await resolvePiExecutableFromShellOutput(
      `${PI_BIN_RESOLUTION_MARKER}/missing/pi\n`,
      async () => {
        throw new Error('not executable');
      },
    ),
    undefined,
  );
});

test('resolves Pi from a PATH printed by an interactive login shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-login-shell-'));
  const shellPath = join(directory, 'stub-shell');
  const piPath = join(directory, 'pi');
  await writeFile(piPath, '#!/bin/sh\nexit 0\n');
  await chmod(piPath, 0o755);
  await writeFile(
    shellPath,
    // Only an interactive login shell sees the directory holding pi, and the
    // probe command itself must run: `whence -p` is zsh, so define it here.
    [
      '#!/bin/sh',
      'PATH=/usr/bin:/bin',
      `if [ "$1" = "-lic" ]; then PATH="${directory}:$PATH"; fi`,
      'whence() { [ "$1" = "-p" ] && shift; command -v "$1"; }',
      'eval "$2"',
      '',
    ].join('\n'),
  );
  await chmod(shellPath, 0o755);

  const previousPiBin = process.env.PI_BIN;
  delete process.env.PI_BIN;
  try {
    assert.equal(await resolvePiBinFromLoginShell(shellPath), piPath);
  } finally {
    if (previousPiBin === undefined) delete process.env.PI_BIN;
    else process.env.PI_BIN = previousPiBin;
    await rm(directory, { recursive: true, force: true });
  }
});

test('offers nvm bin directories newest-first among the fallback candidates', async () => {
  const candidates = await piExecutableCandidates('/Users/x', async (path: string) => {
    assert.equal(path, '/Users/x/.nvm/versions/node');
    // v9 is deliberate: a lexicographic sort puts it first and passes a
    // two-digit-only fixture, so the fixture has to contain a single-digit
    // major for this test to discriminate at all.
    return ['v20.11.0', 'v24.15.0', 'v9.0.0', 'v22.1.0'];
  });

  assert.ok(candidates.includes('/opt/homebrew/bin/pi'));
  assert.deepEqual(candidates.slice(-4), [
    '/Users/x/.nvm/versions/node/v24.15.0/bin/pi',
    '/Users/x/.nvm/versions/node/v22.1.0/bin/pi',
    '/Users/x/.nvm/versions/node/v20.11.0/bin/pi',
    '/Users/x/.nvm/versions/node/v9.0.0/bin/pi',
  ]);
});

test('skips nvm candidates when nvm is not installed', async () => {
  const candidates = await piExecutableCandidates('/Users/x', async () => {
    throw new Error('ENOENT');
  });
  assert.ok(!candidates.some((candidate) => candidate.includes('.nvm')));
});

test('returns the first executable fallback candidate', async () => {
  const probed: string[] = [];
  const result = await firstExecutableCandidate(
    ['/opt/homebrew/bin/pi', '/usr/local/bin/pi'],
    async (candidate: string) => {
      probed.push(candidate);
      if (candidate !== '/usr/local/bin/pi') throw new Error('not executable');
    },
  );

  assert.equal(result, '/usr/local/bin/pi');
  assert.deepEqual(probed, ['/opt/homebrew/bin/pi', '/usr/local/bin/pi']);
  assert.equal(await firstExecutableCandidate([]), undefined);
});
