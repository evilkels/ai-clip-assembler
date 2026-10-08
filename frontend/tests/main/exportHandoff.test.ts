import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRevealExportFile } from '../../src/main/exportHandoff.js';

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

test('handleRevealExportFile rejects invalid paths without revealing', async () => {
  const calls: string[] = [];
  for (const value of ['', '   ', null, 'timeline.edl']) {
    await assert.rejects(
      handleRevealExportFile('trusted-window', value, {
        assertSender: () => {},
        showItemInFolder: (path) => calls.push(path),
      }),
      /absolute export file path/i,
    );
  }
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
