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
async function setupTimeline(
  page: Page,
  files: string[],
  options: { omitAnalyzedClips?: boolean; clipVisibility?: 'all' | 'first' | 'none' } = {},
) {
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

  if (options.omitAnalyzedClips || options.clipVisibility) {
    await page.route('**/projects/*/analyze', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          clips: options.omitAnalyzedClips || options.clipVisibility === 'none'
            ? []
            : body.clips.slice(0, 1),
        },
      });
    });
  }
  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({
    timeout: 180_000,
  });

  let projectId: string | undefined;
  if (options.omitAnalyzedClips || options.clipVisibility === 'none') {
    await page.goto('/#/playwriter');
    projectId = (await page.getByTestId('qa-project-id').textContent())?.trim();
    expect(projectId).toBeTruthy();
    const clipsResponse = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/clips`,
    );
    const sourceClip = (await clipsResponse.json()).clips[0];
    const includeResponse = await page.request.post(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
      { data: { operation: 'include', args: { clip_id: sourceClip.clip_id } } },
    );
    expect(includeResponse.ok()).toBe(true);
  } else if (options.clipVisibility) {
    await page.goto('/#/playwriter');
    projectId = (await page.getByTestId('qa-project-id').textContent())?.trim();
    expect(projectId).toBeTruthy();
    const clipsResponse = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/clips`,
    );
    const sourceClips = (await clipsResponse.json()).clips as Array<{ clip_id: string }>;
    for (const clip of sourceClips) {
      const includeResponse = await page.request.post(
        `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
        { data: { operation: 'include', args: { clip_id: clip.clip_id } } },
      );
      expect(includeResponse.ok()).toBe(true);
    }
  } else {
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
    projectId = (await page.getByTestId('qa-project-id').textContent())?.trim();
    expect(projectId).toBeTruthy();
  }

  await page.goto('/#/timeline');
  const video = page.getByTestId('timeline-preview-video');
  if (options.omitAnalyzedClips || options.clipVisibility === 'none') {
    await expect(page.getByTestId('timeline-preview-video-missing')).toBeVisible();
  } else {
    await expect(video).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
    await expect
      .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
  }
  // The visible Timeline is mounted and hydrated before the SSE effect is
  // subscribed. The live-mutation assertions below prove reconciliation.
  await page.waitForTimeout(100);
  return { video, projectId: projectId! };
}

interface TimelineItemSpec {
  offset: number;
  duration: number;
  speed: number;
  transform?: { scale: number; x: number; y: number };
}

async function replaceWithItems(
  page: Page,
  projectId: string,
  specs: TimelineItemSpec[],
) {
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
          items: specs.map((spec) => ({
            source_clip_id: source.source_clip_id,
            start_sec: source.start_sec + spec.offset,
            end_sec: source.start_sec + spec.offset + spec.duration,
            speed: spec.speed,
            transform: spec.transform ?? { scale: 1, x: 0, y: 0 },
          })),
        },
      },
    },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).document.items as Array<{
    item_id: string;
    source_clip_id: string;
    start_sec: number;
    end_sec: number;
  }>;
}

async function replaceWithRepeatedItems(page: Page, projectId: string) {
  return replaceWithItems(page, projectId, [
    { offset: 0, duration: 2, speed: 1 },
    { offset: 2, duration: 4, speed: 2, transform: { scale: 1.25, x: 0.1, y: 0 } },
  ]);
}

async function replaceWithMixedMissingItems(page: Page, projectId: string) {
  const snapshot = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  );
  const items = (await snapshot.json()).document.items as Array<{
    source_clip_id: string;
    start_sec: number;
  }>;
  expect(items.length).toBeGreaterThanOrEqual(2);
  const clips = (await page.request
    .get(`http://127.0.0.1:8000/projects/${projectId}/clips`)
    .then((response) => response.json())).clips as Array<{ clip_id: string }>;
  const validSource = items.find((item) => item.source_clip_id === clips[0]?.clip_id);
  const missingSource = items.find((item) => item.source_clip_id !== clips[0]?.clip_id);
  expect(validSource).toBeTruthy();
  expect(missingSource).toBeTruthy();
  const response = await page.request.post(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
    {
      data: {
        operation: 'replace_timeline',
        args: {
          items: [
            {
              source_clip_id: missingSource!.source_clip_id,
              start_sec: missingSource!.start_sec,
              end_sec: missingSource!.start_sec + 2,
              speed: 1,
              transform: { scale: 1, x: 0, y: 0 },
            },
            {
              source_clip_id: validSource!.source_clip_id,
              start_sec: validSource!.start_sec,
              end_sec: validSource!.start_sec + 2,
              speed: 1,
              transform: { scale: 1, x: 0, y: 0 },
            },
          ],
        },
      },
    },
  );
  expect(response.ok()).toBe(true);
  const resultItems = (await response.json()).document.items as Array<{
    item_id: string;
    source_clip_id: string;
  }>;
  const missingItem = resultItems.find((item) => item.source_clip_id === missingSource!.source_clip_id);
  expect(missingItem).toBeTruthy();
  const reorderResponse = await page.request.post(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
    { data: { operation: 'reorder', args: { item_id: missingItem!.item_id, to_index: 0 } } },
  );
  expect(reorderResponse.ok()).toBe(true);
  return (await reorderResponse.json()).document.items as Array<{
    item_id: string;
    source_clip_id: string;
  }>;
}

