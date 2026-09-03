import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.afterEach(async ({ page }) => {
  // Let in-flight route.fetch handlers finish before Playwright tears down the page.
  await page.unrouteAll({ behavior: 'wait' });
});

function fixtureVideo(): string {
  const directory = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(directory, 'review-browser-fixture.mp4');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=slateblue:size=640x360:rate=30',
      '-t', '8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file,
    ]);
  }
  return file;
}

async function openClips(page: Page): Promise<void> {
  const panel = page.getByTestId('source-clips-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-open', 'true');
}

interface AnalysisMetadataFixture {
  used_ai?: boolean;
  warning?: string;
  per_video: Array<{
    file_id: string;
    file_name: string;
    used_ai?: boolean;
    warning?: string;
  }>;
}

async function setupReview(
  page: Page,
  options: { harnessId?: 'manual' | 'pi_agent'; analysisMetadata?: AnalysisMetadataFixture } = {},
): Promise<void> {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/1 source video ready/)).toBeVisible();

  if (options.analysisMetadata) {
    await page.route('**/projects/*/analyze', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, metadata: options.analysisMetadata } });
    });
  }
  await page.getByLabel('Harness').selectOption(options.harnessId ?? 'manual');
  await page.getByTestId('source-video-selection-bar').getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({ timeout: 180_000 });
  await page.goto('/#/review');
  await openClips(page);
}

interface RawClipFixture {
  [key: string]: unknown;
  clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  smoothness_score: number;
  overall_score: number;
}

async function setupSeededReview(page: Page): Promise<{ timelineFile: string; timelineClipId: string }> {
  const timelineFile = 'Timeline source.MP4';
  let timelineClipId = '';
  let seededCandidates: RawClipFixture[] = [];

  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/1 source video ready/)).toBeVisible();

  const seedFromBase = (base: RawClipFixture): RawClipFixture[] => {
    timelineClipId = base.clip_id;
    const makeCandidate = (
      clipId: string,
      fileName: string,
      overall: number,
      smoothness: number,
    ): RawClipFixture => ({
      ...base,
      clip_id: clipId,
      file_name: fileName,
      overall_score: overall,
      smoothness_score: smoothness,
      start_sec: 1,
      end_sec: 5,
    });
    const timeline = makeCandidate(timelineClipId, timelineFile, 8, 8);
    const high = makeCandidate('seed-high', 'High score.MP4', 9.5, 4);
    const mid = makeCandidate('seed-mid', 'Mid score.MP4', 7, 7);
    const low = makeCandidate('seed-low', 'Low score.MP4', 3, 3);
    // Deliberately return a non-ranked order: Review projection must rank it.
    return [low, mid, timeline, high];
  };

  await page.route('**/projects/*/analyze', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { clips: RawClipFixture[] };
    seededCandidates = seedFromBase(body.clips[0]);
    await route.fulfill({ response, json: { ...body, clips: seededCandidates } });
  });
  await page.route('**/projects/*/timeline/document', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as {
      document: {
        items: Array<{ source_clip_id: string }>;
        decisions: Record<string, 'included' | 'excluded'>;
      };
      review_context_fingerprint: string;
    };
    const sourceClipId = body.document.items[0]?.source_clip_id;
    if (sourceClipId) timelineClipId = sourceClipId;
    body.document.decisions = {
      ...body.document.decisions,
      ...(sourceClipId ? { [sourceClipId]: 'included' as const } : {}),
      'seed-low': 'excluded',
    };
    await route.fulfill({ response, json: body });
  });
  await page.getByLabel('Harness').selectOption('manual');
  await page.getByTestId('source-video-selection-bar').getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({ timeout: 180_000 });

  await page.route('**/projects/*/clips', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { clips: RawClipFixture[] };
    seededCandidates = seedFromBase(body.clips[0]);
    await route.fulfill({ response, json: { ...body, clips: seededCandidates } });
  });

  await page.route('**/projects/*/review/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json() as { messages: unknown[] };
    const sessionUrl = new URL(route.request().url());
    const projectId = sessionUrl.pathname.split('/')[2];
    const snapshotResponse = await page.request.get(
      `${sessionUrl.origin}/projects/${projectId}/timeline/document`,
    );
    const snapshot = await snapshotResponse.json() as {
      document: { revision: number };
      sequence_fingerprint: string;
      review_context_fingerprint: string;
    };
    const source = seededCandidates[0] ?? {
      file_id: 'seed-file',
      file_name: timelineFile,
    };
    const item = (sourceClipId: string, fileName: string) => ({
      source_clip_id: sourceClipId,
      file_id: source.file_id,
      file_name: fileName,
      start_sec: 1,
      end_sec: 5,
      speed: 1,
      transform: { scale: 1, x: 0, y: 0 },
    });
    const versionSet = {
      version_set_id: 'seeded-review-browser-set',
      created_at: '2026-08-14T10:00:00Z',
      based_on_timeline_revision: snapshot.document.revision,
      based_on_sequence_fingerprint: snapshot.sequence_fingerprint,
      based_on_review_context_fingerprint: snapshot.review_context_fingerprint,
      versions: [
        {
          version_id: 'seed-version-a',
          title: 'Seeded A',
          vibe: 'balanced',
          rationale: 'Deterministic Review browser fixture.',
          profile: 'cinematic_highlight',
          total_duration_sec: 4,
          sequence_fingerprint: 'seed-sequence-a',
          items: [item(timelineClipId, timelineFile), item('seed-high', 'High score.MP4')],
        },
        {
          version_id: 'seed-version-b',
          title: 'Seeded B',
          vibe: 'punchy',
          rationale: 'Deterministic Review browser fixture.',
          profile: 'short_social',
          total_duration_sec: 4,
          sequence_fingerprint: 'seed-sequence-b',
          items: [item('seed-high', 'High score.MP4')],
        },
      ],
    };
    session.messages = [{
      message_id: 'seeded-review-browser-agent',
      role: 'agent',
      text: 'Seeded Review browser fixture.',
      created_at: '2026-08-14T10:00:00Z',
      reply_to_message_id: null,
      proposal: null,
      payload: { version_set: versionSet },
    }];
    await route.fulfill({ response, json: session });
  });

  await page.goto('/#/review');
  await openClips(page);
  return { timelineFile, timelineClipId };
}

