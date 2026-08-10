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
  for (const [index, file] of files.entries()) {
    await fileInput.setInputFiles(file);
    await expect(
      page.getByText(
        new RegExp(`${index + 1} source videos? ready`),
      ),
    ).toBeVisible();
  }

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
    const before = await includeButton.count();
    await includeButton.first().click();
    await expect.poll(() => includeButton.count()).toBeLessThan(before);
  }

  await page.goto('/#/playwriter');
  const projectId = (await page.getByTestId('qa-project-id').textContent())?.trim();
  expect(projectId).toBeTruthy();

  await page.goto('/#/timeline');
  const video = page.getByTestId('timeline-preview-video');
  await expect(video).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
  await expect
    .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  return { video, projectId: projectId! };
}

async function replaceWithRepeatedItems(page: Page, projectId: string) {
  const snapshot = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  );
  const document = (await snapshot.json()).document;
  const source = document.items[0];
  const response = await page.request.post(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
    {
      data: {
        operation: 'replace_timeline',
        args: {
          items: [
            {
              source_clip_id: source.source_clip_id,
              start_sec: source.start_sec,
              end_sec: source.start_sec + 2,
              speed: 1,
              transform: { scale: 1, x: 0, y: 0 },
            },
            {
              source_clip_id: source.source_clip_id,
              start_sec: source.start_sec + 2,
              end_sec: source.start_sec + 6,
              speed: 2,
              transform: { scale: 1.25, x: 0.1, y: 0 },
            },
          ],
        },
      },
    },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).document.items as Array<{ item_id: string }>;
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

test('trimming keeps Timeline Items contiguous and shrinks the selected item', async ({ page }) => {
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
  expect(Math.abs(afterLeft!.x - before!.x)).toBeLessThan(1);
  expect(afterLeft!.width).toBeLessThan(before!.width);
});

test('renders repeated source clips as distinct authoritative Timeline Items', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.goto('/#/review');
  await page.goto('/#/timeline');
  await expect(page.locator('.tl-clip')).toHaveCount(2);
  await expect(page.locator(`[data-timeline-item-id="${items[0].item_id}"]`)).toBeVisible();
  await expect(page.locator(`[data-timeline-item-id="${items[1].item_id}"]`)).toBeVisible();
  await expect(page.getByTestId('timeline-summary')).toContainText('2 items · 4.0s');
});

test('visual edits address the selected Timeline Item', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.goto('/#/review');
  await page.goto('/#/timeline');
  await page.locator(`[data-timeline-item-id="${items[1].item_id}"]`).click();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => {
    const response = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
    );
    const document = (await response.json()).document;
    return document.items[0].item_id;
  }).toBe(items[1].item_id);
});

test('forward play is video-driven: monotonic advance, stable src, zero seeking events', async ({
  page,
}) => {
  const { video } = await setupTimeline(page, [fixtureA(), fixtureB()]);

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

/** Find the index of the first Timeline Item whose visible file name differs
 * from the first item's — i.e. the actual Source Video boundary — rather
 * than assuming the boundary sits between item 0 and item 1. */
async function findFileBoundary(page: Page): Promise<{ boundaryIndex: number; firstName: string; secondName: string }> {
  const names = await page.locator('.tl-clip-name').allTextContents();
  const firstName = names[0];
  const boundaryIndex = names.findIndex((name) => name !== firstName);
  expect(boundaryIndex, 'timeline must contain a Source Video transition').toBeGreaterThan(0);
  return { boundaryIndex, firstName, secondName: names[boundaryIndex] };
}

test('playback crosses the clip boundary and continues into the next file', async ({ page }) => {
  const { video } = await setupTimeline(page, [fixtureA(), fixtureB()]);

  const { boundaryIndex, firstName, secondName } = await findFileBoundary(page);

  // Scrub via the ruler to just before the end of the Timeline Item
  // immediately preceding the first file boundary.
  const lastClipOfFirstFile = page.locator('.tl-clip').nth(boundaryIndex - 1);
  const clipBox = await lastClipOfFirstFile.boundingBox();
  const rulerBox = await page.locator('.timeline-ruler').boundingBox();
  expect(clipBox).toBeTruthy();
  expect(rulerBox).toBeTruthy();
  await page.mouse.click(
    clipBox!.x + clipBox!.width - 15,
    rulerBox!.y + rulerBox!.height / 2,
  );

  await page.getByTestId('transport-play').click();

  // Within a few seconds the engine must advance past the boundary into the
  // second Source Video's Timeline Item and keep playing after the src swap.
  await expect
    .poll(
      async () => {
        const name = await page.getByTestId('timeline-preview-current-clip').textContent();
        const paused = await video.evaluate((el) => (el as HTMLVideoElement).paused);
        return name === secondName && !paused;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(secondName).not.toBe(firstName);

  await page.getByTestId('transport-stop').click();
});

test('play restarts from the first item after reaching the sequence end', async ({ page }) => {
  const { video } = await setupTimeline(page, [fixtureA(), fixtureB()]);
  const firstClipName = await page.getByTestId('timeline-preview-current-clip').textContent();
  const clips = page.locator('.tl-clip');
  const clipCount = await clips.count();
  expect(clipCount).toBeGreaterThanOrEqual(2);
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

  const zoomBefore = Number(await page.getByRole('slider', { name: 'Zoom' }).inputValue());
  await page.mouse.move(rulerBox!.x + rulerBox!.width / 2, rulerBox!.y + 10);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => Number(await page.getByRole('slider', { name: 'Zoom' }).inputValue()))
    .toBeGreaterThan(zoomBefore);
});

test('Resolve export exposes an Open in DaVinci handoff', async ({ page }) => {
  await setupTimeline(page, [fixtureA()]);
  await page.goto('/#/export');

  await page.getByRole('button', { name: 'Export for DaVinci Resolve' }).click();

  await expect(page.getByText('DaVinci Resolve XML exported')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in DaVinci Resolve' })).toBeVisible();
});
