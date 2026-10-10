/**
 * Vertical-aware previews: Review "Suggested cuts" players and the Timeline
 * preview take their aspect from the first clip's source, and the Timeline's
 * "All items" rail fits portrait iPhone filenames without scrolling sideways.
 *
 * Runs on the deterministic fixture protocol that visual-conformance uses, with
 * the source metadata swapped for portrait (or landscape) footage.
 */
import { expect, test, type Page } from '@playwright/test';

const PROJECT_ID = 'vertical-previews-project';
const PROJECT_FOLDER = '/tmp/ai-clip-assembler/IPHONE_TRIP';

type Orientation = 'portrait' | 'landscape';

function sources(orientation: Orientation) {
  return [1023, 1024, 1025].map((number, index) => {
    const fileName = `IMG_${number}_HEVC.mov`;
    const portrait = orientation === 'portrait';
    return {
      file_id: `vertical-source-${index + 1}`,
      file_name: fileName,
      status: 'ready',
      metadata: {
        file_id: `vertical-source-${index + 1}`,
        file_name: fileName,
        duration_sec: 12,
        fps: 30,
        resolution: [1920, 1080],
        display_resolution: portrait ? [1080, 1920] : [1920, 1080],
        rotation_degrees: portrait ? 90 : 0,
        codec: 'hevc',
        size_bytes: 120_000_000,
        created_at: '2026-10-10T10:00:00Z',
        has_audio: true,
        audio_channels: 2,
        audio_sample_rate: 48_000,
        audio_codec: 'aac',
      },
    };
  });
}

function clipsFor(videos: ReturnType<typeof sources>) {
  return videos.map((video, index) => ({
    clip_id: `vertical-clip-${index + 1}`,
    file_id: video.file_id,
    file_name: video.file_name,
    scene_id: index + 1,
    start_sec: 1,
    end_sec: 5,
    duration_sec: 4,
    smoothness_score: 8,
    sharpness_score: 8,
    exposure_score: 8,
    contrast_score: 8,
    visual_interest_score: 8,
    overall_score: 8,
    ai_reason: 'Steady handheld walk.',
    suggested_speed: 1,
    tags: ['walk'],
    source_created_at: '2026-10-10T10:00:00Z',
    source_duration_sec: 12,
  }));
}

async function installBackend(page: Page, orientation: Orientation): Promise<void> {
  const videos = sources(orientation);
  const clips = clipsFor(videos);
  const timelineItems = clips.map((clip) => ({
    item_id: `${clip.clip_id}-item`,
    source_clip_id: clip.clip_id,
    start_sec: clip.start_sec,
    end_sec: clip.end_sec,
    speed: 1,
    transform: { scale: 1, x: 0, y: 0 },
  }));
  const versionItems = clips.map((clip) => ({
    source_clip_id: clip.clip_id,
    file_id: clip.file_id,
    file_name: clip.file_name,
    start_sec: clip.start_sec,
    end_sec: clip.end_sec,
    speed: 1,
    transform: { scale: 1, x: 0, y: 0 },
  }));
  const versionSet = {
    version_set_id: 'vertical-version-set',
    created_at: '2026-10-10T10:04:00Z',
    based_on_timeline_revision: 4,
    based_on_sequence_fingerprint: 'vertical-sequence-fingerprint',
    based_on_review_context_fingerprint: 'vertical-review-fingerprint',
    versions: ['Walk and Talk', 'Quick Cut'].map((title, index) => ({
      version_id: `vertical-version-${index + 1}`,
      title,
      vibe: 'Balanced',
      rationale: 'A steady walk through the old town.',
      profile: 'cinematic_highlight',
      total_duration_sec: 12,
      items: versionItems,
      sequence_fingerprint: `vertical-version-${index + 1}-fingerprint`,
    })),
  };

  await page.addInitScript(({ folderPath }) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [],
        getLastOpenedRecentProject: async () => null,
        addRecentProject: async () => [],
        setWindowTitle: async () => {},
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.6', latestVersion: '0.1.6' }),
        revealExportFile: async () => {},
        openInDaVinci: async () => ({ opened: true }),
        folderPath,
      },
    });
    localStorage.setItem('aca:theme', 'light');
  }, { folderPath: PROJECT_FOLDER });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/projects/from-folder') {
      await json({
        project_id: PROJECT_ID,
        project_folder: PROJECT_FOLDER,
        project: {
          schema_version: 1,
          name: 'IPHONE_TRIP',
          created_at: '2026-10-10T10:00:00Z',
          harness: 'manual',
          cloud_ai_consent: false,
          source_videos: videos.map((video) => ({ filename: video.file_name, imported_at: '2026-10-10T10:00:00Z' })),
          settings_overrides: {},
        },
        videos,
        clips: [],
        timeline: null,
        generation_stats: null,
      });
    } else if (url.pathname === `/projects/${PROJECT_ID}/clips`) {
      await json({ clips });
    } else if (url.pathname === `/projects/${PROJECT_ID}/review/session`) {
      await json({
        schema_version: 1,
        session_id: 'vertical-review-session',
        updated_at: '2026-10-10T10:04:00Z',
        messages: [{
          message_id: 'vertical-review-message',
          role: 'agent',
          text: 'I prepared two directions.',
          created_at: '2026-10-10T10:04:00Z',
          reply_to_message_id: null,
          proposal: null,
          payload: { version_set: versionSet },
        }],
      });
    } else if (url.pathname === '/harnesses') {
      await json({ harnesses: [{ id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true }] });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await json({
        document: {
          version: 1,
          revision: 4,
          items: timelineItems,
          profile: 'cinematic_highlight',
          target_duration_sec: 15,
          decisions: Object.fromEntries(clips.map((clip) => [clip.clip_id, 'included'])),
        },
        sequence_fingerprint: 'vertical-sequence-fingerprint',
        review_context_fingerprint: 'vertical-review-fingerprint',
      });
    } else if (url.pathname === '/') {
      await json({ version: '0.1.6' });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
}

