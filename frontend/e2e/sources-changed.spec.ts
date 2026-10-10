import { expect, test, type Page } from '@playwright/test';

// A verified phone import makes the backend publish `sources-changed`; the
// source list must refresh without a manual rescan. Stubbed: the page's
// EventSource is replaced so the test decides when the event arrives.

const folderPath = '/tmp/sources-changed';

function video(fileName: string, index: number) {
  return {
    file_id: fileName,
    file_name: fileName,
    status: 'ready',
    metadata: {
      file_id: fileName,
      file_name: fileName,
      duration_sec: 10 + index,
      fps: 30,
      resolution: [1920, 1080] as [number, number],
      codec: 'h264',
      size_bytes: 1_000_000 + index,
      created_at: '2026-10-10T10:00:00Z',
    },
  };
}

async function openProject(page: Page, sources: () => ReturnType<typeof video>[]) {
  let sourcesRequests = 0;
  await page.addInitScript((path) => {
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      listeners = new Map<string, Array<() => void>>();
      url: string;
      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
      }
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      close() {}
    }
    Object.assign(window, {
      EventSource: FakeEventSource,
      __emitProjectEvent: (type: string) => {
        for (const instance of FakeEventSource.instances) {
          for (const listener of instance.listeners.get(type) ?? []) listener();
        }
      },
      __eventSourceUrls: () => FakeEventSource.instances.map((instance) => instance.url),
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath: path, lastOpenedAt: '2026-10-10T10:00:00Z', name: 'Phone footage' }],
        getLastOpenedRecentProject: async () => ({ folderPath: path, lastOpenedAt: '2026-10-10T10:00:00Z', name: 'Phone footage' }),
        addRecentProject: async () => [{ folderPath: path, lastOpenedAt: '2026-10-10T10:00:00Z', name: 'Phone footage' }],
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.4.0', latestVersion: '0.4.0' }),
      },
    });
  }, folderPath);

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'sources-project',
          project_folder: folderPath,
          project: {
            schema_version: 2,
            name: 'Phone footage',
            created_at: '2026-10-10T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: [],
            settings_overrides: {},
          },
          videos: sources(),
          generation_stats: null,
        }),
      });
      return;
    }
    if (url.pathname === '/projects/sources-project/sources') {
      sourcesRequests += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ project_id: 'sources-project', project: null, videos: sources() }),
      });
      return;
    }
    if (url.pathname === '/harnesses') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ harnesses: [] }) });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/import');
  await expect(page.getByRole('button', { name: 'Rescan Folder', exact: true })).toBeVisible();
  return { sourcesRequests: () => sourcesRequests };
}

test('the source list refreshes when the backend reports sources-changed', async ({ page }) => {
  let list = [video('Shoreline.MP4', 0)];
  const probe = await openProject(page, () => list);

  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __eventSourceUrls: () => string[] }).__eventSourceUrls())).toContain(
    'http://127.0.0.1:8000/projects/sources-project/events',
  );

  // The Mac imported a verified phone upload.
  list = [...list, video('IMG_1234-phone-ab12cd34.mov', 1)];
  await page.evaluate(() => (window as unknown as { __emitProjectEvent: (type: string) => void }).__emitProjectEvent('sources-changed'));

  await expect(page.locator('[data-source-video-row]')).toHaveCount(2);
  await expect(page.locator('.source-video-name', { hasText: 'IMG_1234-phone-ab12cd34.mov' })).toBeVisible();
  expect(probe.sourcesRequests()).toBe(1);
});

test('timeline-changed events do not refetch the source list', async ({ page }) => {
  const probe = await openProject(page, () => [video('Shoreline.MP4', 0)]);
  await page.evaluate(() => (window as unknown as { __emitProjectEvent: (type: string) => void }).__emitProjectEvent('timeline-changed'));
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  expect(probe.sourcesRequests()).toBe(0);
});
