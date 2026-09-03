/**
 * E2E coverage for the workflow step gates (design reference `5a`).
 *
 * Every state is driven through the real renderer against a mocked backend, so
 * the assertions are about what the action bar actually renders rather than
 * about a fixture that hard-codes the answer. The rule under test: a step's
 * primary action is live only when the previous step produced the work the next
 * one needs, and a blocked primary always carries its reason and the action
 * that unblocks it.
 */
import { expect, test, type Page } from '@playwright/test';

const PROJECT_ID = 'gating-project';
const PROJECT_FOLDER = '/tmp/ai-clip-assembler/GATING';
const PROJECT_NAME = 'GATING';

const video = (index: number) => ({
  file_id: `gate-source-0${index}`,
  file_name: `gate-source-0${index}.mp4`,
  status: 'ready',
  metadata: {
    file_id: `gate-source-0${index}`,
    file_name: `gate-source-0${index}.mp4`,
    duration_sec: 10,
    fps: 30,
    resolution: [1920, 1080],
    codec: 'h264',
    size_bytes: 10_000_000,
    created_at: '2026-08-11T10:00:00Z',
    has_audio: false,
    audio_channels: 0,
    audio_sample_rate: null,
    audio_codec: null,
  },
});

const clip = {
  clip_id: 'gate-clip-01',
  file_id: 'gate-source-01',
  file_name: 'gate-source-01.mp4',
  scene_id: 1,
  start_sec: 1,
  end_sec: 4,
  duration_sec: 3,
  smoothness_score: 9,
  sharpness_score: 8,
  exposure_score: 8,
  contrast_score: 8,
  visual_interest_score: 9,
  overall_score: 8.6,
  ai_reason: 'Steady push over the ridge.',
  suggested_speed: 1,
  tags: [],
  source_created_at: '2026-08-11T10:00:00Z',
  source_duration_sec: 10,
};

const generationStats = {
  per_file: {},
  totals: { candidates_generated: 0, candidates_kept: 0, scenes_total: 3, scenes_at_cap: 0, videos: 4 },
  preferences: {
    min_clip_duration_sec: 1.5,
    max_clip_duration_sec: 8,
    smoothness_threshold: 7,
    max_turn_rate_deg_per_sec: 12,
    max_clips_per_scene: 4,
    max_candidates_per_video: 30,
  },
};

interface GateWorld {
  sourceCount: number;
  /** Candidate clips the project already has when it opens. */
  clips: typeof clip[];
  /** What POST /analyze resolves to. `'hang'` leaves the run in flight. */
  analyze: 'hang' | { clips: typeof clip[]; notices?: { code: string; level: string; message: string }[] };
}

async function installBackend(page: Page, world: GateWorld): Promise<void> {
  await page.addInitScript(({ folderPath, projectName }) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath, lastOpenedAt: '2026-08-11T10:00:00Z', name: projectName }],
        getLastOpenedRecentProject: async () => ({ folderPath, lastOpenedAt: '2026-08-11T10:00:00Z', name: projectName }),
        addRecentProject: async () => [{ folderPath, lastOpenedAt: '2026-08-11T10:00:00Z', name: projectName }],
        setWindowTitle: async () => {},
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' }),
      },
    });
    localStorage.setItem('aca:theme', 'dark');
  }, { folderPath: PROJECT_FOLDER, projectName: PROJECT_NAME });

  const videos = Array.from({ length: world.sourceCount }, (_, index) => video(index + 1));

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/projects/from-folder') {
      return json({
        project_id: PROJECT_ID,
        project_folder: PROJECT_FOLDER,
        project: {
          schema_version: 1,
          name: PROJECT_NAME,
          created_at: '2026-08-11T10:00:00Z',
          harness: 'manual',
          cloud_ai_consent: false,
          source_videos: videos.map((source) => ({ filename: source.file_name, imported_at: '2026-08-11T10:00:00Z' })),
          settings_overrides: {},
        },
        videos,
        clips: world.clips,
        timeline: null,
        generation_stats: world.clips.length > 0 ? generationStats : null,
      });
    }
    if (url.pathname === `/projects/${PROJECT_ID}/clips`) return json({ clips: world.clips });
    if (url.pathname === `/projects/${PROJECT_ID}/analyze`) {
      if (world.analyze === 'hang') {
        // Never resolves: the run stays in flight so the bar shows the
        // mid-analysis state rather than racing to completion.
        return new Promise<void>(() => {});
      }
      return json({
        project_id: PROJECT_ID,
        harness_id: 'manual',
        status: 'complete',
        clips: world.analyze.clips,
        sequence: null,
        recommendation: null,
        generation_stats: generationStats,
        notices: world.analyze.notices ?? [],
      });
    }
    if (url.pathname === `/projects/${PROJECT_ID}/analyze/status`) {
      // The renderer polls this while a run is in flight and writes the result
      // over its own state, so it has to agree with what POST /analyze does.
      if (world.analyze === 'hang') {
        return json({ phase: 'analyzing', step: 'motion_analysis', video_index: 1, video_total: world.sourceCount });
      }
      // The real backend carries the run's notices on the completed status
      // (`api.py` set_analysis_progress at completion), so the mock must too —
      // otherwise the poll would erase them a moment after the run reports.
      return json({ phase: 'complete', step: 'complete', notices: world.analyze.notices ?? [] });
    }
    if (url.pathname.endsWith('/timeline/document')) {
      return json({
        document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
        sequence_fingerprint: '',
        review_context_fingerprint: '',
      });
    }
    if (url.pathname === '/harnesses') {
      return json({ harnesses: [{ id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true }] });
    }
    if (url.pathname === '/') return json({ version: '0.2.0' });
    return route.fulfill({ status: 204, body: '' });
  });
}

