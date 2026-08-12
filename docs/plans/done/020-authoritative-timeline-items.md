# Authoritative Timeline Items Implementation Plan

> **Status:** DONE (2026-08-10; review-fix pass verified in `a707f96`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Timeline page render, play, and edit every backend-authoritative Timeline Item without collapsing repeated Candidate Clips.

**Architecture:** Keep the backend Timeline Document and Operations core unchanged. Refactor the visual Timeline into a direct `timelineItems` projection keyed by `item_id`; resolve Candidate Clip metadata only for labels and media URLs. Route every visual edit through `applyTimelineOperation` using item identity, and mount the existing detailed `TimelineEditor` below the visual track.

**Tech Stack:** React 19, TypeScript, Playwright, FastAPI Timeline Operations API, semantic HTML, repository CSS variables.

## Global Constraints

- ADR-0002 remains authoritative: the backend Timeline Document is the only Timeline truth.
- Review Board decisions remain Candidate-Clip-based; do not redefine include/exclude behavior.
- Preserve multi-instance items, item-specific bounds, Speed, and Transform.
- No new persistence shape, dependency, mutation endpoint, transition, audio, title, color, or multi-track feature.
- Real-time Transform preview beyond the existing zoom support is out of scope.
- Reports must be standalone semantic HTML with inline CSS only and no network dependency.

---

### Task 1: Lock the authoritative Timeline behavior with browser tests

**Files:**
- Modify: `frontend/e2e/timeline-playback.spec.ts`

**Interfaces:**
- Consumes: `POST /projects/{project_id}/timeline/op` with `replace_timeline`, `reorder`, `set_bounds`, and `remove_item`.
- Produces: regression coverage that distinguishes Timeline Items by `item_id`, even when `source_clip_id` repeats.

- [ ] **Step 1: Add a helper that installs repeated authoritative items**

Add beside `setupTimeline`:

```ts
async function replaceWithRepeatedItems(page: Page, projectId: string) {
  const snapshot = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  );
  const document = (await snapshot.json()).document;
  const source = document.items[0];
  const response = await page.request.post(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/op`,
    {
      data: {
        operation: 'replace_timeline',
        args: {
          items: [
            {
              source_clip_id: source.source_clip_id,
              start_sec: source.start_sec,
              end_sec: source.start_sec + 2,
              speed: 1,
              transform: { scale: 1, x: 0, y: 0 },
            },
            {
              source_clip_id: source.source_clip_id,
              start_sec: source.start_sec + 2,
              end_sec: source.start_sec + 6,
              speed: 2,
              transform: { scale: 1.25, x: 0.1, y: 0 },
            },
          ],
        },
      },
    },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).document.items as Array<{ item_id: string }>;
}
```

Return `projectId` from `setupTimeline` with the video so tests can call the helper.

- [ ] **Step 2: Add failing repeated-item and effective-duration tests**

```ts
test('renders repeated source clips as distinct authoritative Timeline Items', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.reload();
  await expect(page.locator('.tl-clip')).toHaveCount(2);
  await expect(page.locator(`[data-timeline-item-id="${items[0].item_id}"]`)).toBeVisible();
  await expect(page.locator(`[data-timeline-item-id="${items[1].item_id}"]`)).toBeVisible();
  await expect(page.getByTestId('timeline-summary')).toContainText('2 items · 4.0s');
});

