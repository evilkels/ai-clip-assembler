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
  await expect.poll(async () => panel.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
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
  await page.getByRole('button', { name: /Analyze/ }).click();
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

test('renders the Review workstation with Your Clips visible from the first paint', async ({ page }) => {
  await setupReview(page);

  await expect(page.getByTestId('ask-ai-rail')).toBeVisible();
  await expect(page.getByTestId('review-chat-panel')).toBeVisible();
  await expect(page.getByTestId('suggested-versions-zone')).toBeVisible();
  await expect(page.getByTestId('version-gallery')).toBeVisible();
  await expect(page.getByTestId('candidate-browser-zone')).toBeVisible();
  await expect(page.getByTestId('source-clips-panel')).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('heading', { name: 'Your clips' })).toBeVisible();
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

  await page.getByRole('button', { name: 'List' }).click();
  await page.getByLabel('Minimum Smoothness').fill('0');
  await page.getByLabel('Minimum Overall').fill('7');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(3);
  expect(await browser.locator('[data-review-clip]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-review-clip')))).toEqual([
    'seed-high', timelineClipId, 'seed-mid',
  ]);
  await expect(browser.locator('[data-review-clip="seed-high"]')).toHaveAttribute('data-rank', '1');
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toHaveAttribute('data-rank', '2');
  await expect(browser.locator('[data-review-clip="seed-mid"]')).toHaveAttribute('data-rank', '3');
  await expect(browser.locator(`[data-review-clip="${timelineClipId}"]`)).toContainText('Proposed in A');
  await expect(browser.locator('[data-review-clip="seed-high"]')).toContainText('Proposed in A/B');

  await page.getByLabel('Minimum Overall').fill('8.5');
  await expect(browser.locator('[data-review-clip]')).toHaveCount(1);
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
