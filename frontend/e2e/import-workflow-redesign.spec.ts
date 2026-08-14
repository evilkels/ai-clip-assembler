import { expect, test, type Page } from '@playwright/test';

const folderPath = '/Users/elvijs/Projects/import-redesign';
const videos = [
  ['shoreline', 'Shoreline sunrise.MP4', '2026-08-10T10:00:00Z'],
  ['valley', 'Valley pass.MOV', '2026-08-11T10:00:00Z'],
  ['forest', 'Forest orbit.MP4', '2026-08-12T10:00:00Z'],
].map(([file_id, file_name, created_at], index) => ({
  file_id,
  file_name,
  status: 'ready',
  metadata: {
    file_id,
    file_name,
    duration_sec: 12 + index,
    fps: 59.94,
    resolution: [3840, 2160] as [number, number],
    codec: 'hevc',
    size_bytes: 12_000_000 + index,
    created_at,
  },
}));

async function openImportFixture(page: Page): Promise<void> {
  await page.addInitScript((path) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath: path, lastOpenedAt: '2026-08-12T10:00:00Z', name: 'Import redesign' }],
        getLastOpenedRecentProject: async () => ({ folderPath: path, lastOpenedAt: '2026-08-12T10:00:00Z', name: 'Import redesign' }),
        addRecentProject: async () => [{ folderPath: path, lastOpenedAt: '2026-08-12T10:00:00Z', name: 'Import redesign' }],
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.6', latestVersion: '0.1.6' }),
      },
    });
  }, folderPath);

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'import-redesign-project',
          project_folder: folderPath,
          project: {
            schema_version: 1,
            name: 'Import redesign',
            created_at: '2026-08-12T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: videos.map((video) => ({ filename: video.file_name, imported_at: '2026-08-12T10:00:00Z' })),
            settings_overrides: {},
          },
          videos,
          generation_stats: null,
        }),
      });
      return;
    }
    if (url.pathname === '/harnesses') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ harnesses: [] }) });
      return;
    }
    if (url.pathname.endsWith('/analyze')) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'import-redesign-project',
          harness_id: 'manual',
          status: 'complete',
          clips: [],
          sequence: { items: [] },
          recommendation: { profile: 'cinematic_highlight', target_duration_sec: 120, format: 'fcpxml' },
        }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/import');
  await expect(page.getByText('3 source videos ready')).toBeVisible();
}

test('source browser switches views, filters filenames, and preserves selection identity', async ({ page }) => {
  await openImportFixture(page);

  await expect(page.getByRole('group', { name: 'Source video view' })).toBeVisible();
  await page.getByRole('button', { name: 'Thumbs' }).click();
  await expect(page.locator('[data-view-mode="thumbs"]')).toBeVisible();
  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page.locator('[data-view-mode="compact"]')).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();

  await page.getByRole('searchbox', { name: 'Search source videos' }).fill('Valley');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect(page.getByText('Valley pass.MOV')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Valley pass.MOV' }).uncheck();
  await page.getByRole('searchbox', { name: 'Search source videos' }).fill('');
  await expect(page.getByText('2 of 3 selected')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Valley pass.MOV' })).not.toBeChecked();
});

test('source browser offers analysis filters and column choices', async ({ page }) => {
  await openImportFixture(page);

  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('unanalyzed');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(page.getByRole('group', { name: 'Source video columns' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Duration column' }).uncheck();
  await expect(page.locator('th', { hasText: 'Duration' })).toHaveCount(0);
});

test('analysis rail exposes abort, progress phases, and theme-aware accent surface', async ({ page }) => {
  await openImportFixture(page);

  await page.getByRole('button', { name: 'Analyze all 3' }).click();
  await expect(page.getByRole('button', { name: 'Abort' })).toBeVisible();
  await expect(page.locator('[data-analysis-rail]')).toHaveAttribute('data-tone', 'accent');
  await expect(page.getByText('Running in the background')).toBeVisible();

  const colors = await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    const dark = getComputedStyle(document.querySelector('[data-analysis-rail]')!).backgroundColor;
    root.setAttribute('data-theme', 'light');
    const light = getComputedStyle(document.querySelector('[data-analysis-rail]')!).backgroundColor;
    return { dark, light };
  });
  expect(colors.dark).not.toBe(colors.light);
  await page.getByRole('button', { name: 'Abort' }).click();
});
