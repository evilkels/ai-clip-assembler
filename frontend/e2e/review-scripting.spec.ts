import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { setupReview } from './reviewSetup';

// The plan's Goal example, adapted to read the whole library so the run does
// not depend on the fixture's Clip decisions.
const GOAL_SCRIPT = `-- "keep every shot under 3 seconds, best first, then land near 40s"
local clips = library:clips{}
table.sort(clips, function(a, b) return a.score > b.score end)
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

interface Snapshot {
  document: { revision: number; items: DocumentItem[] };
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

async function readTimeline(request: APIRequestContext, projectApi: string): Promise<Snapshot['document']> {
  const response = await request.get(`${projectApi}/timeline/document`);
  return ((await response.json()) as Snapshot).document;
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

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

test('runs a pasted Script, applies its Proposal as one step, and undoes it', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  // The fixture is one 8 s Source Video that yields one 0–7 s Candidate Clip on the Timeline.
  const before = await readTimeline(page.request, projectApi());
  const clipId = before.items[0].source_clip_id;

  await runScript(page, GOAL_SCRIPT);

  const scriptCard = page.getByTestId('script-run-card').last();
  await expect(scriptCard.locator('header strong')).toHaveText('Script');
  await expect(scriptCard.locator('header')).toContainText('3 changes');
  await expect(scriptCard.getByLabel('Log')).toHaveText('1 shots, 3.0s');
  const proposal = page.getByTestId('proposal-card').last();
  await expect(proposal).toContainText('Timeline items: 1 → 1');
  await expect(proposal).toContainText('Duration: 7.0 s → 3.0 s');
  await expect(proposal.locator('.proposal-summary li')).toHaveText([
    'Remove item 1 (review-browser-fixture.mp4)',
    'Add review-browser-fixture.mp4 0.0–7.0 s at the end',
    'Trim item 1 (review-browser-fixture.mp4) to 0.0–3.0 s',
  ]);
  await expect(page.getByLabel('Lua script')).toHaveValue(GOAL_SCRIPT);

  await proposal.getByRole('button', { name: 'Apply' }).click();
  await expect(proposal.getByRole('button', { name: 'Undo' })).toBeVisible();
  const applied = await readTimeline(page.request, projectApi());
  expect(applied.revision).toBe(before.revision + 1);
  expect(applied.items.map(({ source_clip_id, start_sec, end_sec }) => ({ source_clip_id, start_sec, end_sec })))
    .toEqual([{ source_clip_id: clipId, start_sec: 0, end_sec: 3 }]);

  await proposal.getByRole('button', { name: 'Undo' }).click();
  await expect(proposal.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect.poll(async () => (await readTimeline(page.request, projectApi())).items).toEqual(before.items);
});

test('shows a syntax error with its line and leaves the Timeline unchanged', async ({ page }) => {
  const projectApi = trackProjectApi(page);
  await setupReview(page);
  const before = await readTimeline(page.request, projectApi());

  await runScript(page, SYNTAX_ERROR_SCRIPT);

  const message = page.locator('.chat-msg').filter({ has: page.getByTestId('script-run-card') }).last();
  await expect(message.getByTestId('script-run-card')).toContainText(
    "Syntax error · line 4: <eof> expected near 'end'",
  );
  await expect(message.getByTestId('script-run-card')).toContainText('No changes');
  await expect(message.getByTestId('proposal-card')).toHaveCount(0);
  expect((await readTimeline(page.request, projectApi())).revision).toBe(before.revision);

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
  await expect(staleCard.getByRole('button', { name: 'Apply' })).toBeVisible();
  const staleProposalId = await staleCard.getAttribute('data-proposal-id');

  const before = await readTimeline(page.request, projectApi());
  await page.request.post(`${projectApi()}/timeline/op`, {
    data: { operation: 'set_target_duration', args: { target_duration_sec: 33 } },
  });

  await staleCard.getByRole('button', { name: 'Apply' }).click();
  await expect(staleCard).toContainText('The Timeline changed since this run.');
  expect((await readTimeline(page.request, projectApi())).revision).toBe(before.revision + 1);

  await staleCard.getByRole('button', { name: 'Run again' }).click();
  const freshCard = page.getByTestId('proposal-card').last();
  await expect(freshCard).not.toHaveAttribute('data-proposal-id', staleProposalId ?? '');
  await expect(freshCard.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expect(page.locator(`[data-proposal-id="${staleProposalId}"]`)).toContainText(
    'Superseded by a newer run',
  );
});

test('keeps a separate draft per composer mode and still sends messages on Enter', async ({ page }) => {
  await setupReview(page);
  await expect(composerMode(page, 'Message')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Message the AI').fill('Tighten the opening.');
  await composerMode(page, 'Script').click();
  await expect(composerMode(page, 'Script')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Lua script').fill('log("draft")');
  await page.getByLabel('Lua script').press('Enter');
  await page.getByLabel('Lua script').press('Tab');
  await expect(page.getByLabel('Lua script')).toHaveValue('log("draft")\n  ');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  await composerMode(page, 'Message').click();
  await expect(page.getByLabel('Message the AI')).toHaveValue('Tighten the opening.');
  await page.getByLabel('Message the AI').press('Enter');
  await expect(page.locator('.chat-msg.chat-editor').filter({ hasText: 'Tighten the opening.' })).toBeVisible();
  await expect(page.getByLabel('Message the AI')).toHaveValue('');

  await composerMode(page, 'Script').click();
  await expect(page.getByLabel('Lua script')).toHaveValue('log("draft")\n  ');
});