test('visual edits address the selected Timeline Item', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  const items = await replaceWithRepeatedItems(page, projectId);
  await page.reload();
  await page.locator(`[data-timeline-item-id="${items[1].item_id}"]`).click();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => {
    const response = await page.request.get(
      `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
    );
    const document = (await response.json()).document;
    return document.items[0].item_id;
  }).toBe(items[1].item_id);
});
```

- [ ] **Step 3: Run the focused tests and confirm the current projection fails**

Run:

```bash
cd frontend
npx playwright test e2e/timeline-playback.spec.ts --grep "authoritative Timeline Items|selected Timeline Item"
```

Expected: FAIL because the visual Timeline deduplicates by Candidate Clip ID and has no item-ID locator.

- [ ] **Step 4: Commit the red tests**

```bash
git add frontend/e2e/timeline-playback.spec.ts
git commit -m "test: cover authoritative timeline items"
```

---

### Task 2: Drive the visual Timeline from Timeline Items

**Files:**
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: `frontend/src/renderer/src/components/useSequencePlayer.types.ts`
- Modify: `frontend/src/renderer/src/components/useSequencePlayer.ts`
- Modify: `frontend/src/renderer/src/routes/Timeline.tsx`

**Interfaces:**
- Consumes: `ReviewState.timelineItems`, `ReviewState.clips`, and `applyTimelineOperation(operation, args)`.
- Produces: item-keyed visual segments and direct operations using `item_id`.

- [ ] **Step 1: Replace the Candidate-Clip segment shape**

Use this shape in `Timeline.tsx`:

```ts
interface Segment {
  itemId: string;
  sourceClipId: string;
  fileId?: string;
  fileName: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  scale: number;
  duration: number;
  offset: number;
}
```

Read `{ projectId, timelineItems, clips, applyTimelineOperation }` from the context. Build one segment for every item in document order:

```ts
const segments = useMemo<Segment[]>(() => {
  const byId = new Map(clips.map((clip) => [clip.clip_id, clip]));
  let offset = 0;
  return timelineItems.map((item) => {
    const clip = byId.get(item.source_clip_id);
    const duration = Math.max(
      MIN_CLIP_DURATION,
      (item.end_sec - item.start_sec) / item.speed,
    );
    const segment = {
      itemId: item.item_id,
      sourceClipId: item.source_clip_id,
      fileId: clip?.file_id,
      fileName: clip?.file_name ?? item.source_clip_id,
      trimStart: item.start_sec,
      trimEnd: item.end_sec,
      speed: item.speed,
      scale: item.transform.scale,
      duration,
      offset,
    };
    offset += duration;
    return segment;
  });
}, [clips, timelineItems]);
```

Build player segments with `file_id`, bounds, and `speed`. Make `SequenceSegment.file_id` optional and only build a media URL when it is present. Pass the active segment's `scale` to `ClipPreview` using its existing prop.

- [ ] **Step 2: Convert selection, reorder, removal, and trimming to item identity**

Store `selectedId` and `dragId` as `itemId`. Key clips with `seg.itemId`, add `data-timeline-item-id={seg.itemId}`, and use item IDs in relative selection.

Replace legacy mutations with:

```ts
void applyTimelineOperation('reorder', {
  item_id: selectedId,
  to_index: targetIndex,
});

void applyTimelineOperation('remove_item', { item_id: selectedId });

void applyTimelineOperation('set_bounds', {
  item_id: seg.itemId,
  start_sec: nextStart,
  end_sec: nextEnd,
});
```

For trim dragging, calculate the next bound locally, but submit one operation on pointer release. Clamp left bounds to `0` and `end - MIN_CLIP_DURATION`; clamp right bounds only to `start + MIN_CLIP_DURATION`, leaving source-duration clamping to the Operations core. Remove the legacy `leftTrimPx` translation/margin so authoritative items remain contiguous.

- [ ] **Step 3: Correct speed-aware playhead mapping**

Convert source progress to effective Timeline time:

```ts
segment.offset + (sourceTimeSec - segment.trimStart) / segment.speed
```

Convert effective Timeline seeks back to source time:

```ts
segment.trimStart + (clamped - segment.offset) * segment.speed
```

Pass `speed` to `useSequencePlayer`; its existing `playbackRate` support must remain the single playback-speed owner.

- [ ] **Step 4: Mount detailed controls and authoritative summary**

In `Timeline.tsx` route, derive total duration directly from `timelineItems` and render:

```tsx
<span data-testid="timeline-summary">
  {timelineItems.length} item{timelineItems.length === 1 ? '' : 's'} · {totalDuration.toFixed(1)}s
</span>
```

Render `<Timeline />` followed by `<TimelineEditor />`. Update page copy to name Timeline Items, Speed, and Transform accurately.

- [ ] **Step 5: Run focused tests until green**

Run:

```bash
cd frontend
npx playwright test e2e/timeline-playback.spec.ts
npm run typecheck
npm run lint:frontend
```

Expected: all Timeline playback tests PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit the implementation**

```bash
git add frontend/src/renderer/src/components/Timeline.tsx \
  frontend/src/renderer/src/components/useSequencePlayer.ts \
  frontend/src/renderer/src/components/useSequencePlayer.types.ts \
  frontend/src/renderer/src/routes/Timeline.tsx
git commit -m "fix: render authoritative timeline items"
```

---

### Task 3: Reconcile documentation and publish the Timeline report

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/QA.md`
- Modify: `docs/plans/agent-operable-timeline.md`
- Modify: `docs/plans/README.md`
- Create: `docs/reviews/2026-08-10-authoritative-timeline-items.html`

**Interfaces:**
- Consumes: verified behavior and command output from Tasks 1–2.
- Produces: accurate user/architecture guidance and a standalone review artifact.

- [ ] **Step 1: Update affected Markdown docs**

Document these exact facts:

- Timeline page reads every `TimelineItem` from the backend document.
- repeated Candidate Clips are separate items;
- effective duration is source span divided by Speed;
- visual and detailed controls mutate by `item_id` through the Operations core;
- Transform values are editable, but full pan/crop preview remains pending visual QA;
- remove the obsolete statement that the Timeline uses accepted order and per-clip trims.

Mark this defect closed in `agent-operable-timeline.md`, retain remaining preview/chat/E2E limitations, and add Plan 020 as DONE in the plans index only after verification.

- [ ] **Step 2: Create the standalone HTML report**

Use this semantic structure and local-only style:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authoritative Timeline Items — Engineering Report</title>
  <style>
    :root{color-scheme:light dark;--bg:#0f172a;--card:#172033;--ink:#e5edf8;--muted:#9fb0c8;--ok:#65d6a6;--line:#30405a}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
    main{max-width:920px;margin:auto;padding:48px 24px}header,.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:16px}
    h1,h2{margin-top:0}h1{font-size:clamp(2rem,6vw,4rem);line-height:1}.eyebrow,.muted{color:var(--muted)}.status{color:var(--ok);font-weight:700}
    dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px}dt{color:var(--muted)}dd{margin:0}code{font-family:ui-monospace,monospace}
  </style>
</head>
<body><main><header><p class="eyebrow">Engineering report · 2026-08-10</p><h1>Authoritative Timeline Items</h1><p class="status">Verified</p></header><section class="card"><h2>Outcome</h2></section><section class="card"><h2>Evidence</h2></section><section class="card"><h2>Known limits</h2></section></main></body>
</html>
```

Fill Outcome, Evidence, commit, tests, and Known limits with observed facts only. Do not claim real-footage or NLE validation unless performed.

- [ ] **Step 3: Verify docs and full branch**

Run:

```bash
git diff --check
rg -n "acceptedOrder|accepted order|per-clip trims" docs/ARCHITECTURE.md docs/USER_GUIDE.md docs/QA.md docs/plans/agent-operable-timeline.md
cd frontend && npm run typecheck && npm run lint && npm run build
cd ../backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
cd .. && backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

Expected: no stale Timeline projection claim; all commands exit 0; backend expected baseline is at least 393 passed and 3 skipped.

- [ ] **Step 4: Commit docs and report**

```bash
git add docs/ARCHITECTURE.md docs/USER_GUIDE.md docs/QA.md \
  docs/plans/agent-operable-timeline.md docs/plans/README.md \
  docs/reviews/2026-08-10-authoritative-timeline-items.html
git commit -m "docs: report authoritative timeline fix"
```
