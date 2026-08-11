import { expect, test, type Page } from '@playwright/test';

const folderPath = '/Users/elvijs/Projects/' + 'x'.repeat(1_400);
const projectName = 'Long Footage';
const videos = Array.from({ length: 7 }, (_, index) => ({
  file_id: `video-${index + 1}`,
  file_name: `drone-footage-${index + 1}.MP4`,
  status: 'ready',
  metadata: {
    file_id: `video-${index + 1}`,
    file_name: `drone-footage-${index + 1}.MP4`,
    duration_sec: 12,
    fps: 59.94,
    resolution: [3840, 2160],
    codec: 'hevc',
    size_bytes: 12_000_000,
    created_at: '2026-08-11T10:00:00Z',
  },
}));

async function openFolderProject(page: Page): Promise<void> {
  await page.addInitScript(({ path, name }) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }],
        getLastOpenedRecentProject: async () => ({ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }),
        addRecentProject: async () => [{ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }],
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, { path: folderPath, name: projectName });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'shell-regression-project',
          project_folder: folderPath,
          project: {
            schema_version: 1,
            name: projectName,
            created_at: '2026-08-11T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: videos.map((video) => ({ filename: video.file_name, imported_at: '2026-08-11T10:00:00Z' })),
            settings_overrides: {},
          },
          videos,
          clips: [],
          timeline: null,
          generation_stats: null,
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clips: [] }) });
      return;
    }
    if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
          sequence_fingerprint: '',
          review_context_fingerprint: '',
        }),
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
  await expect(page.getByText('7 source videos ready')).toBeVisible();
}

async function measureImportLayout(page: Page) {
  return page.evaluate(() => {
    const pageElement = document.querySelector('.page') as HTMLElement;
    const main = document.querySelector('.main') as HTMLElement;
    const table = document.querySelector('table') as HTMLElement;
    const mainBox = main.getBoundingClientRect();
    return {
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
      mainRight: mainBox.right,
      tableRight: table.getBoundingClientRect().right,
      headers: [...document.querySelectorAll('th')].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    };
  });
}

test.describe('import page horizontal geometry', () => {
  test.describe('at the 1024px minimum width', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('keeps the page and source table inside the main column', async ({ page }) => {
      await openFolderProject(page);
      const layout = await measureImportLayout(page);

      expect(layout.pageScrollWidth).toBe(layout.pageClientWidth);
      expect(layout.tableRight).toBeLessThanOrEqual(layout.mainRight);
      expect(layout.headers.every((header) => header.left >= 238 && header.right <= layout.mainRight)).toBe(true);
    });
  });

  test.describe('at 1440px', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('keeps the page and source table inside the main column', async ({ page }) => {
      await openFolderProject(page);
      const layout = await measureImportLayout(page);

      expect(layout.pageScrollWidth).toBe(layout.pageClientWidth);
      expect(layout.tableRight).toBeLessThanOrEqual(layout.mainRight);
      expect(layout.headers.every((header) => header.left >= 238 && header.right <= layout.mainRight)).toBe(true);
    });
  });
});