async function postTimelineOperation(
  page: Page,
  projectId: string,
  operation: string,
  args: Record<string, unknown>,
) {
  const response = await page.request.post(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
    { data: { operation, args } },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).document;
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

  // The trim round-trips through the backend, so the box is read on a retrying
  // poll rather than once: a single read can land before the re-render commits.
  await expect
    .poll(async () => {
      const box = await clip.boundingBox();
      if (!box) return null;
      return {
        movedLeftEdge: Math.abs(box.x - before!.x) < 1,
        narrower: box.width < before!.width,
      };
    })
    .toEqual({ movedLeftEdge: true, narrower: true });
});

test('renders repeated Candidate Clips as distinct authoritative Timeline Items', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await expect(page.locator('.tl-clip')).toHaveCount(2);
  await expect(page.locator(`[data-timeline-item-id="${items[0].item_id}"]`)).toBeVisible();
  await expect(page.locator(`[data-timeline-item-id="${items[1].item_id}"]`)).toBeVisible();
  await expect(page.getByTestId('timeline-summary')).toContainText('2 items · 4.0s');
});

test('studio Timeline selects an item and exposes its authoritative inspector', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  const second = page.locator(`[data-timeline-item-id="${items[1].item_id}"]`);

  await second.click();
  await expect(page.getByTestId('timeline-inspector')).toContainText('seq-fixture-a.mp4');
  await expect(page.getByTestId('timeline-inspector')).toContainText(items[1].item_id);
  await expect(page.locator('.timeline-item-row.selected')).toHaveAttribute(
    'data-timeline-editor-item-id',
    items[1].item_id,
  );
  await expect(page.locator('.timeline-ruler')).toBeVisible();
  await expect(page.locator('.timeline-playhead')).toBeVisible();
  await expect(page.getByTestId('transport-play')).toBeVisible();
  await expect(page.locator('.tl-clip-thumb')).toHaveCount(2);
  await expect(page.locator('.tl-clip video')).toHaveCount(0);
  const themeColors = await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    const dark = getComputedStyle(document.querySelector('.timeline-editor')!).backgroundColor;
    root.setAttribute('data-theme', 'light');
    const light = getComputedStyle(document.querySelector('.timeline-editor')!).backgroundColor;
    return { dark, light };
  });
  expect(themeColors.dark).not.toBe(themeColors.light);
});

test('Timeline playback skips a missing placement and advances to the next valid item', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA(), fixtureB()], {
    clipVisibility: 'first',
  });
  const items = await replaceWithMixedMissingItems(page, projectId);

  await expect(page.locator('.tl-clip')).toHaveCount(2);
  await expect(page.locator('.tl-clip').first()).toHaveAttribute('data-timeline-missing-source', 'true');
  await expect(page.locator('.tl-clip').nth(1)).toHaveAttribute('data-timeline-missing-source', 'false');
  await page.getByTestId('transport-play').click();
  await expect(page.getByTestId('timeline-preview-current-clip')).toHaveAttribute(
    'data-timeline-active-item-id',
    items[1].item_id,
  );
  await expect(page.getByTestId('timeline-preview-video')).toBeVisible();
});

test('Timeline with only missing placements stops safely without a media clock', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()], { clipVisibility: 'none' });
  await replaceWithRepeatedItems(page, projectId);

  await expect(page.getByTestId('timeline-preview-video-missing')).toBeVisible();
  await page.getByTestId('transport-play').click();
  await expect(page.locator('.timeline')).toHaveAttribute('data-timeline-playing', 'false');
  await expect(page.getByTestId('timeline-preview-video-missing')).toBeVisible();
});

