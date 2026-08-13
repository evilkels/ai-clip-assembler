/**
 * E2E coverage for Plan 026: preview audio.
 *
 * Renderer behavior is asserted through the rendered controls and the media
 * element's own properties because this repository has no renderer unit-test
 * runner. One fixture carries a real stereo track and one has no audio stream
 * at all, so the audio/silent/unknown distinction is exercised end to end.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PREVIEW_AUDIO_KEY = 'ai-clip-assembler:preview-audio:v1';

function ensureFixtureVideo(name: string, color: string, withAudio: boolean): string {
  const dir = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(dir, name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) {
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    args.push('-f', 'lavfi', '-i', `color=c=${color}:size=640x360:rate=30`);
    if (withAudio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
    args.push('-t', '8', '-map', '0:v:0');
    if (withAudio) args.push('-map', '1:a:0', '-c:a', 'aac', '-ac', '2');
    args.push('-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-shortest', file);
    execFileSync('ffmpeg', args);
  }
  return file;
}

const audioFixture = () => ensureFixtureVideo('preview-stereo.mp4', 'gray', true);
const silentFixture = () => ensureFixtureVideo('preview-silent.mp4', 'navy', false);

/** Open the clips panel. The first click can land before React has attached
 * its handler, so retry until the panel actually reports open. */
async function openClipsPanel(page: Page) {
  const panel = page.getByTestId('source-clips-panel');
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => {
      if (await panel.evaluate((element) => (element as HTMLDetailsElement).open)) return true;
      await panel.locator('> summary').click();
      return panel.evaluate((element) => (element as HTMLDetailsElement).open);
    })
    .toBe(true);
  await expect(page.locator('.clip-card').first()).toBeVisible();
}

/** Import fixtures, analyze with the manual harness, accept every candidate. */
async function setupProject(page: Page, files: string[]) {
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(files[0]);
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  for (const [index, file] of files.entries()) {
    await fileInput.setInputFiles(file);
    await expect(page.getByText(new RegExp(`${index + 1} source videos? ready`))).toBeVisible();
  }

  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('Analysis complete. Head to Review')).toBeVisible({
    timeout: 180_000,
  });

  await page.goto('/#/review');
  await openClipsPanel(page);
  const includeButton = page.getByRole('button', { name: 'Include', exact: true });
  for (let i = 0; i < 6 && (await includeButton.count()) > 0; i += 1) {
    const before = await includeButton.count();
    await includeButton.first().click();
    await expect.poll(() => includeButton.count()).toBeLessThan(before);
  }
}

const mutedOf = (locator: ReturnType<Page['getByTestId']>) =>
  locator.evaluate((element) => (element as HTMLVideoElement).muted);
const volumeOf = (locator: ReturnType<Page['getByTestId']>) =>
  locator.evaluate((element) => (element as HTMLVideoElement).volume);

test('starts muted, then shares one preference across Review and Timeline', async ({ page }) => {
  await setupProject(page, [audioFixture()]);

  await page.goto('/#/timeline');
  const video = page.getByTestId('timeline-preview-video');
  await expect(video).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => mutedOf(video)).toBe(true);
  await expect.poll(() => volumeOf(video)).toBe(0.8);

  await page.getByTestId('preview-audio-toggle').click();
  await page.getByRole('slider', { name: 'Volume' }).fill('0.4');
  await expect.poll(() => mutedOf(video)).toBe(false);
  await expect.poll(() => volumeOf(video)).toBe(0.4);
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).preservesPitch)).toBe(
    true,
  );
  await expect(page.getByTestId('preview-audio-toggle')).toHaveAttribute('aria-pressed', 'true');

  // The same preference, not a second copy seeded from storage.
  await page.goto('/#/review');
  await openClipsPanel(page);
  const reviewVideo = page.locator('.clip-card video').first();
  await expect.poll(() => mutedOf(reviewVideo)).toBe(false);
  await expect.poll(() => volumeOf(reviewVideo)).toBe(0.4);
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('0.4');
  expect(await page.evaluate((key) => localStorage.getItem(key), PREVIEW_AUDIO_KEY)).toBe(
    JSON.stringify({ muted: false, volume: 0.4 }),
  );

  // Chromium can refuse unmuted playback: fall back to muted rather than
  // leaving the playhead stalled, and show the state that is actually audible.
  await page.goto('/#/timeline');
  await expect(video).toBeVisible({ timeout: 15_000 });
  await video.evaluate((element) => {
    element.play = () => Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
  });
  await page.getByTestId('transport-play').click();
  await expect.poll(() => mutedOf(video)).toBe(true);
  await expect(page.getByTestId('preview-audio-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('labels audio sources and keeps known-silent sources muted', async ({ page }) => {
  await setupProject(page, [audioFixture(), silentFixture()]);

  await page.goto('/#/review');
  // Enable sound before opening the panel: an unrelated Review re-render
  // collapses the clips panel today (pre-existing, see plan 026 notes).
  await page.getByTestId('preview-audio-toggle').click();
  await openClipsPanel(page);
  const audioCard = page.locator('.clip-card').filter({ hasText: 'preview-stereo.mp4' }).first();
  const silentCard = page.locator('.clip-card').filter({ hasText: 'preview-silent.mp4' }).first();
  await expect(audioCard.getByTestId('source-audio-badge')).toHaveText('Audio · 2ch');
  await expect(silentCard.getByTestId('source-audio-badge')).toHaveText('Silent');

  // The audio source follows the preference; the silent source never does.
  await expect.poll(() => mutedOf(audioCard.locator('video'))).toBe(false);
  await expect.poll(() => mutedOf(silentCard.locator('video'))).toBe(true);

  await page.goto('/#/timeline');
  await expect(
    page.locator('.timeline-item-row').filter({ hasText: 'preview-silent.mp4' }).first()
      .getByTestId('source-audio-badge'),
  ).toHaveText('Silent');
});

test('uses defaults instead of throwing for malformed persisted state', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{not-json'), PREVIEW_AUDIO_KEY);
  await page.goto('/#/review');

  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('0.8');
  await expect(page.getByTestId('preview-audio-toggle')).toHaveAttribute('aria-pressed', 'false');
});