const footer = (page: Page) => page.locator('.workflow-footer');
const reason = (page: Page) => footer(page).locator('.workflow-footer-gate-reason');
const blockedPrimary = (page: Page) => footer(page).locator('.btn.blocked');
const accent = (page: Page) => footer(page).locator('.btn.primary');

async function openImport(page: Page, world: GateWorld): Promise<void> {
  await installBackend(page, world);
  await page.goto('/#/import');
  await expect(page.locator('.page')).toBeVisible();
}

test('01 · an empty project blocks Review and moves the accent to Open Folder', async ({ page }) => {
  await openImport(page, { sourceCount: 0, clips: [], analyze: { clips: [] } });

  await expect(reason(page)).toHaveText('Open a folder or drop MP4/MOV files first.');
  await expect(blockedPrimary(page)).toHaveText('Continue to Review →');
  await expect(blockedPrimary(page)).toBeDisabled();
  await expect(accent(page)).toHaveText('Open Folder');
});

test('02 · loaded but unanalyzed sources block Review and offer the analyze run', async ({ page }) => {
  await openImport(page, { sourceCount: 4, clips: [], analyze: { clips: [] } });

  await expect(reason(page)).toHaveText('Analyze at least one video — Review has nothing to show.');
  await expect(blockedPrimary(page)).toBeDisabled();
  await expect(accent(page)).toHaveText('Analyze 4 videos');
  await expect(accent(page)).toBeEnabled();

  // The bar mirrors the selection: with nothing selected the unblocking action
  // is named but inert rather than absent.
  await page.getByRole('button', { name: 'Deselect all' }).click();
  await expect(accent(page)).toHaveText('Select videos to analyze');
  await expect(accent(page)).toBeDisabled();
});

test('03 · analysis with no candidate yet blocks with no action to offer', async ({ page }) => {
  await openImport(page, { sourceCount: 2, clips: [], analyze: 'hang' });

  await accent(page).click();
  await expect(reason(page)).toHaveText('Waiting for the first clip candidate…');
  await expect(blockedPrimary(page)).toBeDisabled();
  await expect(accent(page)).toHaveCount(0);
});

test('03b · one candidate is enough to continue while analysis is still running', async ({ page }) => {
  await openImport(page, { sourceCount: 2, clips: [clip], analyze: 'hang' });

  await page.getByTestId('source-video-selection-bar').getByRole('button', { name: /Analyze/ }).click();
  await expect(footer(page)).toHaveAttribute('data-gate', 'allowed');
  await expect(footer(page).locator('.workflow-footer-hint')).toHaveText('Runs in background');
  await expect(footer(page).getByRole('link', { name: 'Continue to Review →' })).toBeVisible();
});

test('04 · analysis that kept nothing names the thresholds and offers the rules', async ({ page }) => {
  await openImport(page, { sourceCount: 2, clips: [], analyze: { clips: [] } });

  await accent(page).click();
  await expect(reason(page)).toHaveText('No clip passed your rules.');
  await expect(footer(page).locator('.workflow-footer-copy span')).toHaveText(
    'how steady 7.0 · max turn 12°/s · scene min 1.5s',
  );
  await expect(accent(page)).toHaveText('Loosen rules and re-scan');

  // The accent action lands the editor on the control the reason names.
  await accent(page).click();
  await expect(page.getByLabel('How steady (0–10)')).toBeFocused();
});

test('05 · a warning notice rides along and never blocks', async ({ page }) => {
  await openImport(page, {
    sourceCount: 2,
    clips: [],
    analyze: {
      clips: [clip],
      notices: [{ code: 'harness_fallback', level: 'warning', message: 'pi agent unreachable · scored by local rules' }],
    },
  });

  await accent(page).click();
  await expect(footer(page)).toHaveAttribute('data-gate', 'allowed');
  const detail = footer(page).locator('.workflow-footer-copy span');
  await expect(detail).toHaveText('pi agent unreachable · scored by local rules');
  await expect(detail).toHaveAttribute('data-tone', 'warning');
  await expect(footer(page).getByRole('link', { name: 'Continue to Review →' })).toBeVisible();
});

test('06 · candidates unblock Review', async ({ page }) => {
  await openImport(page, { sourceCount: 2, clips: [clip], analyze: { clips: [] } });

  await expect(footer(page)).toHaveAttribute('data-gate', 'allowed');
  await expect(blockedPrimary(page)).toHaveCount(0);
  await expect(footer(page).getByRole('link', { name: 'Continue to Review →' })).toBeVisible();
});

test('the two later gates are gated too, and each names its own way out', async ({ page }) => {
  await installBackend(page, { sourceCount: 2, clips: [clip], analyze: { clips: [] } });

  // Review: the unblocking action is on this screen, so the bar states the
  // reason without offering a button that would navigate away from the fix.
  await page.goto('/#/review');
  await expect(reason(page)).toHaveText('Add at least one clip to the working timeline.');
  await expect(blockedPrimary(page)).toHaveText('Continue to Timeline →');
  await expect(accent(page)).toHaveCount(0);

  // Timeline: items come from Review, so here the accent really is a step back.
  await page.goto('/#/timeline');
  await expect(reason(page)).toHaveText('The timeline is empty — accept a clip in Review first.');
  await expect(blockedPrimary(page)).toHaveText('Continue to Export →');
  await expect(accent(page)).toHaveText('Back to Review');
});
