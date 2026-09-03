import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function ensureFixtureVideo(): string {
  const dir = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(dir, 'preview-fixture.mp4');
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
      'color=c=gray:size=640x360:rate=30',
      '-t',
      '6',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }
  return file;
}

test('analysis completes and review/timeline previews render playable videos', async ({ page }) => {
  const videoPath = process.env.E2E_VIDEO_FIXTURE ?? ensureFixtureVideo();

  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await expect(page.getByTestId('qa-backend-online')).toHaveText('online');

  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(videoPath);
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await fileInput.setInputFiles(videoPath);
  await expect(page.getByText(/1 source video ready/)).toBeVisible();

  await page.getByLabel('Harness').selectOption('manual');
  await page.getByTestId('source-video-selection-bar').getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({
    timeout: 180_000,
  });

  await page.goto('/#/review');
  await expect(page.getByTestId('source-clips-panel')).toHaveAttribute('data-open', 'true');
  // Candidate cards rest on a poster (plan 029); playing one mounts the video.
  const reviewCard = page.locator('.clip-card').first();
  await expect(reviewCard.getByAltText(/Preview /)).toBeVisible();
  await reviewCard.getByRole('button', { name: 'Play clip' }).click();
  const reviewPreview = reviewCard.locator('video');
  await expect(reviewPreview).toBeVisible();
  await expect
    .poll(async () => reviewPreview.evaluate((video) => (video as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);
  // Ensure at least one Candidate Clip is in the Working Timeline. Candidates
  // may already be auto-drafted (button reads "Remove from working timeline"),
  // so only click an "Add" button when one is present.
  const addToTimeline = page.getByRole('button', {
    name: 'Add to working timeline',
    exact: true,
  });
  if (await addToTimeline.count()) {
    await addToTimeline.first().click();
  }
  await page.goto('/#/playwriter');
  const projectId = await page.getByTestId('qa-project-id').textContent();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `http://127.0.0.1:8000/projects/${projectId}/timeline`,
      );
      const data = await response.json();
      return typeof data.timeline?.clips?.[0] === 'object';
    })
    .toBe(true);

  await page.goto('/#/timeline');
  const timelinePreview = page.getByTestId('timeline-preview-video');
  await expect(timelinePreview).toBeVisible();
  await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
  await expect
    .poll(async () => timelinePreview.evaluate((video) => (video as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);
});
