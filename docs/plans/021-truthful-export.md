# Truthful Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the current authoritative Timeline without a legacy pre-export mutation and display the backend's complete result and degradation warnings.

**Architecture:** Stack this work on Plan 020. The Export page reads `timelineItems`, derives its preview directly from them, and calls only the export endpoint. The API client exposes the complete backend response; result cards preserve metadata and warnings per format.

**Tech Stack:** React 19, TypeScript, Playwright, FastAPI export API, FCPXML, CMX3600 EDL, Resolve XML, semantic HTML, repository CSS variables.

## Global Constraints

- Depends on Plan 020 and branches from `fix/authoritative-timeline-items`.
- ADR-0002 remains authoritative: Export must not mutate the Timeline Document.
- ADR-0004 remains authoritative: EDL flattening must be explicit and visible.
- Existing-file overwrite confirmation and DaVinci-open behavior remain intact.
- No export format rewrite, render-to-video feature, dependency upgrade, or unrelated UI redesign.
- Reports must be standalone semantic HTML with inline CSS only and no network dependency.

---

### Task 1: Lock truthful Export behavior with browser tests

**Files:**
- Modify: `frontend/e2e/timeline-playback.spec.ts`

**Interfaces:**
- Consumes: Timeline operation API and `POST /projects/{project_id}/export`.
- Produces: regression coverage for non-mutating export, complete metadata, repeated items, and EDL warnings.

- [ ] **Step 1: Add a non-mutation Export test**

Reuse `replaceWithRepeatedItems`. Capture the Timeline document before export, observe requests, export, then compare the document after export:

```ts
test('export reads the authoritative Timeline without a legacy write', async ({ page }) => {
  const { projectId } = await setupTimeline(page, [fixtureA()]);
  await replaceWithRepeatedItems(page, projectId);
  const before = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  ).then((response) => response.json());
  const legacyWrites: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/projects/${projectId}/timeline`) && request.method() !== 'GET') {
      legacyWrites.push(request.method());
    }
  });
  await page.goto('/#/export');
  await page.getByRole('button', { name: 'Export EDL' }).click();
  const after = await page.request.get(
    `http://127.0.0.1:8000/projects/${projectId}/timeline/document`,
  ).then((response) => response.json());
  expect(legacyWrites).toEqual([]);
  expect(after.document).toEqual(before.document);
});
```

- [ ] **Step 2: Add result and payload assertions**

In the same test, assert:

```ts
await expect(page.getByTestId('export-result-edl')).toContainText('2 items');
await expect(page.getByTestId('export-result-edl')).toContainText('4.0s');
await expect(page.getByTestId('export-warning-edl')).toContainText(/flatten/i);
await page.getByText('Review export payload').click();
await expect(page.getByTestId('export-payload')).toContainText('item_id');
await expect(page.getByTestId('export-payload')).toContainText('speed');
await expect(page.getByTestId('export-payload')).toContainText('transform');
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
cd frontend
npx playwright test e2e/timeline-playback.spec.ts --grep "without a legacy write"
```

Expected: FAIL because Export calls `updateTimeline`, stores only `file_path`, and omits warnings.

- [ ] **Step 4: Commit the red test**

```bash
git add frontend/e2e/timeline-playback.spec.ts
git commit -m "test: cover truthful timeline export"
```

---

### Task 2: Remove the legacy write and render complete Export results

**Files:**
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/routes/Export.tsx`

**Interfaces:**
- Consumes: `ReviewState.timelineItems`, `ReviewState.clips`, and `exportTimeline(projectId, format, options)`.
- Produces: `ExportResult` with `format`, `clip_count`, `total_duration_sec`, and `warnings`.

- [ ] **Step 1: Model the complete response**

Replace `ExportResult` with:

```ts
export interface ExportResult {
  project_id: string;
  format: ExportFormat;
  status: string;
  file_path: string;
  clip_count: number;
  total_duration_sec: number;
  warnings: string[];
}
```

Keep `updateTimeline` for compatibility callers, but remove its import and use from `Export.tsx`.

- [ ] **Step 2: Derive the Export page from Timeline Items**

Read `{ clips, timelineItems, projectId, projectFolder }`. Create `clipsById` for display metadata, but use `timelineItems` for item count, empty state, summary, and payload. Derive effective duration as:

```ts
const totalDuration = timelineItems.reduce(
  (sum, item) => sum + (item.end_sec - item.start_sec) / item.speed,
  0,
);
```

Store full results:

```ts
const [exportResults, setExportResults] = useState<
  Partial<Record<ExportFormat, ExportResult>>
>({});
```

- [ ] **Step 3: Make export a read-only Timeline action**

Delete `syncWarning`, `hasCustomTrims`, and the `updateTimeline` preflight block. The handler must do only:

```ts
const result = await exportTimeline(projectId, format);
setExportResults((previous) => ({ ...previous, [format]: result }));
```

Retain the current overwrite confirmation retry using `{ overwrite: true }`.

- [ ] **Step 4: Render metadata, warnings, and authoritative payload**

Each format card gets `data-testid={`export-result-${format.id}`}` and displays `result.clip_count`, `result.total_duration_sec`, and `result.file_path`. Render warnings in one accessible block per format:

```tsx
{result.warnings.length > 0 && (
  <div role="status" data-testid={`export-warning-${format.id}`}>
    {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
  </div>
)}
```

The payload inspector gets `data-testid="export-payload"` and maps all items:

```ts
timelineItems.map((item, index) => ({
  order: index + 1,
  item_id: item.item_id,
  source_clip_id: item.source_clip_id,
  file_id: clipsById.get(item.source_clip_id)?.file_id ?? null,
  file_name: clipsById.get(item.source_clip_id)?.file_name ?? item.source_clip_id,
  start_sec: item.start_sec,
  end_sec: item.end_sec,
  speed: item.speed,
  transform: item.transform,
}))
```

- [ ] **Step 5: Run focused tests until green**

Run:

```bash
cd frontend
npx playwright test e2e/timeline-playback.spec.ts --grep "export|Export"
npm run typecheck
npm run lint:frontend
```

Expected: export tests PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit the implementation**

```bash
git add frontend/src/renderer/src/api/client.ts frontend/src/renderer/src/routes/Export.tsx
git commit -m "fix: export authoritative timeline"
```

---

### Task 3: Reconcile Export docs and publish the report

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/QA.md`
- Modify: `docs/plans/agent-operable-timeline.md`
- Modify: `docs/plans/README.md`
- Create: `docs/reviews/2026-08-10-truthful-export.html`

**Interfaces:**
- Consumes: verified result behavior from Tasks 1–2 and ADR-0004.
- Produces: accurate Export documentation and a standalone review artifact.

- [ ] **Step 1: Update affected Markdown docs**

Document these exact facts:

- Export serializes the current backend Timeline Document without first writing Timeline state;
- result cards show file, item count, effective duration, and backend warnings;
- payload review includes repeated items, bounds, Speed, and Transform;
- EDL flattens Speed/Transform and visibly warns;
- FCPXML and Resolve XML encode supported values;
- manual NLE import remains required evidence.

Add Plan 021 as DONE to the plans index only after verification. Do not mark remaining real-footage/FCP/Resolve validation complete.

- [ ] **Step 2: Create the standalone HTML report**

Reuse the local-only report structure from Plan 020 with title `Truthful Export — Engineering Report`. Include Outcome, Formats, Evidence, Known limits, commit, and exact verification results. Use warning color `#f6c177` for EDL degradation and never claim NLE import testing unless performed.

- [ ] **Step 3: Verify the stacked branch**

Run:

```bash
git diff --check
rg -n "updateTimeline|syncWarning|acceptedOrder|trims" frontend/src/renderer/src/routes/Export.tsx
cd frontend && npm run typecheck && npm run lint && npm run build
npx playwright test e2e/timeline-playback.spec.ts
cd ../backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
cd .. && backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

Expected: the Export grep returns no matches; all commands exit 0; EDL warning assertion passes.

- [ ] **Step 4: Commit docs and report**

```bash
git add docs/ARCHITECTURE.md docs/USER_GUIDE.md docs/QA.md \
  docs/plans/agent-operable-timeline.md docs/plans/README.md \
  docs/reviews/2026-08-10-truthful-export.html
git commit -m "docs: report truthful export fix"
```
