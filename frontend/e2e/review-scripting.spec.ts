import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { fixtureVideo, setupReview } from './reviewSetup';

// The plan's Goal example, adapted to the fixture: it reads the whole library
// and sorts longest first, because the fixture's clips are told apart by length.
const GOAL_SCRIPT = `-- "keep every shot under 3 seconds, longest first, then land near 40s"
local clips = library:clips{}
table.sort(clips, function(a, b) return a.duration > b.duration end)
timeline:clear()
for _, clip in ipairs(clips) do
  local item = timeline:add(clip)
  if item:duration() > 3 then item:trim(item:source_in(), item:source_in() + 3) end
  if timeline:duration() >= 40 then break end
end
log(("%d shots, %.1fs"):format(timeline:count(), timeline:duration()))`;

// `for … end` closes the loop, so the second `end` on line 4 cannot parse.
const SYNTAX_ERROR_SCRIPT = `local total = 0
for i = 1, 3 do
  total = total + i
end end`;

const ADD_FIRST_CLIP_SCRIPT = 'timeline:add(library:clips{}[1])';

interface DocumentItem {
  item_id: string;
  source_clip_id: string;
  start_sec: number;
  end_sec: number;
}

interface TimelineDocument {
  revision: number;
  items: DocumentItem[];
}

/** Records the backend base URL of the project the Review step opens. */
function trackProjectApi(page: Page): () => string {
  let base = '';
  page.on('request', (request) => {
    const match = /^(.*\/projects\/[^/]+)\/review\/session$/.exec(request.url());
    if (match) base = match[1];
  });
  return () => {
    if (!base) throw new Error('The Review step has not loaded a project yet');
    return base;
  };
}

async function readTimeline(request: APIRequestContext, projectApi: string): Promise<TimelineDocument> {
  const response = await request.get(`${projectApi}/timeline/document`);
  return ((await response.json()) as { document: TimelineDocument }).document;
}

async function setTargetDuration(request: APIRequestContext, projectApi: string, seconds: number) {
  const response = await request.post(`${projectApi}/timeline/op`, {
    data: { operation: 'set_target_duration', args: { target_duration_sec: seconds } },
  });
  expect(response.ok()).toBe(true);
}

function composerMode(page: Page, mode: 'Message' | 'Script') {
  return page.getByRole('group', { name: 'Composer mode' }).getByRole('button', { name: mode });
}

async function runScript(page: Page, source: string): Promise<void> {
  await composerMode(page, 'Script').click();
  const editor = page.getByLabel('Lua script');
  await editor.fill(source);
  await editor.press('ControlOrMeta+Enter');
}

/** Runs a Script, Applies its Proposal from the card and returns that card. */
async function runAndApply(page: Page, source: string) {
  await runScript(page, source);
  const card = page.getByTestId('proposal-card').last();
  await expect(card).toBeInViewport();
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible();
  return card;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

test('runs a pasted Script, applies its Proposal as one step, and undoes it', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page, {
    videos: [
      fixtureVideo('scripting-short', 'crimson', 4),
      fixtureVideo('scripting-mid', 'seagreen', 6),
      fixtureVideo('scripting-long', 'goldenrod', 8),
    ],
  });
  // Each Source Video yields one Candidate Clip ending 1 s before its end: 3 s, 5 s and 7 s.
  const library = (await (await page.request.get(`${projectApi()}/clips`)).json()) as {
    clips: Array<{ clip_id: string; file_name: string }>;
  };
  const clipId = (fileName: string) =>
    library.clips.find((clip) => clip.file_name === fileName)?.clip_id ?? fileName;
  const longest = [clipId('scripting-long.mp4'), clipId('scripting-mid.mp4'), clipId('scripting-short.mp4')];
  const before = await readTimeline(page.request, projectApi());
  expect(before.items.map((item) => item.source_clip_id)).not.toEqual(longest);

  await runScript(page, GOAL_SCRIPT);

  const scriptCard = page.getByTestId('script-run-card').last();
  await expect(scriptCard).toBeInViewport();
  await expect(scriptCard.locator('header strong')).toHaveText('Script');
  await expect(scriptCard.locator('header')).toContainText('8 changes');
  await expect(scriptCard.getByLabel('Log')).toHaveText('3 shots, 9.0s');
  const proposal = page.getByTestId('proposal-card').last();
  await expect(proposal).toContainText('Timeline items: 3 → 3');
  await expect(proposal).toContainText('Duration: 12.0 s → 9.0 s');
  await expect(proposal.locator('.proposal-summary li')).toHaveText([
    /^Remove item 1 /,
    /^Remove item 1 /,
    /^Remove item 1 /,
    'Add scripting-long.mp4 0.0–7.0 s at the end',
    'Trim item 1 (scripting-long.mp4) to 0.0–3.0 s',
    'Add scripting-mid.mp4 0.0–5.0 s at the end',
    'Trim item 2 (scripting-mid.mp4) to 0.0–3.0 s',
    'Add scripting-short.mp4 0.0–3.0 s at the end',
  ]);
  await expect(page.getByLabel('Lua script')).toHaveValue(GOAL_SCRIPT);
  expect(await readTimeline(page.request, projectApi())).toEqual(before);

  await page.getByRole('button', { name: 'List' }).click();
  await page.getByLabel('Minimum Smoothness').fill('0');
  const position = (id: string) => page.locator(`[data-review-clip="${id}"]`);

  await proposal.getByRole('button', { name: 'Apply' }).click();
  await expect(proposal.getByRole('button', { name: 'Undo' })).toBeVisible();
  const applied = await readTimeline(page.request, projectApi());
  expect(applied.revision).toBe(before.revision + 1);
  expect(applied.items.map(({ source_clip_id, start_sec, end_sec }) => ({ source_clip_id, start_sec, end_sec })))
    .toEqual(longest.map((id) => ({ source_clip_id: id, start_sec: 0, end_sec: 3 })));
  for (const [index, id] of longest.entries()) {
    await expect(position(id)).toContainText(`Timeline #${index + 1}`);
  }

  await proposal.getByRole('button', { name: 'Undo' }).click();
  await expect(proposal.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect.poll(async () => (await readTimeline(page.request, projectApi())).items).toEqual(before.items);
  for (const [index, item] of before.items.entries()) {
    await expect(position(item.source_clip_id)).toContainText(`Timeline #${index + 1}`);
  }
});