test('Timeline editor mutations target item_id and reconcile undo redo and reorder', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  const operations: Array<{ operation: string; args: Record<string, unknown> }> = [];
  page.on('request', (request) => {
    if (
      request.url().endsWith(`/projects/${projectId}/timeline/op`) &&
      request.method() === 'POST'
    ) {
      const body = request.postDataJSON() as { operation: string; args: Record<string, unknown> };
      operations.push(body);
    }
  });

  const secondRow = page.locator('.timeline-item-row').nth(1);
  const speed = secondRow.getByTestId('item-speed');
  await speed.fill('2');
  await speed.blur();
  await expect.poll(() => operations.at(-1)).toMatchObject({
    operation: 'set_speed',
    args: { item_id: items[1].item_id, speed: 2 },
  });

  const zoom = secondRow.getByTestId('item-zoom');
  await zoom.fill('1.4');
  await zoom.blur();
  await expect.poll(() => operations.at(-1)).toMatchObject({
    operation: 'set_transform',
    args: { item_id: items[1].item_id },
  });
  await expect.poll(async () => {
    const document = await page.request
      .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
      .then((response) => response.json());
    return document.document.items.find((item: { item_id: string }) => item.item_id === items[1].item_id);
  }).toMatchObject({ speed: 2, transform: { scale: 1.4 } });

  await page.locator(`[data-timeline-item-id="${items[1].item_id}"]`).click();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => operations.at(-1)).toMatchObject({
    operation: 'reorder',
    args: { item_id: items[1].item_id, to_index: 0 },
  });
  await expect.poll(async () => {
    const document = await page.request
      .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
      .then((response) => response.json());
    return document.document.items[0].item_id;
  }).toBe(items[1].item_id);

  const splitRow = page.locator(`[data-timeline-editor-item-id="${items[1].item_id}"]`);
  await splitRow.getByTestId('item-split').click();
  await expect.poll(() => operations.at(-1)).toMatchObject({
    operation: 'split_item',
    args: { item_id: items[1].item_id },
  });
  await expect.poll(async () => {
    const document = await page.request
      .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
      .then((response) => response.json());
    return document.document.items.length;
  }).toBe(3);

  await page.getByTestId('timeline-undo').click();
  await expect.poll(async () => {
    const document = await page.request
      .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
      .then((response) => response.json());
    return document.document.items.length;
  }).toBe(2);
  await page.getByTestId('timeline-redo').click();
  await expect.poll(async () => {
    const document = await page.request
      .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
      .then((response) => response.json());
    return document.document.items.length;
  }).toBe(3);
});

test('keeps the active Timeline Item through live reorder and removal', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.locator(`[data-timeline-item-id="${items[1].item_id}"]`).click();
  await expect(page.getByTestId('timeline-preview-current-clip')).toHaveAttribute(
    'data-timeline-active-item-id',
    items[1].item_id,
  );

  await postTimelineOperation(page, projectId, 'reorder', {
    item_id: items[1].item_id,
    to_index: 0,
  });
  await expect(page.getByTestId('timeline-preview-current-clip')).toHaveAttribute(
    'data-timeline-active-item-id',
    items[1].item_id,
  );

  await postTimelineOperation(page, projectId, 'remove_item', { item_id: items[1].item_id });
  await expect(page.locator('.tl-clip')).toHaveCount(1);
  await expect(page.getByTestId('timeline-preview-current-clip')).toHaveAttribute(
    'data-timeline-active-item-id',
    items[0].item_id,
  );
});

test('applies repeated-item speed and transform to playback and preview', async ({ page }) => {
  const { projectId, video } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  const second = page.locator(`[data-timeline-item-id="${items[1].item_id}"]`);
  await second.click();

  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(2);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).style.transform)).toBe(
    'scale(1.25)',
  );
  await expect(second.locator('.tl-clip-dur')).toHaveText('2.0s');
});

test('persists one speed-correct trim operation for the selected repeated item', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  const boundsRequests: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (!request.url().endsWith(`/projects/${projectId}/timeline/op`) || request.method() !== 'POST') return;
    const body = request.postDataJSON() as { operation?: string; args?: Record<string, unknown> };
    if (body.operation === 'set_bounds') boundsRequests.push(body.args ?? {});
  });

  const second = page.locator(`[data-timeline-item-id="${items[1].item_id}"]`);
  await second.click();
  const right = second.locator('.tl-trim-handle.right');
  const rightBox = await right.boundingBox();
  expect(rightBox).toBeTruthy();
  await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rightBox!.x + rightBox!.width / 2 + 20,
    rightBox!.y + rightBox!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();

  await expect.poll(async () => {
    const response = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
    );
    const document = (await response.json()).document;
    return document.items.find((item: { item_id: string }) => item.item_id === items[1].item_id)?.end_sec;
  }).toBe(7);
  expect(boundsRequests).toHaveLength(1);
  expect(boundsRequests[0]).toMatchObject({
    item_id: items[1].item_id,
    start_sec: 2,
    end_sec: 7,
  });
});