test('switches Candidate Clip views, filters records, and avoids eager list media', async ({ page }) => {
  await setupReview(page);
  const browser = page.locator('[data-review-browser]');
  await expect(page.getByRole('group', { name: 'Candidate Clip view' })).toBeVisible();
  await expect(browser).toHaveAttribute('data-view-mode', 'grid');

  await page.getByRole('button', { name: 'List' }).click();
  await expect(browser).toHaveAttribute('data-view-mode', 'list');
  await expect(browser.locator('video')).toHaveCount(0);
  await expect(browser.locator('[data-review-clip]')).not.toHaveCount(0);

  await page.getByRole('button', { name: 'Filmstrip' }).click();
  await expect(browser).toHaveAttribute('data-view-mode', 'filmstrip');
  await expect(browser.locator('video')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Decision filter' }).selectOption('undecided');
  await expect(browser.locator('[data-review-count]')).toContainText('shown');
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(browser.locator('.clip-card')).not.toHaveCount(0);
});

// A 1x1 JPEG, so the poster path is covered regardless of whether the fixture
// project happens to have sampled frames on disk.
const POSTER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////' +
    '////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBAB' +
    'AAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

test('renders lazy posters and activates only the played Candidate Clip', async ({ page }) => {
  await page.route('**/videos/*/poster*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: POSTER_JPEG });
  });
  await setupReview(page);
  const browser = page.locator('[data-review-browser]');
  await expect(browser).toHaveAttribute('data-view-mode', 'grid');

  // No media element is created before a play is requested.
  await expect(browser.locator('video')).toHaveCount(0);
  const cards = browser.locator('.clip-card');
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  const posters = cards.locator('img');
  await expect(posters).toHaveCount(cardCount);
  expect(
    await posters.evaluateAll((images) =>
      images.map((image) => ({
        loading: image.getAttribute('loading'),
        decoding: image.getAttribute('decoding'),
      })),
    ),
  ).toEqual(Array.from({ length: cardCount }, () => ({ loading: 'lazy', decoding: 'async' })));

  // Playing one card activates exactly that card's video.
  await cards.first().getByRole('button', { name: 'Play clip' }).click();
  await expect(browser.locator('video')).toHaveCount(1);
});