test('shows a syntax error with its line and leaves the Timeline unchanged', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  const before = await readTimeline(page.request, projectApi());

  await runScript(page, SYNTAX_ERROR_SCRIPT);

  const message = page.locator('.chat-msg').filter({ has: page.getByTestId('script-run-card') }).last();
  await expect(message).toBeInViewport();
  await expect(message.getByTestId('script-run-card')).toContainText(
    "Syntax error · line 4: <eof> expected near 'end'",
  );
  await expect(message.getByTestId('script-run-card')).toContainText('No changes');
  await expect(message.getByTestId('proposal-card')).toHaveCount(0);
  expect((await readTimeline(page.request, projectApi())).revision).toBe(before.revision);

  // The draft is kept after Run, so Edit loads the same source and must still focus the editor.
  await message.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Lua script')).toBeFocused();

  await page.getByLabel('Lua script').fill('');
  await composerMode(page, 'Message').click();
  await message.getByRole('button', { name: 'Edit' }).click();
  await expect(composerMode(page, 'Script')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Lua script')).toHaveValue(SYNTAX_ERROR_SCRIPT);
  await expect(page.getByLabel('Lua script')).toBeFocused();
});

test('offers Run again for a stale run and supersedes the old Proposal', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);

  await runScript(page, ADD_FIRST_CLIP_SCRIPT);
  const staleCard = page.getByTestId('proposal-card').last();
  await expect(staleCard).toBeInViewport();
  const staleProposalId = await staleCard.getAttribute('data-proposal-id');

  const before = await readTimeline(page.request, projectApi());
  await setTargetDuration(page.request, projectApi(), 33);

  await staleCard.getByRole('button', { name: 'Apply' }).click();
  await expect(staleCard).toContainText('The Timeline changed since this run.');
  expect((await readTimeline(page.request, projectApi())).revision).toBe(before.revision + 1);

  await staleCard.getByRole('button', { name: 'Run again' }).click();
  const freshCard = page.getByTestId('proposal-card').last();
  await expect(freshCard).not.toHaveAttribute('data-proposal-id', staleProposalId ?? '');
  await expect(freshCard).toBeInViewport();
  await expect(page.locator(`[data-proposal-id="${staleProposalId}"]`)).toContainText(
    'Superseded by a newer run',
  );

  await freshCard.getByRole('button', { name: 'Apply' }).click();
  await expect(freshCard.getByRole('button', { name: 'Undo' })).toBeVisible();
  const applied = await readTimeline(page.request, projectApi());
  expect(applied.revision).toBe(before.revision + 2);
  expect(applied.items).toHaveLength(before.items.length + 1);
});

