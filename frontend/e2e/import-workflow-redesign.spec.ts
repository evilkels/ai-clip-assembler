import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureVideo } from './reviewSetup';

const folderPath = '/tmp/import-redesign';
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

async function openImportFixture(
  page: Page,
  options: {
    progressFiles?: Array<{ file_name: string; video_index: number }>;
    statsFileNames?: string[];
  } = {},
): Promise<void> {
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
          generation_stats: options.statsFileNames
            ? {
                per_file: Object.fromEntries(
                  options.statsFileNames.map((name) => [name, {
                    candidates_generated: 0,
                    candidates_kept: 0,
                    scenes_total: 0,
                    scenes_at_cap: 0,
                    preferences: {},
                  }]),
                ),
                totals: { candidates_generated: 0, candidates_kept: 0, scenes_total: 0, scenes_at_cap: 0, videos: 2 },
                preferences: {},
              }
            : null,
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/poster')) {
      // Only the shoreline poster renders; the rest 404 like an unavailable frame.
      if (!url.pathname.includes('/videos/shoreline/')) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64',
        ),
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
      const sequenced = options.progressFiles?.[Math.min(analysisPollCount, options.progressFiles.length) - 1];
      if (sequenced && analysisStarted) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            phase: 'analyzing',
            step: 'frame_extraction',
            video_total: 3,
            elapsed_sec: 18,
            ...sequenced,
          }),
        });
        return;
      }
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
  await expect(page.getByRole('button', { name: 'Rescan Folder', exact: true })).toBeVisible();
  await expect(page.locator('.drop-zone')).toHaveCount(0);
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

test('Import exposes the literal workstation composition', async ({ page }) => {
  await openImportFixture(page);

  const workstation = page.locator('[data-import-workstation]');
  await expect(workstation).toBeVisible();
  await expect(workstation.locator('[data-source-aggregates]')).toContainText('3 files');
  await expect(workstation.locator('[data-source-toolbar]')).toBeVisible();
  await expect(workstation.locator('[data-selection-action-rail]')).toBeVisible();
  await expect(workstation.locator('[data-analysis-dock]')).toBeVisible();
  await expect(workstation.locator('[data-rules-region]')).toBeVisible();

  const order = await workstation.locator('[data-source-video-browser]').evaluate((browser) =>
    Array.from(browser.children).map((child) => child.getAttribute('data-region')),
  );
  expect(order).toEqual(['browser-head', 'source-toolbar', 'selection-action-rail', 'source-table']);
  await expect(page.locator('.workflow-footer .workflow-footer-actions')).toBeVisible();
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionAnimation = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.analysis-progress-bar')!, '::-webkit-progress-bar').animationName,
  );
  expect(reducedMotionAnimation).toBe('none');
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

test('a finished video reads Analyzed while the rest of the batch is still running', async ({ page }) => {
  await openImportFixture(page, {
    progressFiles: [
      { file_name: 'Shoreline sunrise.MP4', video_index: 1 },
      { file_name: 'Valley pass.MOV', video_index: 2 },
    ],
  });

  await page.getByRole('button', { name: 'Analyze all 3' }).click();
  const row = (name: string) => page.locator('[data-source-video-row]', { hasText: name });
  await expect(row('Valley pass.MOV')).toContainText('Running');
  await expect(row('Shoreline sunrise.MP4')).toContainText('✓ Analyzed');
  await expect(row('Forest orbit.MP4')).toContainText('— Not analyzed');
  await page.evaluate(() => fetch('http://127.0.0.1:8000/__test/release-analysis'));
});

test('Thumbs and Compact views span the browser; posters fall back to the file extension', async ({ page }) => {
  await openImportFixture(page, {
    statsFileNames: ['Shoreline sunrise.MP4', 'Valley pass.MOV'],
  });

  const browserWidth = await page.locator('[data-source-video-browser]').evaluate(
    (element) => element.getBoundingClientRect().width,
  );

  await page.getByRole('button', { name: 'Thumbs' }).click();
  const thumbs = page.locator('[data-view-mode="thumbs"]');
  await expect(thumbs).toBeVisible();
  const thumbsWidth = await thumbs.evaluate((element) => element.getBoundingClientRect().width);
  expect(thumbsWidth).toBeGreaterThan(browserWidth * 0.9);

  const card = (name: string) => page.locator('.source-video-card', { hasText: name });
  const analyzedPoster = card('Shoreline sunrise.MP4').locator('.source-video-poster img');
  await expect(analyzedPoster).toHaveAttribute('src', /\/videos\/shoreline\/poster\?at_ms=0$/);
  await expect
    .poll(() => analyzedPoster.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  // Poster request failed (404): placeholder shows the real extension.
  await expect(card('Valley pass.MOV').locator('.source-video-poster')).toHaveText('MOV');
  // Not analyzed yet: no poster request, extension placeholder.
  await expect(card('Forest orbit.MP4').locator('.source-video-poster')).toHaveText('MP4');
  await expect(card('Forest orbit.MP4').locator('.source-video-poster img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Compact' }).click();
  const compact = page.locator('[data-view-mode="compact"]');
  await expect(compact).toBeVisible();
  const compactWidth = await compact.evaluate((element) => element.getBoundingClientRect().width);
  expect(compactWidth).toBeGreaterThan(browserWidth * 0.9);
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

test('the select-all checkbox reports partial selection hidden by the filter', async ({ page }) => {
  await openImportFixture(page);

  // The header checkbox toggles every Source Video, not just the filtered rows,
  // so its mixed state has to answer for the ones the filter is hiding too.
  const selectAll = page.getByRole('checkbox', { name: 'Select all videos' });
  await page.getByRole('searchbox', { name: 'Search source videos' }).fill('Shoreline');
  await page.getByRole('checkbox', { name: 'Select Shoreline sunrise.MP4' }).uncheck();
  await expect(page.getByText('2 of 3 selected')).toBeVisible();

  await expect
    .poll(() => selectAll.evaluate((element) => (element as HTMLInputElement).indeterminate))
    .toBe(true);
  await expect(selectAll).not.toBeChecked();
});

test('the Selected Harness survives navigating away from Import and back', async ({ page }) => {
  // Real backend: the folder project is opened by the app's own startup auto-open,
  // so a reload re-derives the Selected Harness from what the backend persisted.
  const folder = mkdtempSync(join(tmpdir(), 'selected-harness-'));
  copyFileSync(fixtureVideo(), join(folder, 'harness-fixture.mp4'));
  const recent = { folderPath: folder, lastOpenedAt: '2026-08-12T10:00:00Z', name: 'Navigation project' };
  await page.addInitScript((project) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [project],
        getLastOpenedRecentProject: async () => project,
        addRecentProject: async () => [project],
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.6', latestVersion: '0.1.6' }),
      },
    });
  }, recent);

  await page.goto('/#/import');
  const harness = page.getByRole('combobox', { name: 'Harness' });
  await expect(harness).toHaveValue('manual');

  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/selected-harness') && response.request().method() === 'PUT',
  );
  await harness.selectOption('pi_agent');
  expect((await saved).ok()).toBe(true);
  await expect(harness).toHaveValue('pi_agent');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '2. Review' }).click();
  await expect(page).toHaveURL(/#\/review/);
  await page.getByRole('link', { name: '1. Import' }).click();
  await expect(page).toHaveURL(/#\/import/);
  await expect(harness).toHaveValue('pi_agent');

  await page.reload();
  await expect(harness).toHaveValue('pi_agent');
});