async function openFixture(
  page: Page,
  orientation: Orientation,
  fixture: 'review-grid' | 'timeline-selection',
  path: '/review' | '/timeline',
): Promise<void> {
  await installBackend(page, orientation);
  await page.goto(`/#/playwriter?fixture=${fixture}`);
  await expect(page.getByTestId('qa-fixture-ready')).toHaveText(fixture);
  await page.goto(`/#${path}?fixture=${fixture}`);
}

interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }

function boxOf(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  });
}

/** Source metadata can land after the cards mount, so poll the box rather than read it once. */
async function expectAspect(page: Page, selector: string, target: number): Promise<void> {
  await expect
    .poll(async () => {
      const box = await boxOf(page, selector);
      return Math.abs(box.width / box.height / target - 1);
    })
    .toBeLessThan(0.03);
}

test('portrait source: Suggested-cut players are tall and carry no in-video title', async ({ page }) => {
  await openFixture(page, 'portrait', 'review-grid', '/review');
  await expect(page.getByTestId('version-card')).toHaveCount(2);
  await expect
    .poll(async () => {
      const box = await boxOf(page, '.version-player');
      return box.width / box.height;
    })
    .toBeLessThan(0.7);
  expect((await boxOf(page, '.version-player')).height).toBeLessThanOrEqual(441);
  // The title renders once, under the player; the ▶ button has nothing to overlap.
  await expect(page.locator('.version-player .clip-preview-label')).toHaveCount(0);
  await expect(page.getByTestId('version-card').first().locator('.version-card-heading strong')).toHaveText('Walk and Talk');
});

test('landscape source: Suggested-cut players stay 16:9', async ({ page }) => {
  await openFixture(page, 'landscape', 'review-grid', '/review');
  await expect(page.getByTestId('version-card')).toHaveCount(2);
  await expectAspect(page, '.version-player', 16 / 9);
});

test('portrait source: Timeline preview hugs the picture and the info row sits below it', async ({ page }) => {
  await openFixture(page, 'portrait', 'timeline-selection', '/timeline');
  await expect(page.getByTestId('timeline-preview-stage')).toBeVisible();
  await expectAspect(page, '.timeline-preview .clip-preview', 9 / 16);
  const preview = await boxOf(page, '.timeline-preview .clip-preview');
  const meta = await boxOf(page, '.timeline-preview-meta');
  const overlaps =
    meta.left < preview.right && meta.right > preview.left &&
    meta.top < preview.bottom && meta.bottom > preview.top;
  expect(overlaps, 'info row must not overlay the picture').toBe(false);
  expect(meta.top).toBeGreaterThanOrEqual(preview.bottom);
});

test('landscape source: Timeline preview is 16:9', async ({ page }) => {
  await openFixture(page, 'landscape', 'timeline-selection', '/timeline');
  await expect(page.getByTestId('timeline-preview-stage')).toBeVisible();
  await expectAspect(page, '.timeline-preview .clip-preview', 16 / 9);
});

for (const theme of ['light', 'dark'] as const) {
  test(`All items rail shows filenames and every control without sideways scrolling · ${theme}`, async ({ page }) => {
    await openFixture(page, 'portrait', 'timeline-selection', '/timeline');
    await page.evaluate((next) => document.documentElement.setAttribute('data-theme', next), theme);
    const rail = page.locator('[data-timeline-item-rail]');
    await expect(rail).toBeVisible();
    await expect(page.getByTestId('timeline-item-row')).toHaveCount(3);

    const railBox = await boxOf(page, '[data-timeline-item-rail]');
    const removeBox = await page.getByTestId('timeline-item-row').last().getByRole('button', { name: 'Remove item' })
      .evaluate((element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { left, top, right, bottom };
      });
    expect(removeBox.left).toBeGreaterThanOrEqual(railBox.left);
    expect(removeBox.right).toBeLessThanOrEqual(railBox.right);
    expect(removeBox.top).toBeGreaterThanOrEqual(railBox.top);
    expect(removeBox.bottom).toBeLessThanOrEqual(railBox.bottom);

    await expect
      .poll(() =>
        page.locator('.timeline-editor-list').evaluate((element) => element.scrollWidth - element.clientWidth),
      )
      .toBeLessThanOrEqual(0);

    // At least the first 8 characters of the filename are visible.
    const name = await page.locator('.timeline-item-name').first().evaluate((element) => {
      const probe = document.createElement('span');
      probe.textContent = 'IMG_1023';
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      const style = getComputedStyle(element);
      probe.style.font = style.font;
      document.body.append(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { needed, available: element.clientWidth, text: element.textContent };
    });
    expect(name.text).toBe('IMG_1023_HEVC.mov');
    expect(name.available).toBeGreaterThanOrEqual(name.needed);
  });
}
