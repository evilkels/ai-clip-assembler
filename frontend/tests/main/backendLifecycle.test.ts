import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupStaleBackend,
  readRuntimeDescriptor,
  runtimeDescriptorMatchesBackend,
} from '../../src/main/backendLifecycle.js';

test('readRuntimeDescriptor returns undefined for missing or invalid files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  try {
    assert.equal(await readRuntimeDescriptor(join(dir, 'missing.json')), undefined);
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, '{"pid":"not-a-number"}', 'utf-8');
    assert.equal(await readRuntimeDescriptor(invalid), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtimeDescriptorMatchesBackend only trusts the packaged backend command', () => {
  assert.equal(
    runtimeDescriptorMatchesBackend('/Applications/AI Clip Assembler.app/Contents/Resources/backend/ai-clip-backend', {
      pid: 123,
      command: '/Applications/AI Clip Assembler.app/Contents/Resources/backend/ai-clip-backend',
      backendExecutable: '/Applications/AI Clip Assembler.app/Contents/Resources/backend/ai-clip-backend',
    }),
    true,
  );

  assert.equal(
    runtimeDescriptorMatchesBackend('/usr/bin/python -m http.server 8123', {
      pid: 456,
      command: '/usr/bin/python -m http.server 8123',
      backendExecutable: '/Applications/AI Clip Assembler.app/Contents/Resources/backend/ai-clip-backend',
    }),
    false,
  );
});

test('cleanupStaleBackend terminates matching descriptor pid and clears runtime file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  const runtimeFile = join(dir, 'runtime.json');
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  try {
    await writeFile(
      runtimeFile,
      JSON.stringify({ port: 8123, pid: 4321, active_project_id: null, updated_at: new Date().toISOString() }),
      'utf-8',
    );

    const result = await cleanupStaleBackend({
      runtimeFile,
      backendExecutable: '/app/backend/ai-clip-backend',
      inspectProcessCommand: async () => '/app/backend/ai-clip-backend',
      killPid: (pid, signal) => {
        killed.push({ pid, signal });
      },
      waitForExit: async () => true,
    });

    assert.deepEqual(result, { cleaned: true, reason: 'terminated' });
    assert.deepEqual(killed, [{ pid: 4321, signal: 'SIGTERM' }]);
    assert.equal(await readRuntimeDescriptor(runtimeFile), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleBackend escalates when matching backend ignores SIGTERM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  const runtimeFile = join(dir, 'runtime.json');
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  try {
    await writeFile(
      runtimeFile,
      JSON.stringify({ port: 8123, pid: 4321, active_project_id: null, updated_at: new Date().toISOString() }),
      'utf-8',
    );

    const result = await cleanupStaleBackend({
      runtimeFile,
      backendExecutable: '/app/backend/ai-clip-backend',
      inspectProcessCommand: async () => '/app/backend/ai-clip-backend',
      killPid: (pid, signal) => {
        killed.push({ pid, signal });
      },
      waitForExit: async (_pid, signal) => signal === 'SIGKILL',
    });

    assert.deepEqual(result, { cleaned: true, reason: 'killed' });
    assert.deepEqual(killed, [
      { pid: 4321, signal: 'SIGTERM' },
      { pid: 4321, signal: 'SIGKILL' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleBackend treats a process that vanishes before SIGTERM as not running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  const runtimeFile = join(dir, 'runtime.json');
  try {
    await writeFile(
      runtimeFile,
      JSON.stringify({ port: 8123, pid: 4321, active_project_id: null, updated_at: new Date().toISOString() }),
      'utf-8',
    );

    const error = new Error('no such process') as NodeJS.ErrnoException;
    error.code = 'ESRCH';

    const result = await cleanupStaleBackend({
      runtimeFile,
      backendExecutable: '/app/backend/ai-clip-backend',
      inspectProcessCommand: async () => '/app/backend/ai-clip-backend',
      killPid: () => {
        throw error;
      },
      waitForExit: async () => false,
    });

    assert.deepEqual(result, { cleaned: true, reason: 'not-running' });
    assert.equal(await readRuntimeDescriptor(runtimeFile), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleBackend treats a process that vanishes before SIGKILL as stopped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  const runtimeFile = join(dir, 'runtime.json');
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  try {
    await writeFile(
      runtimeFile,
      JSON.stringify({ port: 8123, pid: 4321, active_project_id: null, updated_at: new Date().toISOString() }),
      'utf-8',
    );

    const error = new Error('no such process') as NodeJS.ErrnoException;
    error.code = 'ESRCH';

    const result = await cleanupStaleBackend({
      runtimeFile,
      backendExecutable: '/app/backend/ai-clip-backend',
      inspectProcessCommand: async () => '/app/backend/ai-clip-backend',
      killPid: (pid, signal) => {
        killed.push({ pid, signal });
        if (signal === 'SIGKILL') throw error;
      },
      waitForExit: async () => false,
    });

    assert.deepEqual(result, { cleaned: true, reason: 'not-running' });
    assert.deepEqual(killed, [
      { pid: 4321, signal: 'SIGTERM' },
      { pid: 4321, signal: 'SIGKILL' },
    ]);
    assert.equal(await readRuntimeDescriptor(runtimeFile), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupStaleBackend does not terminate a reused pid that is not the backend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clip-runtime-'));
  const runtimeFile = join(dir, 'runtime.json');
  const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  try {
    await writeFile(
      runtimeFile,
      JSON.stringify({ port: 8123, pid: 4321, active_project_id: null, updated_at: new Date().toISOString() }),
      'utf-8',
    );

    const result = await cleanupStaleBackend({
      runtimeFile,
      backendExecutable: '/app/backend/ai-clip-backend',
      inspectProcessCommand: async () => '/usr/bin/python -m http.server',
      killPid: (pid, signal) => {
        killed.push({ pid, signal });
      },
      waitForExit: async () => true,
    });

    assert.deepEqual(result, { cleaned: false, reason: 'pid-reused' });
    assert.deepEqual(killed, []);
    assert.equal(JSON.parse(await readFile(runtimeFile, 'utf-8')).pid, 4321);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