test('removes the selected repeated Timeline Item', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.locator(`[data-timeline-item-id="${items[1].item_id}"]`).click();
  await page.keyboard.press('Delete');

  await expect.poll(async () => {
    const response = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
    );
    const document = (await response.json()).document;
    return document.items.map((item: { item_id: string }) => item.item_id);
  }).toEqual([items[0].item_id]);
});

test('Space on a focused TimelineEditor button activates the button, not playback', async ({ page }) => {
  const { projectId, video } = await setupTimeline(page, [fixtureA()]);
  const snapshot = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  );
  const itemId = (await snapshot.json()).document.items[0].item_id as string;
  await postTimelineOperation(page, projectId, 'set_speed', { item_id: itemId, speed: 2 });
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(2);

  await page.getByTestId('timeline-undo').focus();
  await page.keyboard.press('Space');

  await expect.poll(async () => {
    const response = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
    );
    const document = (await response.json()).document;
    return document.items[0]?.speed;
  }).toBe(1);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(1);
});

test('keeps short high-speed visual timing exact while retaining a visible hit target', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithItems(page, projectId, [
    { offset: 0, duration: 0.05, speed: 2 },
    { offset: 0.05, duration: 2, speed: 1 },
  ]);

  await expect(page.getByTestId('timeline-summary')).toContainText('2 items · 2.0s');
  const short = page.locator(`[data-timeline-item-id="${items[0].item_id}"]`);
  const following = page.locator(`[data-timeline-item-id="${items[1].item_id}"]`);
  await expect.poll(() => short.evaluate((element) => parseFloat((element as HTMLElement).style.width))).toBe(1);
  await expect.poll(() => following.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBe(1);
  await expect(short.locator('.tl-trim-handle.left')).toBeVisible();
});

test('retains an authoritative Timeline Item when Candidate Clip metadata is stale', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()], { omitAnalyzedClips: true });
  const snapshot = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  );
  const sourceItem = (await snapshot.json()).document.items[0] as {
    item_id: string;
    source_clip_id: string;
  };
  await expect(page.getByTestId('timeline-summary')).toContainText('1 item ·');
  await expect(page.locator('.tl-clip')).toHaveCount(1);
  await expect(page.locator(`[data-timeline-item-id="${sourceItem.item_id}"] .tl-clip-name`)).toHaveText(
    sourceItem.source_clip_id,
  );
  await expect(page.locator(`.tl-clip[data-timeline-item-id="${sourceItem.item_id}"]`)).toHaveAttribute(
    'data-timeline-missing-source',
    'true',
  );
  await expect(page.locator('.tl-clip-thumb')).toHaveText('×');
  await expect(page.getByTestId('timeline-preview-video-missing')).toBeVisible();
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

test('export reads the authoritative Timeline without a legacy write', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  await replaceWithRepeatedItems(page, projectId);
  const before = await page.request
    .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
    .then((response) => response.json());
  const legacyWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().endsWith(`/projects/${projectId}/timeline`) &&
      request.method() !== 'GET'
    ) {
      legacyWrites.push(request.method());
    }
  });

  await page.goto('/#/export');
  await page.getByRole('button', { name: 'Export EDL' }).click();

  const after = await page.request
    .get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`)
    .then((response) => response.json());
  expect(legacyWrites).toEqual([]);
  expect(after.document).toEqual(before.document);
  await expect(page.getByTestId('export-result-edl')).toContainText('2 items');
  await expect(page.getByTestId('export-result-edl')).toContainText('4.0s effective');
  await expect(page.getByTestId('export-warning-edl')).toContainText(/flatten/i);
  await page.getByText('Review export payload').click();
  await expect(page.getByTestId('export-payload')).toContainText('item_id');
  await expect(page.getByTestId('export-payload')).toContainText('speed');
  await expect(page.getByTestId('export-payload')).toContainText('transform');

  await replaceWithItems(page, projectId, [{ offset: 0, duration: 6, speed: 1 }]);
  await expect(page.getByText('1 item in the Timeline · 6.0s total.')).toBeVisible();
  await expect(page.getByTestId('export-result-edl')).toContainText('4.0s effective');
});
