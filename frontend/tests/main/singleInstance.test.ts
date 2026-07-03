import test from 'node:test';
import assert from 'node:assert/strict';
import { installSingleInstanceGuard, type FocusableWindow, type SingleInstanceApp } from '../../src/main/singleInstance.js';

function createApp(lockGranted: boolean): SingleInstanceApp & { quitCalls: number; secondInstance?: () => void } {
  return {
    quitCalls: 0,
    requestSingleInstanceLock: () => lockGranted,
    quit() {
      this.quitCalls += 1;
    },
    on(_event, listener) {
      this.secondInstance = listener;
    },
  };
}

test('installSingleInstanceGuard quits immediately when another app instance owns the lock', () => {
  const app = createApp(false);
  const focused: FocusableWindow[] = [];

  const shouldStart = installSingleInstanceGuard(app, { getAllWindows: () => focused });

  assert.equal(shouldStart, false);
  assert.equal(app.quitCalls, 1);
  assert.equal(app.secondInstance, undefined);
});

test('installSingleInstanceGuard focuses and restores the first app window for a second instance', () => {
  const app = createApp(true);
  const calls: string[] = [];
  const window: FocusableWindow = {
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus'),
  };

  const shouldStart = installSingleInstanceGuard(app, { getAllWindows: () => [window] });
  app.secondInstance?.();

  assert.equal(shouldStart, true);
  assert.equal(app.quitCalls, 0);
  assert.deepEqual(calls, ['restore', 'focus']);
});
