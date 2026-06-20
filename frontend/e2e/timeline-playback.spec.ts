/**
 * E2E coverage for Plan 004: Timeline sequence playback.
 *
 * Uses two distinct fixture files so the timeline holds two clips with
 * different file names — the manual harness emits exactly one clip per
 * static-color fixture, which makes the clip-boundary cross-file and the
 * current-clip name change deterministic.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function ensureFixtureVideo(name: string, color: string): string {
  const dir = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(dir, name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=640x360:rate=30`,
      '-t',
      '8',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }
  return file;
}

/** Import the given fixture files, run the manual harness, accept all clips,
 * and land on the Timeline page. */
async function setupTimeline(page: Page, files: string[]) {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();

  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(files[0]);
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await fileInput.setInputFiles(files);
  await expect(page.getByText(new RegExp(`${files.length} source videos? ready`))).toBeVisible();

  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({
    timeout: 180_000,
  });

  await page.goto('/#/review');
  await page.getByTestId('source-clips-panel').locator('summary').click();
  await expect(page.getByLabel(/Preview /).first()).toBeVisible();
  // "Include" exact-matches only un-accepted cards ("Included ✓" otherwise).
  const includeButton = page.getByRole('button', { name: 'Include', exact: true });
  for (let i = 0; i < 6 && (await includeButton.count()) > 0; i++) {
    await includeButton.first().click();
  }

  await page.goto('/#/timeline');
  const video = page.getByTestId('timeline-preview-video');
  await expect(video).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
  await expect
    .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  return video;
}

const fixtureA = () => ensureFixtureVideo('seq-fixture-a.mp4', 'gray');
const fixtureB = () => ensureFixtureVideo('seq-fixture-b.mp4', 'navy');

test('timeline preview has no native controls; review cards use poster videos', async ({ page }) => {
  await setupTimeline(page, [fixtureA()]);

  const timelineVideo = page.getByTestId('timeline-preview-video');
  await expect(timelineVideo).not.toHaveAttribute('controls');

  await page.goto('/#/review');
  await page.getByTestId('source-clips-panel').locator('summary').click();
  const reviewVideo = page.getByLabel(/Preview /).first();
  await expect(reviewVideo).toBeVisible();
  await expect(reviewVideo).not.toHaveAttribute('controls');
});

test('left and right trims move their own visual edges', async ({ page }) => {
  await setupTimeline(page, [fixtureA(), fixtureB()]);
  const ruler = await page.locator('.timeline-ruler').boundingBox();
  expect(ruler).toBeTruthy();
  await page.mouse.click(ruler!.x + 100, ruler!.y + ruler!.height / 2);

  const clip = page.locator('.tl-clip').first();
  const before = await clip.boundingBox();
  expect(before).toBeTruthy();

  const left = clip.locator('.tl-trim-handle.left');
  const leftBox = await left.boundingBox();
  expect(leftBox).toBeTruthy();
  await page.mouse.move(leftBox!.x + leftBox!.width / 2, leftBox!.y + leftBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftBox!.x + 40, leftBox!.y + leftBox!.height / 2, { steps: 5 });
  await page.mouse.up();

  const afterLeft = await clip.boundingBox();
  expect(afterLeft).toBeTruthy();
  expect(afterLeft!.x).toBeGreaterThan(before!.x + 5);
  expect(afterLeft!.width).toBeLessThan(before!.width);
});

test('forward play is video-driven: monotonic advance, stable src, zero seeking events', async ({
  page,
}) => {
  const video = await setupTimeline(page, [fixtureA(), fixtureB()]);

  // Let the initial seek (to clip 1's trim start) settle before counting.
  await page.waitForTimeout(500);
  await video.evaluate((el) => {
    const v = el as HTMLVideoElement & { __seekCount?: number };
    v.__seekCount = 0;
    v.addEventListener('seeking', () => {
      v.__seekCount = (v.__seekCount ?? 0) + 1;
    });
  });
  const srcBefore = await video.evaluate((el) => (el as HTMLVideoElement).currentSrc);

  await page.getByTestId('transport-play').click();

  // Sample for ~3 s inside clip 1 (each fixture clip is ~8 s long).
  let prev = await video.evaluate((el) => (el as HTMLVideoElement).currentTime);
  const first = prev;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const t = await video.evaluate((el) => (el as HTMLVideoElement).currentTime);
    expect(t, 'currentTime must never move backwards during steady play').toBeGreaterThanOrEqual(
      prev - 0.05,
    );
    prev = t;
  }
  expect(prev - first, 'currentTime should advance ≥2 s of wall-clock play').toBeGreaterThan(2);

  await page.getByTestId('transport-stop').click();

  const srcAfter = await video.evaluate((el) => (el as HTMLVideoElement).currentSrc);
  expect(srcAfter, 'no src swap during same-clip playback').toBe(srcBefore);

  const seekCount = await video.evaluate(
    (el) => (el as HTMLVideoElement & { __seekCount?: number }).__seekCount ?? 0,
  );
  expect(seekCount, 'video must not be hard-seeked during steady forward play').toBe(0);
});

