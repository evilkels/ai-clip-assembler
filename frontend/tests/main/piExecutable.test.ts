import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PI_BIN_RESOLUTION_MARKER,
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