test('follows each slow Script Run down to its result', async ({ page }) => {
  // A run that takes a moment lets the smooth scroll to the sending message
  // still be moving when the larger result replaces it.
  await page.route('**/projects/*/review/script', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await setupReview(page);
  const longScript = `${Array.from({ length: 30 }, (_, line) => `log("line ${line}")`).join('\n')}
${ADD_FIRST_CLIP_SCRIPT}`;

  for (const runs of [1, 2]) {
    await runScript(page, longScript);
    await expect(page.getByTestId('proposal-card')).toHaveCount(runs);
    await expect(page.getByTestId('proposal-card').last()).toBeInViewport();
  }
});

test('keeps the script editor compact and back at the line starts after a run', async ({ page }) => {
  await setupReview(page);
  await composerMode(page, 'Script').click();
  const editor = page.getByLabel('Lua script');
  const viewportHeight = page.viewportSize()?.height ?? 0;
  const editorHeight = async () => (await editor.boundingBox())?.height ?? Infinity;

  const empty = await editorHeight();
  const wide = `log("${'x'.repeat(400)}")\n`;
  await editor.fill(wide.repeat(40));
  expect(await editorHeight()).toBeLessThanOrEqual(viewportHeight * 0.4);
  expect(await editorHeight()).toBeGreaterThan(empty);

  await editor.evaluate((field) => {
    field.scrollLeft = 300;
  });
  await editor.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('script-run-card')).toHaveCount(1);
  expect(await editor.evaluate((field) => field.scrollLeft)).toBe(0);
  await expect(editor).toHaveValue(wide.repeat(40));
});

test('keeps a card Undo available after a failed attempt', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  const card = await runAndApply(page, ADD_FIRST_CLIP_SCRIPT);
  const applied = await readTimeline(page.request, projectApi());
  let failNext = true;
  await page.route('**/projects/*/timeline/undo', async (route) => {
    if (failNext) {
      failNext = false;
      await route.abort();
      return;
    }
    await route.continue();
  });

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not undo that change.');
  await card.getByRole('button', { name: 'Undo' }).click();

  await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  const undone = await readTimeline(page.request, projectApi());
  expect(undone.revision).toBe(applied.revision + 1);
  expect(undone.items).toHaveLength(applied.items.length - 1);
});

test('hides a card Undo once a later edit moves the Timeline on', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  const card = await runAndApply(page, ADD_FIRST_CLIP_SCRIPT);

  await setTargetDuration(page.request, projectApi(), 33);

  await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('refuses a card Undo that would undo a newer edit', async ({ page }) => {
  // Without the live event stream the GUI cannot learn about the racing edit
  // before the click, so only the backend revision guard can stop the Undo.
  await page.route('**/projects/*/events', (route) => route.abort());
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  const card = await runAndApply(page, ADD_FIRST_CLIP_SCRIPT);
  const applied = await readTimeline(page.request, projectApi());

  await setTargetDuration(page.request, projectApi(), 33);
  await card.getByRole('button', { name: 'Undo' }).click();

  await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  const after = await readTimeline(page.request, projectApi());
  expect(after.revision).toBe(applied.revision + 1);
  expect(after.items).toEqual(applied.items);
});

test('retries an unsent Script Run with the same client message id', async ({ page }) => {
  const requests: Array<{ client_message_id: string; source: string }> = [];
  let failNext = true;
  await page.route('**/projects/*/review/script', async (route) => {
    requests.push(route.request().postDataJSON());
    if (failNext) {
      failNext = false;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await setupReview(page);

  await runScript(page, ADD_FIRST_CLIP_SCRIPT);
  const unsent = page.locator('.chat-msg').filter({ hasText: 'Not sent' });
  await expect(unsent).toBeInViewport();
  await unsent.getByRole('button', { name: 'Retry' }).click();

  const delivered = page.locator(`[data-message-id="${requests[0].client_message_id}"]`);
  await expect(delivered.getByTestId('proposal-card')).toBeInViewport();
  await expect(delivered).not.toContainText('Not sent');
  expect(requests.map((request) => request.client_message_id)).toEqual([
    requests[0].client_message_id,
    requests[0].client_message_id,
  ]);
});

test('keeps a separate draft per composer mode and still sends messages on Enter', async ({ page }) => {
  await setupReview(page);
  await expect(composerMode(page, 'Message')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Message the AI').fill('Tighten the opening.');
  await composerMode(page, 'Script').click();
  await expect(composerMode(page, 'Script')).toHaveAttribute('aria-pressed', 'true');
  const editor = page.getByLabel('Lua script');
  await editor.fill('log("draft")');
  await editor.press('Enter');
  await editor.press('Tab');
  await expect(editor).toHaveValue('log("draft")\n  ');
  await expect(page.getByText('Tab indents · Shift+Tab leaves')).toBeVisible();
  await editor.press('Shift+Tab');
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue('log("draft")\n  ');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  await composerMode(page, 'Message').click();
  await expect(page.getByLabel('Message the AI')).toHaveValue('Tighten the opening.');
  const turn = page.waitForResponse((response) => response.url().endsWith('/review/turn'));
  await page.getByLabel('Message the AI').press('Enter');
  expect((await turn).ok()).toBe(true);
  const sent = page.locator('.chat-msg.chat-editor').filter({ hasText: 'Tighten the opening.' });
  await expect(sent.locator('.chat-delivery')).toHaveCount(0);
  await expect(page.getByLabel('Message the AI')).toHaveValue('');

  await composerMode(page, 'Script').click();
  await expect(editor).toHaveValue('log("draft")\n  ');
});
