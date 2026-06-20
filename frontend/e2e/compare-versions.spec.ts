import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function ensureFixtureVideo(): string {
  const directory = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(directory, 'compare-versions-fixture.mp4');
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
      'color=c=slategray:size=640x360:rate=30',
      '-t',
      '8',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }
  return file;
}

test('compares, focuses, and adopts complete versions in the Review workspace', async ({
  page,
}) => {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('qa-backend-online')).toHaveText('online');
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(ensureFixtureVideo());
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await fileInput.setInputFiles(ensureFixtureVideo());
  await expect(page.getByText(/1 source video ready/)).toBeVisible();
  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({
    timeout: 180_000,
  });

  await page.goto('/#/review');
  const gallery = page.getByTestId('version-gallery');
  await expect(gallery).toBeVisible();
  const cards = gallery.getByTestId('version-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.getByTestId('version-vibe')).toHaveCount(3);
  for (const vibe of await cards.getByTestId('version-vibe').all()) {
    await expect(vibe).toContainText(/[1-9]\d*(?:\.\d+)?s/);
  }

  await cards.first().getByTestId('version-card-surface').click();
  await expect(cards.first()).toHaveClass(/expanded/);

  await expect(page.getByTestId('review-chat-panel')).toBeVisible();
  const sourcePanel = page.getByTestId('source-clips-panel');
  await expect(sourcePanel).not.toHaveAttribute('open');
  await expect(sourcePanel.locator('video')).toHaveCount(0);
  await expect(page.getByTestId('working-timeline-strip')).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  const adoptResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/timeline/op') && response.request().method() === 'POST',
  );
  await cards.first().getByTestId('version-adopt').click();
  const response = await adoptResponse;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page.getByTestId('working-timeline-item')).toHaveCount(4, {
    timeout: 10_000,
  });

  const workingTimeline = page.getByTestId('working-timeline-strip');
  await workingTimeline.locator('summary').click();
  await expect(workingTimeline).not.toHaveAttribute('open');
  await page.getByLabel('Smoothness threshold value').fill('6.5');
  await expect(workingTimeline).not.toHaveAttribute('open');
});
