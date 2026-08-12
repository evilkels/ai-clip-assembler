import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUpdateChecker,
  evaluateRelease,
  fetchLatestRelease,
  isNewerVersion,
  parseVersion,
  RELEASES_PAGE_URL,
  type ReleaseSummary,
  type UpdateCheckState,
} from '../../src/main/updateCheck.js';

function createStateStore(initial: UpdateCheckState = {}) {
  let state = initial;
  return {
    readState: async () => state,
    writeState: async (next: UpdateCheckState) => {
      state = next;
    },
    current: () => state,
  };
}

const release = (tag: string): ReleaseSummary => ({
  tag,
  url: `https://github.com/evilkels/ai-clip-assembler/releases/tag/${tag}`,
});

test('parseVersion tolerates a leading v and rejects junk', () => {
  assert.deepEqual(parseVersion('v0.1.4'), { numbers: [0, 1, 4] });
  assert.deepEqual(parseVersion('1.2'), { numbers: [1, 2] });
  assert.deepEqual(parseVersion('1.0.0-beta.2'), { numbers: [1, 0, 0], prerelease: 'beta.2' });
  assert.equal(parseVersion('nightly'), null);
  assert.equal(parseVersion(''), null);
});

test('isNewerVersion compares numerically, not lexically', () => {
  assert.equal(isNewerVersion('0.1.10', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.4', '0.1.4'), false);
  assert.equal(isNewerVersion('0.1.3', '0.1.4'), false);
  assert.equal(isNewerVersion('0.2', '0.1.9'), true);
});

test('isNewerVersion treats a prerelease as older than the matching final release', () => {
  assert.equal(isNewerVersion('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.0-beta.1'), true);
});

test('isNewerVersion refuses to guess when either version is unparseable', () => {
  assert.equal(isNewerVersion('nightly', '0.1.0'), false);
  assert.equal(isNewerVersion('0.2.0', 'unknown'), false);
});

test('evaluateRelease reports an available update with the release URL', () => {
  const status = evaluateRelease({ currentVersion: '0.1.0', release: release('v0.1.4') });

  assert.equal(status.state, 'update-available');
  assert.equal(status.state === 'update-available' && status.latestVersion, '0.1.4');
  assert.equal(
    status.state === 'update-available' && status.releaseUrl,
    'https://github.com/evilkels/ai-clip-assembler/releases/tag/v0.1.4',
  );
});

test('evaluateRelease silences a dismissed version but not the next one', () => {
  const dismissed = evaluateRelease({
    currentVersion: '0.1.0',
    release: release('v0.1.4'),
    dismissedVersion: '0.1.4',
  });
  assert.equal(dismissed.state, 'dismissed');

  const nextRelease = evaluateRelease({
    currentVersion: '0.1.0',
    release: release('v0.1.5'),
    dismissedVersion: '0.1.4',
  });
  assert.equal(nextRelease.state, 'update-available');
});

test('evaluateRelease degrades to unknown for an unrecognized tag', () => {
  const status = evaluateRelease({ currentVersion: '0.1.0', release: release('nightly') });

  assert.equal(status.state, 'unknown');
});

test('checker caches a fresh result instead of hitting the network again', async () => {
  const store = createStateStore();
  let fetches = 0;
  let clock = Date.parse('2026-08-11T10:00:00.000Z');
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => {
      fetches += 1;
      return release('v0.1.4');
    },
    now: () => clock,
    checkIntervalMs: 60_000,
  });

  assert.equal((await checker.check()).state, 'update-available');
  assert.equal(fetches, 1);

  clock += 30_000;
  assert.equal((await checker.check()).state, 'update-available');
  assert.equal(fetches, 1, 'cache still fresh');

  clock += 60_000;
  await checker.check();
  assert.equal(fetches, 2, 'cache expired');
});

