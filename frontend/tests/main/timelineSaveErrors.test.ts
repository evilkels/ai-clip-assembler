import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTimelineOp, redoTimeline, undoTimeline } from '../../src/renderer/src/api/client.js';

for (const [name, save] of [
  ['operation', () => applyTimelineOp('p', 'set_speed', { item_id: 'i', speed: 2 })],
  ['undo', () => undoTimeline('p')],
  ['redo', () => redoTimeline('p')],
] as const) {
  test(`${name} preserves the backend save error for the Editor`, async (t) => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
    t.mock.method(globalThis, 'fetch', async () => new Response(
      JSON.stringify({ detail: 'Could not save timeline.json: disk full' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    ));
    await assert.rejects(save, { message: 'Could not save timeline.json: disk full' });
  });
}
