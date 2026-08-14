import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
  await expect.poll(async () => {
    if (await panel.evaluate((element) => (element as HTMLDetailsElement).open)) return true;
    await panel.locator('> summary').click();
    return panel.evaluate((element) => (element as HTMLDetailsElement).open);
  }).toBe(true);
}

async function setupReview(page: Page): Promise<void> {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await input.setInputFiles(fixtureVideo());
  await expect(page.getByText(/1 source video ready/)).toBeVisible();
  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({ timeout: 180_000 });
  await page.goto('/#/review');
  await openClips(page);
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