test('playback crosses the clip boundary and continues into the next file', async ({ page }) => {
  const video = await setupTimeline(page, [fixtureA(), fixtureB()]);

  const clip1Name = await page.getByTestId('timeline-preview-current-clip').textContent();
  expect(clip1Name).toBeTruthy();

  // Scrub via the ruler to just before the end of clip 1.
  const clip1Box = await page.locator('.tl-clip').first().boundingBox();
  const rulerBox = await page.locator('.timeline-ruler').boundingBox();
  expect(clip1Box).toBeTruthy();
  expect(rulerBox).toBeTruthy();
  await page.mouse.click(
    clip1Box!.x + clip1Box!.width - 15,
    rulerBox!.y + rulerBox!.height / 2,
  );

  await page.getByTestId('transport-play').click();

  // Within a few seconds the engine must advance to clip 2 (different file
  // name) and keep playing after the src swap.
  await expect
    .poll(
      async () => {
        const name = await page.getByTestId('timeline-preview-current-clip').textContent();
        const paused = await video.evaluate((el) => (el as HTMLVideoElement).paused);
        return name !== clip1Name && !paused;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.getByTestId('transport-stop').click();
});

test('play restarts from the first item after reaching the sequence end', async ({ page }) => {
  const video = await setupTimeline(page, [fixtureA(), fixtureB()]);
  const firstClipName = await page.getByTestId('timeline-preview-current-clip').textContent();
  const clips = page.locator('.tl-clip');
  const clipCount = await clips.count();
  expect(clipCount).toBe(2);
  const lastClipBox = await clips.nth(clipCount - 1).boundingBox();
  const rulerBox = await page.locator('.timeline-ruler').boundingBox();
  expect(lastClipBox).toBeTruthy();
  expect(rulerBox).toBeTruthy();
  await page.mouse.click(
    lastClipBox!.x + lastClipBox!.width - 5,
    rulerBox!.y + rulerBox!.height / 2,
  );
  await page.getByTestId('transport-play').click();
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).paused),
    { timeout: 5_000 },
  ).toBe(true);

  await page.getByTestId('transport-play').click();

  await expect(page.getByTestId('timeline-preview-current-clip')).toHaveText(firstClipName ?? '');
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).paused),
    { timeout: 5_000 },
  ).toBe(false);
});

test('playhead drags continuously and wheel zoom changes timeline scale', async ({ page }) => {
  await setupTimeline(page, [fixtureA(), fixtureB()]);

  const rulerBox = await page.locator('.timeline-ruler').boundingBox();
  expect(rulerBox).toBeTruthy();

  const playhead = page.locator('.timeline-playhead');
  const before = await playhead.evaluate((element) =>
    parseFloat((element as HTMLElement).style.left),
  );
  await page.mouse.move(rulerBox!.x + 20, rulerBox!.y + 10);
  await page.mouse.down();
  await page.mouse.move(rulerBox!.x + 180, rulerBox!.y + 10, { steps: 5 });
  await page.mouse.up();
  const after = await playhead.evaluate((element) =>
    parseFloat((element as HTMLElement).style.left),
  );
  expect(after).toBeGreaterThan(before + 100);

  const zoomBefore = Number(await page.getByLabel('Zoom').inputValue());
  await page.mouse.move(rulerBox!.x + rulerBox!.width / 2, rulerBox!.y + 10);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => Number(await page.getByLabel('Zoom').inputValue()))
    .toBeGreaterThan(zoomBefore);
});

test('Resolve export exposes an Open in DaVinci handoff', async ({ page }) => {
  await setupTimeline(page, [fixtureA()]);
  await page.goto('/#/export');

  await page.getByRole('button', { name: 'Export for DaVinci Resolve' }).click();

  await expect(page.getByText('DaVinci Resolve XML exported')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in DaVinci Resolve' })).toBeVisible();
});
