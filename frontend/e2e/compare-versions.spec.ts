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
  const reviewSession = {
    schema_version: 1,
    session_id: 'session-e2e',
    updated_at: '2026-06-21T10:01:00Z',
    messages: [
      {
        message_id: 'agent-opening',
        role: 'agent',
        text: 'I would open on the shoreline and let the movement build.',
        created_at: '2026-06-21T10:00:00Z',
        payload: {},
        proposal: {
          proposal_id: 'proposal-e2e',
          project_id: 'project-e2e',
          message: 'Open on the shoreline.',
          operations: [{ operation: 'include', args: { clip_id: 'clip-e2e' } }],
          summary: ['Add the shoreline opening'],
          before_item_count: 0,
          after_item_count: 1,
          status: 'pending',
        },
      },
      {
        message_id: 'editor-direction',
        role: 'editor',
        text: 'Keep it calm and cinematic.',
        created_at: '2026-06-21T10:01:00Z',
        payload: {},
        proposal: null,
      },
    ],
  };

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/projects/*/review/session', async (route) => {
    await route.fulfill({ json: reviewSession });
  });
  await page.route('**/projects/*/review/turn', async (route) => {
    const request = route.request().postDataJSON() as { message: string };
    reviewSession.messages.push(
      {
        message_id: 'editor-follow-up',
        role: 'editor',
        text: request.message,
        created_at: '2026-06-21T10:02:00Z',
        payload: {},
        proposal: null,
      },
      {
        message_id: 'agent-follow-up',
        role: 'agent',
        text: 'I kept the pacing measured and the visual progression clear.',
        created_at: '2026-06-21T10:02:01Z',
        payload: {},
        proposal: null,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      json: {
        message: reviewSession.messages.at(-1)?.text,
        proposal: null,
        agent_message: reviewSession.messages.at(-1),
        session: reviewSession,
      },
    });
  });

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

  // --- Segmented Version playback timeline ---------------------------------
  const firstCard = cards.first();
  const scrubber = firstCard.locator('.version-scrubber-track');
  await expect(scrubber).toBeVisible();
  await expect(scrubber).toHaveAttribute('role', 'slider');

  // One segment per Version item, widths proportional to effective duration.
  const segments = firstCard.locator('.version-scrubber-segment');
  const segmentCount = await segments.count();
  expect(segmentCount).toBeGreaterThanOrEqual(2);
  const widths = await segments.evaluateAll((nodes) =>
    nodes.map((node) => Number.parseFloat((node as HTMLElement).style.width)),
  );
  for (const width of widths) expect(width).toBeGreaterThan(0);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  expect(totalWidth).toBeGreaterThan(99);
  expect(totalWidth).toBeLessThan(101);

  // current / total time, clip N of M, current filename and source timecode.
  await expect(firstCard.locator('.version-scrubber-time')).toContainText('/');
  await expect(firstCard.locator('.version-scrubber-time')).toContainText(/\d:\d{2}\.\d/);
  await expect(firstCard.locator('.version-scrubber-position')).toContainText(
    `clip 1 of ${segmentCount}`,
  );
  await expect(firstCard.locator('.version-scrubber-source')).toContainText(/\d:\d{2}\.\d/);

  // Click-to-seek into the last segment.
  await segments.last().click();
  await expect(firstCard.locator('.version-scrubber-position')).toContainText(
    `clip ${segmentCount} of ${segmentCount}`,
  );

  // Keyboard Left/Right seeks by one second of Version time.
  await segments.first().click();
  await expect(firstCard.locator('.version-scrubber-position')).toContainText(
    `clip 1 of ${segmentCount}`,
  );
  await scrubber.focus();
  const timeAtStart = await firstCard.locator('.version-scrubber-time').textContent();
  await scrubber.press('ArrowRight');
  await expect(firstCard.locator('.version-scrubber-time')).not.toHaveText(timeAtStart ?? '');
  await scrubber.press('ArrowLeft');
  await expect(firstCard.locator('.version-scrubber-time')).toHaveText(timeAtStart ?? '');

  // Dragging across the scrubber continuously seeks by Version time.
  const scrubberBox = await scrubber.boundingBox();
  expect(scrubberBox).not.toBeNull();
  const beforeDrag = Number(await scrubber.getAttribute('aria-valuenow'));
  await page.mouse.move(scrubberBox!.x + 2, scrubberBox!.y + scrubberBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    scrubberBox!.x + scrubberBox!.width * 0.6,
    scrubberBox!.y + scrubberBox!.height / 2,
  );
  await page.mouse.up();
  const afterDrag = Number(await scrubber.getAttribute('aria-valuenow'));
  expect(afterDrag).toBeGreaterThan(beforeDrag + 1);

  // Exclusive playback: starting one Version pauses the previously active one.
  const firstPlay = cards.nth(0).locator('.version-player-play');
  const secondPlay = cards.nth(1).locator('.version-player-play');
  await firstPlay.click();
  await expect(firstPlay).toHaveAttribute('aria-label', /^Pause/);
  await secondPlay.click();
  await expect(secondPlay).toHaveAttribute('aria-label', /^Pause/);
  await expect(firstPlay).toHaveAttribute('aria-label', /^Play/);
  await secondPlay.click();

  await expect(page.getByTestId('review-chat-panel')).toBeVisible();
  const agentMessage = page.locator('[data-message-id="agent-opening"]');
  const editorMessage = page.locator('[data-message-id="editor-direction"]');
  await expect(agentMessage).toHaveAccessibleName(/Review agent/);
  await expect(editorMessage).toHaveAccessibleName(/You/);
  await expect(agentMessage.locator('time')).toHaveAttribute(
    'datetime',
    '2026-06-21T10:00:00Z',
  );
  await expect(agentMessage.getByTestId('proposal-card')).toBeVisible();
  await expect(editorMessage).toHaveCSS('text-align', 'right');
  await expect(agentMessage).toHaveCSS('max-width', /^(82|100)%$/);
  expect(
    await agentMessage.evaluate(
      (node) => node.getBoundingClientRect().width <= (node.parentElement?.clientWidth ?? 0),
    ),
  ).toBe(true);
  expect(await agentMessage.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    await editorMessage.evaluate((node) => getComputedStyle(node).backgroundColor),
  );

  await page.getByLabel('Message the review agent').fill('Make the ending breathe.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status', { name: 'Review agent is thinking' })).toBeVisible();
  await expect(page.locator('[data-message-id="agent-follow-up"]')).toBeVisible();

  await page.getByRole('link', { name: 'Timeline' }).click();
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.locator('[data-message-id="agent-opening"]')).toBeVisible();
  await expect(page.locator('[data-message-id="editor-direction"]')).toBeVisible();
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