test('concurrent checks share one request instead of racing GitHub', async () => {
  const store = createStateStore();
  const pending: Array<(value: ReleaseSummary) => void> = [];
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: () =>
      new Promise<ReleaseSummary>((resolve) => {
        pending.push(resolve);
      }),
  });

  // The shell banner and the Settings section both check on mount.
  const first = checker.check();
  const second = checker.check();
  // Let the readState() microtasks drain so fetchRelease has been reached.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 1, 'both callers share one request');
  pending[0](release('v0.1.4'));
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);

  // Once settled, a later check is free to open its own request.
  const third = checker.check({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1](release('v0.1.5'));
  const status = await third;
  assert.equal(status.state === 'update-available' && status.latestVersion, '0.1.5');
});

test('a forced check refreshes after an in-flight non-forced check', async () => {
  const store = createStateStore();
  const pending: Array<(value: ReleaseSummary) => void> = [];
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: () =>
      new Promise<ReleaseSummary>((resolve) => {
        pending.push(resolve);
      }),
  });

  const initialCheck = checker.check();
  await new Promise((resolve) => setImmediate(resolve));
  const forcedCheck = checker.check({ force: true });

  assert.equal(pending.length, 1, 'the forced check waits for the existing request');
  pending[0](release('v0.1.4'));
  await initialCheck;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2, 'the forced check performs its own refresh');

  pending[1](release('v0.1.5'));
  const status = await forcedCheck;
  assert.equal(status.state === 'update-available' && status.latestVersion, '0.1.5');
});

test('checker force-refreshes past a fresh cache', async () => {
  const store = createStateStore({
    lastCheckedAt: '2026-08-11T10:00:00.000Z',
    release: release('v0.1.4'),
  });
  let fetches = 0;
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => {
      fetches += 1;
      return release('v0.1.5');
    },
    now: () => Date.parse('2026-08-11T10:00:30.000Z'),
    checkIntervalMs: 60_000,
  });

  const status = await checker.check({ force: true });

  assert.equal(fetches, 1);
  assert.equal(status.state === 'update-available' && status.latestVersion, '0.1.5');
});

test('checker falls back to the last known release when the network fails', async () => {
  const store = createStateStore({
    lastCheckedAt: '2026-08-01T10:00:00.000Z',
    release: release('v0.1.4'),
  });
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => {
      throw new Error('offline');
    },
    now: () => Date.parse('2026-08-11T10:00:00.000Z'),
  });

  const status = await checker.check();

  assert.equal(status.state, 'update-available');
});

test('checker reports unknown when it has never seen a release', async () => {
  const store = createStateStore();
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => {
      throw new Error('offline');
    },
  });

  const status = await checker.check();

  assert.equal(status.state, 'unknown');
  assert.equal(status.state === 'unknown' && status.detail, 'offline');
});

test('a dismissal does not survive a newer release', async () => {
  const store = createStateStore();
  let latest = release('v0.1.4');
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => latest,
    checkIntervalMs: 0,
  });

  await checker.check();
  assert.equal((await checker.dismiss('0.1.4')).state, 'dismissed');

  latest = release('v0.1.5');
  const status = await checker.check();

  assert.equal(status.state, 'update-available');
  assert.equal(store.current().dismissedVersion, undefined);
});

test('releaseUrl rejects a URL outside the project releases path', async () => {
  const store = createStateStore({
    release: { tag: 'v0.1.4', url: 'https://evil.example.com/releases/tag/v0.1.4' },
  });
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    ...store,
    fetchRelease: async () => release('v0.1.4'),
  });

  assert.equal(await checker.releaseUrl(), RELEASES_PAGE_URL);
});

test('fetchLatestRelease reads the tag and ignores an off-project html_url', async () => {
  const summary = await fetchLatestRelease(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.1.4', html_url: 'https://evil.example.com/x' }),
  }));

  assert.equal(summary.tag, 'v0.1.4');
  assert.equal(summary.url, RELEASES_PAGE_URL);
});

test('fetchLatestRelease surfaces HTTP failures and malformed payloads', async () => {
  await assert.rejects(
    fetchLatestRelease(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    /HTTP 403/,
  );
  await assert.rejects(
    fetchLatestRelease(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    /no tag_name/,
  );
});
