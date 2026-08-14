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
  let analysisStarted = false;
  let analysisCancelled = false;
  let analysisPollCount = 0;
  let releaseAnalysis: (() => void) | null = null;
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
      analysisStarted = true;
      analysisPollCount = 0;
      await new Promise<void>((resolve) => { releaseAnalysis = resolve; });
      analysisStarted = false;
      const cancelled = analysisCancelled;
      if (cancelled) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Analysis cancelled' }) });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'import-redesign-project',
          harness_id: 'manual',
          status: 'complete',
          clips: [{
            clip_id: 'analyzed-clip',
            file_id: 'shoreline',
            file_name: 'Shoreline sunrise.MP4',
            start_sec: 1,
            end_sec: 7,
            duration_sec: 6,
            smoothness_score: 8,
            overall_score: 8,
          }],
          sequence: { items: [] },
          recommendation: { profile: 'cinematic_highlight', target_duration_sec: 120, format: 'fcpxml' },
        }),
      });
      return;
    }
    if (url.pathname === '/__test/release-analysis') {
      releaseAnalysis?.();
      releaseAnalysis = null;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.pathname.endsWith('/analyze/cancel')) {
      analysisCancelled = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'cancelled' }) });
      return;
    }
    if (url.pathname.endsWith('/analyze/status')) {
      analysisPollCount += 1;
      const terminal = analysisPollCount > 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(analysisStarted && !terminal ? {
          phase: 'analyzing',
          step: 'frame_extraction',
          file_name: 'Valley pass.MOV',
          video_index: 2,
          video_total: 3,
          elapsed_sec: 18,
        } : analysisCancelled ? { phase: 'cancelled', message: 'Analysis cancelled' } : { phase: 'complete' }),
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
  const sizeHeader = page.locator('th').filter({ hasText: 'Size' });
  await sizeHeader.getByRole('button').click();
  await expect(sizeHeader).toHaveAttribute('aria-sort', 'ascending');
  await sizeHeader.getByRole('button').click();
  await expect(sizeHeader).toHaveAttribute('aria-sort', 'descending');

  await page.getByRole('searchbox', { name: 'Search source videos' }).fill('Valley');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect(page.locator('.source-video-name', { hasText: 'Valley pass.MOV' })).toBeVisible();
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
  await expect(page.getByText('Current video: Valley pass.MOV')).toBeVisible();
  await expect(page.getByText('18s elapsed')).toBeVisible();
  await expect(page.getByText(/about .* remaining/)).toBeVisible();
  await expect(page.locator('.analysis-phase-rail .active')).toHaveText('Extracting frames');
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

  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('running');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect(page.locator('.source-video-name', { hasText: 'Valley pass.MOV' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('unanalyzed');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(2);
  await expect(page.getByText('Analysis cancelled. Adjust your selection and analyze again when ready.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('running');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(0);
  await page.evaluate(() => fetch('http://127.0.0.1:8000/__test/release-analysis'));
});

test('completed analysis clears Running and marks the analyzed source', async ({ page }) => {
  await openImportFixture(page);

  await page.getByRole('button', { name: 'Analyze all 3' }).click();
  await expect(page.getByText('Current video: Valley pass.MOV')).toBeVisible();
  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('running');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect(page.getByText('Analysis complete. Head to Review to see clip candidates.')).toBeVisible();
  await expect(page.locator('[data-source-video-row]')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('unanalyzed');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(3);
  await page.evaluate(() => fetch('http://127.0.0.1:8000/__test/release-analysis'));
  await expect(page.getByRole('combobox', { name: 'Analysis filter' })).toHaveValue('unanalyzed');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Analysis filter' }).selectOption('analyzed');
  await expect(page.locator('[data-source-video-row]')).toHaveCount(1);
  await expect(page.locator('.source-video-name', { hasText: 'Shoreline sunrise.MP4' })).toBeVisible();
});

test('selection bar selects and deselects the complete source set', async ({ page }) => {
  await openImportFixture(page);

  const selectAll = page.getByRole('checkbox', { name: 'Select all videos' });
  await selectAll.uncheck();
  await expect(page.getByText('0 of 3 selected')).toBeVisible();
  await selectAll.check();
  await expect(page.getByText('3 of 3 selected')).toBeVisible();
  await selectAll.uncheck();
  await expect(page.getByText('0 of 3 selected')).toBeVisible();
});