test('falls back to a placeholder when a clip has no sampled frame', async ({ page }) => {
  // The plan requires a clip with no poster to still render and still play.
  await page.route('**/videos/*/poster*', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await setupReview(page);
  const browser = page.locator('[data-review-browser]');
  const card = browser.locator('.clip-card').first();

  await expect(card.getByText('Poster unavailable')).toBeVisible();
  await expect(card.locator('img')).toHaveCount(0);

  // Still playable despite the missing poster.
  await card.getByRole('button', { name: 'Play clip' }).click();
  await expect(card.locator('video')).toHaveCount(1);
});

test('previews play once by default and loop only when the toggle is pressed', async ({ page }) => {
  await setupReview(page);
  const browser = page.locator('[data-review-browser]');
  const card = browser.locator('.clip-card').first();
  const loopToggle = card.getByRole('button', { name: 'Loop preview' });

  // Default is play-once: the toggle is off before anything is played.
  await expect(loopToggle).toHaveAttribute('aria-pressed', 'false');

  await card.getByRole('button', { name: 'Play clip' }).click();
  const video = card.locator('video');
  await expect(video).toHaveCount(1);

  // Drive playback to the out-point rather than waiting out the clip.
  const endSec = await video.evaluate((element: HTMLVideoElement) =>
    Number(element.dataset.endSec ?? NaN),
  );
  await video.evaluate((element: HTMLVideoElement, end: number) => {
    element.currentTime = Number.isFinite(end) ? Math.max(0, end - 0.05) : element.duration - 0.05;
  }, endSec);

  // Play-once: reaching the out-point pauses instead of restarting.
  await expect
    .poll(async () => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);

  // The toggle survives a pause/play cycle and reports its state.
  await loopToggle.click();
  await expect(loopToggle).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Play clip' }).click();
  await expect(loopToggle).toHaveAttribute('aria-pressed', 'true');

  // Looping: reaching the out-point restarts rather than pausing.
  await video.evaluate((element: HTMLVideoElement, end: number) => {
    element.currentTime = Number.isFinite(end) ? Math.max(0, end - 0.05) : element.duration - 0.05;
  }, endSec);
  await expect
    .poll(async () => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
});

test('renders the Review workstation with Your Clips visible from the first paint', async ({ page }) => {
  await setupReview(page);

  await expect(page.getByTestId('ask-ai-rail')).toBeVisible();
  await expect(page.getByTestId('review-chat-panel')).toBeVisible();
  await expect(page.getByTestId('suggested-versions-zone')).toBeVisible();
  await expect(page.getByTestId('version-gallery')).toBeVisible();
  await expect(page.getByTestId('candidate-browser-zone')).toBeVisible();
  await expect(page.getByTestId('source-clips-panel')).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('heading', { name: 'Your clips' })).toBeVisible();
  await expect(page.getByTestId('source-clips-panel').locator('details, summary')).toHaveCount(0);
  await expect(page.getByTestId('harness-fallback-notice')).toHaveCount(0);
});

test('shows a Harness Fallback with its reason and affected Source Videos', async ({ page }) => {
  await setupReview(page, { analysisMetadata: {
    warning: 'Harness Fallback — review-browser-fixture.mp4 (fixture): Pi Agent timed out',
    per_video: [{
      file_id: 'fixture',
      file_name: 'review-browser-fixture.mp4',
      warning: 'Pi Agent timed out',
    }],
  } });

  const notice = page.getByTestId('harness-fallback-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Harness Fallback');
  await expect(notice).toContainText('Pi Agent timed out');
  await expect(notice).toContainText('review-browser-fixture.mp4');
});

test('shows no Harness Fallback notice after a successful agentic run', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await setupReview(page, {
    harnessId: 'pi_agent',
    analysisMetadata: {
      used_ai: true,
      per_video: [{
        file_id: 'fixture',
        file_name: 'review-browser-fixture.mp4',
        used_ai: true,
      }],
    },
  });

  await expect(page.locator('[data-testid="harness-fallback-notice"]')).toHaveCount(0);
});

