import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstExecutableCandidate,
  piExecutableCandidates,
  PI_BIN_RESOLUTION_MARKER,
  PI_SHELL_PROBE_ARGUMENTS,
  PI_SHELL_PROBE_COMMAND,
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

test('probes the interactive login shell first so rc-file PATH edits are visible', () => {
  // A non-interactive login shell never sources ~/.zshrc, where nvm/volta/asdf
  // export their bin directory — the exact reason `pi` went missing in the
  // packaged app while Terminal found it fine.
  assert.deepEqual(
    PI_SHELL_PROBE_ARGUMENTS.map((args) => args[0]),
    ['-lic', '-lc'],
  );
  for (const args of PI_SHELL_PROBE_ARGUMENTS) {
    assert.equal(args[1], PI_SHELL_PROBE_COMMAND);
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
