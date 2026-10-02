import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A solid-colour Source Video; distinct names, colours and lengths give distinguishable clips. */
export function fixtureVideo(
  name = 'review-browser-fixture',
  color = 'slateblue',
  seconds = 8,
): string {
  const directory = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(directory, `${name}.mp4`);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:size=640x360:rate=30`,
      '-t', String(seconds), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file,
    ]);
  }
  return file;
}

export async function openClips(page: Page): Promise<void> {
  const panel = page.getByTestId('source-clips-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-open', 'true');
}

export interface AnalysisMetadataFixture {
  used_ai?: boolean;
  warning?: string;
  per_video: Array<{
    file_id: string;
    file_name: string;
    used_ai?: boolean;
    warning?: string;
  }>;
}

export async function setupReview(
  page: Page,
  options: {
    harnessId?: 'manual' | 'pi_agent';
    analysisMetadata?: AnalysisMetadataFixture;
    videos?: string[];
  } = {},
): Promise<void> {
  const videos = options.videos ?? [fixtureVideo()];
  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await page.getByTestId('playwriter-qa-panel').getByRole('link', { name: 'Import' }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(videos[0]);
  await expect(page.getByText(/Legacy upload project created/)).toBeVisible();
  await input.setInputFiles(videos);
  await expect(
    page.getByText(`${videos.length} source video${videos.length === 1 ? '' : 's'} ready`),
  ).toBeVisible();

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
