import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function ensureFixtureVideo(): string {
  const directory = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(directory, 'studio-workflow-fixture.mp4');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=slateblue:size=640x360:rate=30',
      '-t',
      '8',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }
  return file;
}

async function assertNoWorkflowOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const pageElement = document.querySelector('.page');
    const main = document.querySelector('.main');
    if (!pageElement || !main) throw new Error('Missing workflow page or main column');
    return {
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
      mainClientWidth: main.clientWidth,
      mainScrollWidth: main.scrollWidth,
    };
  });
  expect(geometry.pageScrollWidth).toBeLessThanOrEqual(geometry.pageClientWidth + 1);
  expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainClientWidth + 1);
}

async function assertTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  const values = await page.evaluate((nextTheme) => {
    document.documentElement.setAttribute('data-theme', nextTheme);
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      background: root.getPropertyValue('--bg-0').trim(),
      accent: root.getPropertyValue('--accent').trim(),
    };
  }, theme);
  expect(values.theme).toBe(theme);
  expect(values.background).toBe(theme === 'dark' ? '#08090b' : '#e9eaec');
  expect(values.accent).toBe(theme === 'dark' ? '#ff4d6d' : '#e11d48');
}

async function assertKeyboardFocus(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let index = 0; index < 120; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
  await expect(locator).toHaveCSS('outline-style', 'solid');
  await expect.poll(() => locator.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await expect.poll(() => locator.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
}

async function openImportFromQa(page: Page): Promise<void> {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await expect(page.getByTestId('qa-backend-online')).toHaveText('online');
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();

  const fileInput = page.locator('input[type="file"]');
  const videoPath = process.env.E2E_VIDEO_FIXTURE ?? ensureFixtureVideo();
  await fileInput.setInputFiles(videoPath);
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await fileInput.setInputFiles(videoPath);
  await expect(page.getByText('1 source video ready')).toBeVisible();
}

async function completeAnalysis(page: Page): Promise<void> {
  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({ timeout: 180_000 });
}

async function openReviewClips(page: Page): Promise<void> {
  await page.goto('/#/review');
  const panel = page.getByTestId('source-clips-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('group', { name: 'Candidate Clip view' })).toBeVisible();
}

async function acceptOneClip(page: Page): Promise<void> {
  const add = page.getByRole('button', { name: 'Add to working timeline', exact: true });
  if (await add.count() === 0) {
    const alreadyIncluded = page.getByRole('button', { name: 'Remove from working timeline', exact: true });
    await expect(alreadyIncluded.first()).toBeVisible();
    await alreadyIncluded.first().click();
    await expect(add.first()).toBeVisible();
  }
  await add.first().click();
}

async function waitForTimelineItem(page: Page): Promise<string> {
  await page.goto('/#/playwriter');
  const projectId = (await page.getByTestId('qa-project-id').textContent())?.trim();
  expect(projectId).toBeTruthy();
  await expect.poll(async () => {
    const response = await page.request.get(`http://127.0.0.1:8000/projects/${projectId}/timeline/document`);
    if (!response.ok()) return 0;
    const body = await response.json() as { document?: { items?: Array<{ item_id: string }> } };
    return body.document?.items?.length ?? 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  return projectId!;
}

async function verifyWorkflowAtViewport(page: Page): Promise<void> {
  await openImportFromQa(page);
  await assertTheme(page, 'dark');
  await assertTheme(page, 'light');
  await assertKeyboardFocus(page, page.getByRole('button', { name: 'Thumbs' }));
  await page.getByRole('button', { name: 'Thumbs' }).click();
  await expect(page.locator('[data-view-mode="thumbs"]')).toBeVisible();
  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page.locator('[data-view-mode="compact"]')).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await assertNoWorkflowOverflow(page);
  await completeAnalysis(page);

  await openReviewClips(page);
  await assertTheme(page, 'dark');
  await assertTheme(page, 'light');
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('[data-view-mode="list"]')).toBeVisible();
  await page.getByRole('button', { name: 'Filmstrip' }).click();
  await expect(page.locator('[data-view-mode="filmstrip"]')).toBeVisible();
  await page.getByRole('button', { name: 'Grid' }).click();
  await acceptOneClip(page);
  await assertNoWorkflowOverflow(page);

  const projectId = await waitForTimelineItem(page);
  await page.goto('/#/timeline');
  await expect(page.getByTestId('timeline-preview-video')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
  await expect.poll(async () => page.getByTestId('timeline-preview-video').evaluate((element) => (element as HTMLVideoElement).readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await assertTheme(page, 'dark');
  await assertTheme(page, 'light');
  await assertKeyboardFocus(page, page.getByTestId('transport-play'));
  await page.evaluate(() => {
    const hint = document.querySelector<HTMLElement>('.timeline-hint');
    if (!hint) throw new Error('Missing Timeline keyboard hint');
    hint.tabIndex = -1;
    hint.focus();
  });
  const initialTimecode = await page.locator('.timecode').textContent();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.timecode').textContent()).not.toBe(initialTimecode);
  await page.keyboard.press('l');
  await page.keyboard.press('k');
  await expect(page.locator('.timeline')).toHaveAttribute('data-timeline-playing', 'false');
  await page.getByRole('button', { name: /Select / }).first().click();
  await expect(page.getByTestId('timeline-inspector')).toBeVisible();
  await assertNoWorkflowOverflow(page);

  await page.goto('/#/playwriter');
  await expect(page.getByTestId('qa-export-preview')).toHaveText('ready');
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Export' }).click();
  await expect(page.getByRole('group', { name: 'Export format' })).toBeVisible();
  await assertTheme(page, 'dark');
  await assertTheme(page, 'light');
  await assertKeyboardFocus(page, page.getByTestId('export-format-card-edl'));
  await page.getByTestId('export-format-card-edl').click();
  await page.getByTestId('export-selected').click();
  await expect(page.getByTestId('export-result-edl')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('export-result-edl')).toContainText('EDL exported');
  await assertNoWorkflowOverflow(page);

  // Keep the project ID read from the real QA fixture in the test's execution
  // path so a mocked renderer-only route cannot satisfy this acceptance.
  expect(projectId).toMatch(/.+/);
}

test.describe('studio workflow redesign integrated acceptance', () => {
  test.describe('1440x900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('completes Import → Review → Timeline → Export in both themes', async ({ page }) => {
      await verifyWorkflowAtViewport(page);
    });
  });

  test.describe('1024x768', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('completes Import → Review → Timeline → Export in both themes', async ({ page }) => {
      await verifyWorkflowAtViewport(page);
    });
  });
});