test('keeps the review workstation aligned while resizing Ask AI rail', async ({ page }) => {
  await setupReview(page);
  const separator = page.getByRole('separator', { name: 'Resize the Ask the AI panel' });
  const geometry = () => page.evaluate(() => {
    const rail = document.querySelector('[data-testid="ask-ai-rail"]')?.getBoundingClientRect();
    const main = document.querySelector('.review-main')?.getBoundingClientRect();
    const body = document.querySelector('.review-shell-body')?.getBoundingClientRect();
    if (!rail || !main || !body) throw new Error('Missing Review geometry');
    return { railWidth: rail.width, railRight: rail.right, mainLeft: main.left, bodyRight: body.right };
  });
  const initial = await geometry();
  await separator.press('ArrowRight');
  const middle = await geometry();
  expect(middle.railWidth).toBeGreaterThan(initial.railWidth);
  expect(middle.mainLeft).toBeCloseTo(middle.railRight + 1, 0);
  for (let index = 0; index < 30; index += 1) await separator.press('ArrowRight');
  const maximum = await geometry();
  expect(maximum.railWidth).toBeGreaterThanOrEqual(540);
  expect(maximum.mainLeft).toBeCloseTo(maximum.railRight + 1, 0);
  expect(maximum.mainLeft).toBeLessThan(maximum.bodyRight);
  for (let index = 0; index < 40; index += 1) await separator.press('ArrowLeft');
  const minimum = await geometry();
  expect(minimum.railWidth).toBeLessThanOrEqual(250);
  expect(minimum.mainLeft).toBeCloseTo(minimum.railRight + 1, 0);
});

test('keeps Include and Remove tied to authoritative Timeline membership', async ({ page }) => {
  await setupReview(page);
  await page.getByRole('button', { name: 'List' }).click();
  const first = page.locator('[data-review-list] [data-review-clip]').first();
  const action = first.getByRole('button', { name: /^(Include|Remove)$/ }).first();
  await expect(action).toBeVisible();
  const actionName = await action.getAttribute('aria-label');
  await action.click();
  await expect(
    first.getByRole('button', { name: actionName === 'Include' ? 'Remove' : 'Include', exact: true }),
  ).toBeVisible();
});

test('projects seeded scores, decisions, Timeline membership, and Version labels consistently', async ({ page }) => {
  const { timelineFile, timelineClipId } = await setupSeededReview(page);
  const browser = page.locator('[data-review-browser]');

  await page.getByLabel('Minimum Smoothness').fill('0');
  await page.getByTestId('source-clips-panel').getByRole('button', { name: 'Grid' }).click();
  await expect(browser).toHaveAttribute('data-view-mode', 'grid');
  const combinedFills = await browser.locator('.clip-card .score-chip[data-score-label="combined"]')
    .evaluateAll((chips) => chips.map((chip) => chip.getAttribute('data-score-fill')));
  expect(combinedFills).toEqual(['95%', '80%', '70%', '30%']);
  await expect(browser.locator('.clip-card .score-chip[data-score-label="combined"]').first())
    .toHaveAttribute('aria-label', 'combined: 9.5 / 10');
  await page.getByTestId('source-clips-panel').getByRole('button', { name: 'List' }).click();
  await page.getByLabel('Minimum Overall').fill('7');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(3);
  expect(await browser.locator('[data-review-clip]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-review-clip')))).toEqual([
    'seed-high', timelineClipId, 'seed-mid',
  ]);
  await expect(browser.locator('[data-review-clip="seed-high"]')).toHaveAttribute('data-rank', '1');
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toHaveAttribute('data-rank', '2');
  await expect(browser.locator('[data-review-clip="seed-mid"]')).toHaveAttribute('data-rank', '3');
  await expect(page.getByTestId('review-header-count')).toContainText('3 / 4');
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toContainText('Proposed in A');
  await expect(browser.locator('[data-review-clip="seed-high"]')).toContainText('Proposed in A/B');

  await page.getByLabel('Minimum Overall').fill('8.5');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(1);
  await expect(page.getByTestId('review-header-count')).toContainText('1 / 4');
  await expect(browser.locator('[data-review-clip="seed-high"]')).toHaveAttribute('data-rank', '1');

  await page.getByLabel('Minimum Overall').fill('0');
  await page.getByLabel('Minimum Smoothness').fill('6');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(2);
  await expect(browser.locator('[data-review-clip="seed-high"]')).toHaveCount(0);
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toBeVisible();

  await page.getByRole('combobox', { name: 'Decision filter' }).selectOption('included');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(1);
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toContainText(timelineFile);
  const remove = browser.locator(`[data-review-clip="${timelineClipId}"]`).getByRole('button', { name: 'Remove', exact: true });
  await expect(remove).toBeVisible();
  await remove.click();

  await page.getByRole('combobox', { name: 'Decision filter' }).selectOption('excluded');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(1);
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toContainText(timelineFile);
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).not.toContainText(/Timeline #/);
});
