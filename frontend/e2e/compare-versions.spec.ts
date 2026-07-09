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
  const reviewRequestIds: string[] = [];
  const reviewAttempts = new Map<string, number>();
  let currentVersionSet: Record<string, unknown> | null = null;
  let projectApiBase = '';

  const ensureVersionSet = async (sessionUrl: string) => {
    if (currentVersionSet) return;
    const clipsResponse = await page.request.get(sessionUrl.replace('/review/session', '/clips'));
    projectApiBase = sessionUrl.replace('/review/session', '');
    const candidates = (await clipsResponse.json()).clips as Array<{
      clip_id: string;
      file_id: string;
      file_name: string;
      start_sec: number;
      end_sec: number;
    }>;
    const recipes = [
      ['version-a', 'Punchy Social Cut', 'fast & upbeat', 'short_social', 4, 1],
      ['version-b', 'Cinematic Highlight', 'slow & sweeping', 'cinematic_highlight', 3, 0.5],
      ['version-c', 'Long Scenic', 'relaxed & wide', 'long_scenic', 5, 1],
    ] as const;
    const versions = recipes.map(([id, title, vibe, profile, count, speed]) => {
      const items = Array.from({ length: count }, (_, index) => {
        const clip = candidates[index % candidates.length];
        return {
          source_clip_id: clip.clip_id,
          file_id: clip.file_id,
          file_name: clip.file_name,
          start_sec: clip.start_sec,
          end_sec: clip.end_sec,
          speed,
          transform: { scale: 1, x: 0, y: 0 },
        };
      });
      return {
        version_id: id,
        title,
        vibe,
        rationale: `${title} fixture rationale.`,
        profile,
        total_duration_sec: items.reduce(
          (total, item) => total + (item.end_sec - item.start_sec) / item.speed,
          0,
        ),
        items,
        sequence_fingerprint: `fixture-${id}`,
      };
    });
    versions[1].items = versions[1].items.filter(
      (item) => item.source_clip_id === candidates[0].clip_id,
    );
    versions[2].items.push({
      source_clip_id: 'missing-clip',
      file_id: 'missing-file',
      file_name: 'MISSING.MOV',
      start_sec: 0,
      end_sec: 1,
      speed: 1,
      transform: { scale: 1, x: 0, y: 0 },
    });
    const preparedApplyResponse = await page.request.post(`${projectApiBase}/timeline/op`, {
      data: {
        operation: 'replace_timeline',
        args: {
          items: versions[0].items.map(
            ({ source_clip_id, start_sec, end_sec, speed, transform }) => ({
              source_clip_id,
              start_sec,
              end_sec,
              speed,
              transform,
            }),
          ),
        },
      },
    });
    expect(preparedApplyResponse.ok(), await preparedApplyResponse.text()).toBe(true);
    const preparedSnapshot = await preparedApplyResponse.json();
    versions[0].sequence_fingerprint = preparedSnapshot.sequence_fingerprint;
    const restoreResponse = await page.request.post(`${projectApiBase}/timeline/undo`);
    expect(restoreResponse.ok(), await restoreResponse.text()).toBe(true);
    const timelineSnapshot = await restoreResponse.json();
    currentVersionSet = {
      version_set_id: 'version-set-e2e',
      versions,
      created_at: '2026-06-21T10:00:00Z',
      based_on_timeline_revision: timelineSnapshot.document.revision,
      based_on_sequence_fingerprint: timelineSnapshot.sequence_fingerprint,
      based_on_review_context_fingerprint: timelineSnapshot.review_context_fingerprint,
    };
    reviewSession.schema_version = 2;
    (reviewSession.messages[0].payload as Record<string, unknown>).version_set =
      currentVersionSet;
  };

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/projects/*/review/session', async (route) => {
    await ensureVersionSet(route.request().url());
    await route.fulfill({ json: reviewSession });
  });
  await page.route('**/projects/*/review/turn', async (route) => {
    const request = route.request().postDataJSON() as {
      message: string;
      client_message_id: string;
    };
    reviewRequestIds.push(request.client_message_id);
    const attempt = (reviewAttempts.get(request.client_message_id) ?? 0) + 1;
    reviewAttempts.set(request.client_message_id, attempt);
    if (request.message === 'Retry this direction.' && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ status: 500, json: { detail: 'temporary failure' } });
      return;
    }
    if (request.message.startsWith('Refresh the three versions')) {
      const snapshotResponse = await page.request.get(`${projectApiBase}/timeline/document`);
      const snapshot = await snapshotResponse.json();
      currentVersionSet = {
        ...currentVersionSet,
        version_set_id: `version-set-refresh-${attempt}`,
        created_at: '2026-06-21T10:03:00Z',
        based_on_timeline_revision: snapshot.document.revision,
        based_on_sequence_fingerprint: snapshot.sequence_fingerprint,
        based_on_review_context_fingerprint: snapshot.review_context_fingerprint,
      };
    }
    const editorMessage = {
      message_id: request.client_message_id,
      role: 'editor',
      text: request.message,
      created_at: '2026-06-21T10:02:00Z',
      reply_to_message_id: null,
      payload: {},
      proposal: null,
    };
    if (!reviewSession.messages.some((message) => message.message_id === request.client_message_id)) {
      reviewSession.messages.push(editorMessage);
    }
    const agentMessage = {
      message_id: `agent-${request.client_message_id}`,
      role: 'agent',
      text: 'I kept the pacing measured and the visual progression clear.',
      created_at: '2026-06-21T10:02:01Z',
      reply_to_message_id: request.client_message_id,
      payload: { version_set: currentVersionSet },
      proposal: null,
    };
    reviewSession.messages.push(
      agentMessage,
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
  await expect(page.getByTestId('version-player-version-a')).toBeVisible();
  await expect(cards.getByTestId('version-vibe')).toHaveCount(3);
  for (const vibe of await cards.getByTestId('version-vibe').all()) {
    await expect(vibe).toContainText(/[1-9]\d*(?:\.\d+)?s/);
  }
  await expect(page.getByText('Ask the AI', { exact: true })).toBeVisible();
  await expect(page.getByText('Suggested cuts', { exact: true })).toBeVisible();
  await expect(page.getByRole('strong').filter({ hasText: /^All clips \(\d+\)$/ })).toBeVisible();
  await expect(
    page.getByText('These are previews. Editing individual clips changes your video, not these suggestions.'),
  ).toBeVisible();
  await expect(cards.nth(0)).toContainText('Current suggestion');
  await expect(cards.nth(2)).toContainText('Unavailable');
  await expect(cards.nth(2)).toContainText('MISSING.MOV');
  await expect(cards.nth(2).getByTestId('version-adopt')).toBeDisabled();

  const sourcePanelForState = page.getByTestId('source-clips-panel');
  await sourcePanelForState.locator('summary').first().click();
  const sourceCards = sourcePanelForState.locator('.clip-card');
  await expect(sourceCards.first()).toContainText(/Timeline #\d+/);
  const timelineSourceCard = sourceCards.first();
  // version-a and version-c both include the second Source Clip card, but
  // version-b only includes the first — so this card is the one deterministically
  // labeled "Proposed in A/C" (the first card is "Proposed in A/B/C").
  const proposedInACCard = sourceCards.nth(1);
  await expect(proposedInACCard.getByText('Proposed in A/C')).toBeVisible();
  await timelineSourceCard.getByRole('button', { name: 'Remove from working timeline' }).click();
  await expect(timelineSourceCard.getByRole('button', { name: 'Add to working timeline' })).toBeVisible();
  await timelineSourceCard.getByRole('button', { name: 'Add to working timeline' }).click();
  await expect(timelineSourceCard).toContainText(/Timeline #\d+/);
  await expect(
    page.getByText('Your video or clip choices changed since these suggestions were made.'),
  ).toBeVisible();
  await expect(sourcePanelForState.getByText(/Proposed in/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask the AI to refresh suggestions' }).click();
  await expect(
    page.getByText('Refresh the three versions using my current Working Timeline and Source Clip decisions.'),
  ).toBeVisible();
  await expect(
    page.getByText('Your video or clip choices changed since these suggestions were made.'),
  ).toHaveCount(0);
  await expect(proposedInACCard.getByText('Proposed in A/C')).toBeVisible();

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
  await expect(agentMessage).toHaveAccessibleName(/AI message/);
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

  await page.getByLabel('Message the AI').fill('Make the ending breathe.');
  await page.getByRole('button', { name: 'Send' }).click();
  const optimisticBubble = page
    .locator('.chat-msg')
    .filter({ hasText: 'Make the ending breathe.' });
  await expect(optimisticBubble).toBeVisible();
  await expect(optimisticBubble).toContainText('Sending');
  await expect(page.getByRole('status', { name: 'The AI is thinking' })).toBeVisible();
  await expect(page.locator(`[data-message-id="agent-${reviewRequestIds[0]}"]`)).toBeVisible();
  await expect(optimisticBubble).not.toContainText('Sending');

  await page.getByLabel('Message the AI').fill('Retry this direction.');
  await page.getByRole('button', { name: 'Send' }).click();
  const failedBubble = page.locator('.chat-msg').filter({ hasText: 'Retry this direction.' });
  await expect(failedBubble).toContainText('Not sent');
  await expect(failedBubble.getByRole('button', { name: 'Retry' })).toBeVisible();
  const failedMessageId = reviewRequestIds.at(-1);
  await failedBubble.getByRole('button', { name: 'Retry' }).click();
  await expect(failedBubble).not.toContainText('Not sent');
  expect(reviewRequestIds.at(-1)).toBe(failedMessageId);
  await expect(page.locator(`[data-message-id="${failedMessageId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-message-id="agent-${failedMessageId}"]`)).toBeVisible();
  await expect(failedBubble).not.toContainText('Sending');

  await page.getByRole('link', { name: 'Timeline' }).click();
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.locator('[data-message-id="agent-opening"]')).toBeVisible();
  await expect(page.locator('[data-message-id="editor-direction"]')).toBeVisible();
  const sourcePanel = page.getByTestId('source-clips-panel');
  await expect(sourcePanel).not.toHaveAttribute('open');
  await expect(sourcePanel.locator('video')).toHaveCount(0);

  await cards.first().getByTestId('version-adopt').click();
  const applyDialog = page.getByRole('dialog', {
    name: 'Apply Punchy Social Cut to working timeline?',
  });
  await expect(applyDialog).toBeVisible();
  await expect(applyDialog).toContainText(/Items.*current.*proposed/s);
  await expect(applyDialog).toContainText(/Duration.*current.*proposed/s);
  await expect(applyDialog).toContainText(
    'Manual trims, order, speed, transforms, and other Working Timeline changes will be replaced.',
  );

  // An external mutation after opening invalidates the prepared expected revision.
  const externalMutation = await page.request.post(`${projectApiBase}/timeline/op`, {
    data: {
      operation: 'set_target_duration',
      args: { target_duration_sec: 119 },
    },
  });
  expect(externalMutation.ok(), await externalMutation.text()).toBe(true);
  await applyDialog.getByRole('button', { name: 'Apply to working timeline' }).click();
  await expect(applyDialog.getByRole('alert')).toContainText(
    'Working Timeline changed while this comparison was open.',
  );
  await expect(cards).toHaveCount(3);

  await applyDialog.getByRole('button', { name: 'Cancel' }).click();
  await cards.first().getByTestId('version-adopt').click();
  const reopenedDialog = page.getByRole('dialog', {
    name: 'Apply Punchy Social Cut to working timeline?',
  });
  const adoptResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/timeline/op') &&
      response.request().method() === 'POST' &&
      response.status() === 200,
  );
  await reopenedDialog.getByRole('button', { name: 'Apply to working timeline' }).click();
  const response = await adoptResponse;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(cards.first()).toContainText('In working timeline');

  // The adopted cut lands on the Working Timeline; verify it on the Timeline page
  // (the Review page no longer embeds a duplicate timeline strip).
  await page.getByRole('link', { name: 'Timeline' }).click();
  await expect(page.locator('.tl-clip')).toHaveCount(4, { timeout: 10_000 });
});
