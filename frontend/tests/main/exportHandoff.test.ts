import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleRevealExportFile,
  validateRevealExportPath,
} from '../../src/main/exportHandoff.js';

test('validateRevealExportPath accepts a non-empty absolute path', () => {
  assert.equal(
    validateRevealExportPath('/Users/example/project/exports/timeline.xml'),
    '/Users/example/project/exports/timeline.xml',
  );
});

test('validateRevealExportPath rejects empty and relative paths', () => {
  assert.throws(() => validateRevealExportPath(''), /absolute export file path/i);
  assert.throws(() => validateRevealExportPath('exports/timeline.xml'), /absolute export file path/i);
  assert.throws(() => validateRevealExportPath('   '), /absolute export file path/i);
  assert.throws(() => validateRevealExportPath(null), /absolute export file path/i);
});

test('handleRevealExportFile checks the trusted sender and reveals a valid path once', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const result = await handleRevealExportFile('trusted-window', '/tmp/timeline.edl', {
    assertSender: (event) => events.push(event),
    showItemInFolder: (path) => calls.push(path),
  });

  assert.deepEqual(events, ['trusted-window']);
  assert.deepEqual(calls, ['/tmp/timeline.edl']);
  assert.deepEqual(result, { revealed: true });
});

test('handleRevealExportFile rejects invalid input without revealing', async () => {
  const calls: string[] = [];
  await assert.rejects(
    handleRevealExportFile('trusted-window', 'timeline.edl', {
      assertSender: () => {},
      showItemInFolder: (path) => calls.push(path),
    }),
    /absolute export file path/i,
  );
  assert.deepEqual(calls, []);
});

test('handleRevealExportFile rejects synchronous shell failures', async () => {
  await assert.rejects(
    handleRevealExportFile('trusted-window', '/tmp/timeline.edl', {
      assertSender: () => {},
      showItemInFolder: () => {
        throw new Error('shell unavailable');
      },
    }),
    /shell unavailable/i,
  );
});
