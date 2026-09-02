# Find More Clips From A Source Video Implementation Plan

> **CLOSED AS SUPERSEDED (2026-09-02).** Absorbed into
> [`019-clip-library-generation-and-expansion.md`](../019-clip-library-generation-and-expansion.md)
> as Phase 2, because this work depends on plan 019's `generate_clip_library`
> seam and pursuing it separately would create a second generation path.
> **This file remains the authoritative step-level specification for that
> phase** — it is filed here because it is closed as a standalone plan, not
> because it is implemented. None of the work below has been done.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `subagent-driven-development` (recommended) or `executing-plans` to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor append additional Candidate Clips from one Source Video
using its cached analysis and the existing source-duration track.

**Architecture:** Add source-scoped expansion behind the deep clip-generation
interface from plan 019. The endpoint reads cached Frame Scores for one Source
Video, ranks alternative windows, removes ranges overlapping the existing
Candidate Clip library, appends up to three stable-ID candidates, recomputes
Look Groups/stats, and preserves the Timeline Document. Review exposes the
action beside the Source Video duration track and refreshes All Clips from the
returned authoritative library.

**Tech Stack:** Python 3.12, FastAPI/Pydantic, cached JSON Frame Scores, React
19, TypeScript, Playwright.

## Global Constraints

- Depends on plan 019's `generate_clip_library(...) -> ClipLibraryResult` seam;
  execute plan 019 first and update the exact call to match its landed interface.
- “Find more” operates on one **Source Video**, not on a Candidate Clip and not
  through chat.
- Reuse cached Frame Scores and Scene boundaries. Do not invoke FFmpeg, OpenCV,
  scene detection, motion analysis, an embedding provider, or a cloud Harness.
- Existing Candidate Clips and their stable IDs remain unchanged.
- Newly appended candidates use the existing UUIDv5 `file_id:start:end` identity.
- New ranges may not overlap any existing Candidate Clip from that Source Video
  and may not overlap another range added by the same request.
- Add at most three Candidate Clips per request, ordered by Overall Score with
  deterministic duration/start-time tie-breaks.
- Preserve Candidate Clip decisions, the Timeline Document, Undo History, and
  existing Versions. Candidate-library fingerprint changes make old Versions
  visibly out of date through the existing review-context mechanism.
- Return HTTP 422 when cached analysis is unavailable and a successful result
  with `added_count: 0` when no unused qualifying range remains.
- No new runtime dependencies.

---

### Task 1: Extend the deep clip-generation module with source alternatives

**Files:**
- Modify: `backend/src/clip_generation.py` (created by plan 019)
- Modify: `backend/src/clip_assembly.py`
- Modify: `backend/tests/test_clip_generation.py` (created by plan 019)
- Modify: `backend/tests/test_clip_assembly.py`

**Interfaces:**
- Produces:
  `generate_more_for_source(source: AnalyzedSource, preferences: AssemblyPreferences, existing: list[dict], *, limit: int = 3) -> list[dict]`.
- Output contains new candidates only; the caller owns merge/persistence.

- [ ] **Step 1: Write failing tests for unused-range generation**

  Cover: candidates come only from the requested source; generated ranges do
  not overlap existing ranges or one another; result length is at most three;
  ordering and UUIDv5 IDs are deterministic; and exhausted footage returns `[]`.

- [ ] **Step 2: Run focused tests and confirm red**

  ```bash
  cd backend
  PYTHONPATH=. .venv/bin/python -m pytest tests/test_clip_generation.py tests/test_clip_assembly.py -q
  ```

  Expected: failure because `generate_more_for_source` does not exist.

- [ ] **Step 3: Expose ranked alternative windows internally**

  Reuse `candidate_runs`, `candidate_windows`, `weighted_overall`, and
  `make_clip`. Keep the current normal-generation behavior of choosing one best
  window per run. The new internal path may inspect the remaining ranked windows
  but filters overlaps before returning candidates.

- [ ] **Step 4: Implement source-scoped expansion**

  Build claimed spans from `existing` candidates matching `source.file_id`.
  Rank eligible alternative windows by Overall Score descending, duration
  descending, then start time ascending. Greedily accept non-overlapping ranges
  until `limit` is reached.

- [ ] **Step 5: Run focused tests and commit**

  Run the command from Step 2; expect all tests to pass.

  ```bash
  git add backend/src/clip_generation.py backend/src/clip_assembly.py backend/tests/test_clip_generation.py backend/tests/test_clip_assembly.py
  git commit -m "feat: generate more clips from one source"
  ```

---

### Task 2: Add an incremental source-expansion endpoint

**Files:**
- Modify: `backend/src/models.py`
- Modify: `backend/src/api.py:730-784`
- Modify: `backend/tests/test_api.py`
- Regenerate: `frontend/src/renderer/src/types/generated.ts`

**Interfaces:**
- Add request model `GenerateMoreClipsRequest(file_id: str, limit: int = 3)`
  with `limit` constrained to `1..3`.
- Add `POST /projects/{project_id}/clips/generate-more`.
- Return the standard analysis result fields plus `added_clip_ids: list[str]`
  and `added_count: int`.

- [ ] **Step 1: Write failing endpoint tests**

  Assert: unknown project/file returns 404; missing cached Frame Scores returns
  422; the generator receives only the requested source; existing candidates
  and Timeline Document remain byte-equivalent; new candidates are persisted;
  repeated calls never duplicate IDs; and no remaining range returns 200 with
  `added_count == 0`.

- [ ] **Step 2: Run focused API tests and confirm red**

  Run:
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -k generate_more -q`

  Expected: tests fail with route-not-found/model failures.

- [ ] **Step 3: Implement incremental merge and persistence**

  Adapt cached per-file Frame Scores and Scene bounds into `AnalyzedSource`, call
  `generate_more_for_source`, merge by `clip_id`, recompute ephemeral Look Groups
  and generation statistics through the plan-019 module, refresh the Timeline
  controller's candidate registry, and persist project results without rebuilding
  or replacing the Timeline Document.

- [ ] **Step 4: Regenerate frontend types and verify freshness**

  ```bash
  cd frontend
  npm run gen:types
  npm run check:types-fresh
  ```

  Expected: both commands exit 0 and generated request/response fields match the
  backend models.

- [ ] **Step 5: Run focused tests and commit**

  Run the command from Step 2; expect all tests to pass.

  ```bash
  git add backend/src/api.py backend/src/models.py backend/tests/test_api.py frontend/src/renderer/src/types/generated.ts
  git commit -m "feat: add source clip expansion endpoint"
  ```

---

### Task 3: Add “Find more from this Source Video” to All Clips

**Files:**
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/state/ReviewContext.tsx`
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Modify: `frontend/e2e/compare-versions.spec.ts`

**Interfaces:**
- API client:
  `generateMoreClips(projectId: string, fileId: string): Promise<AnalysisResult & { added_clip_ids: string[]; added_count: number }>`.
- Review context:
  `generateMoreFromSource(fileId: string): Promise<number>`.
- `ClipCard` receives `onGenerateMoreFromSource`, `generatingMore`, and the last
  source-scoped result message from `SourceClipsPanel`.

- [ ] **Step 1: Add a failing Playwright flow**

  Mock the endpoint and assert the action appears beside the Source Video track,
  sends the card's `file_id`, disables every duplicate action for that Source
  Video while pending, adds returned cards without losing Timeline badges, and
  announces either “Added N new clips from FILE” or “No more usable unused
  ranges found in FILE.”

- [ ] **Step 2: Run the focused browser test and confirm red**

  Run:
  `cd frontend && npx playwright test e2e/compare-versions.spec.ts`

  Expected: failure because the source-expansion action does not exist.

- [ ] **Step 3: Add client and Review context mutations**

  Post `{ file_id: fileId, limit: 3 }`. On success replace the local Candidate
  Clip library and generation statistics with the authoritative response, then
  refresh the Timeline Document rather than reseeding it. Track pending state by
  `file_id`, not `clip_id`, because several cards can represent one Source Video.

- [ ] **Step 4: Add the source-track action and result state**

  Render “Find more from this Source Video” directly below `SourceTrack`. Keep
  the Source Video filename in the adjacent source row. Use an `aria-live="polite"`
  status for added/empty results and preserve the existing media-preview seek
  behavior.

- [ ] **Step 5: Run frontend gates and commit**

  ```bash
  cd frontend
  npm run typecheck
  npm run lint:frontend
  npx playwright test e2e/compare-versions.spec.ts
  npm run build
  ```

  Expected: every command exits 0.

  ```bash
  git add frontend/src/renderer/src frontend/e2e/compare-versions.spec.ts
  git commit -m "feat: find more clips from a source video"
  ```

---

### Task 4: Full verification and plan reconciliation

**Files:**
- Modify: `docs/plans/017-review-page-clarity-and-polish.md`
- Modify: `docs/plans/019-deepen-clip-generation-module.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Reconcile active plans**

  Record source-scoped expansion as delivered in plan 017's discoverability
  work. Record plan 028 as a consumer of plan 019's interface rather than a
  second generation path. Preserve all unrelated remaining tasks.

- [ ] **Step 2: Run the full repository gate**

  ```bash
  cd backend
  PYTHONPATH=. .venv/bin/python -m pytest -q
  .venv/bin/ruff check src tests
  cd ../frontend
  npm run typecheck
  npm run lint:frontend
  npm run test:main
  npm run test:e2e
  npm run build
  ```

  Expected: every command exits 0.

- [ ] **Step 3: Verify no forbidden work was introduced**

  Confirm the focused endpoint test proves cached-only execution, the Timeline
  Document is unchanged, no runtime dependency changed, and `git status --short`
  contains only files named by this plan.

- [ ] **Step 4: Commit reconciliation**

  ```bash
  git add docs/plans/017-review-page-clarity-and-polish.md docs/plans/019-deepen-clip-generation-module.md docs/plans/README.md
  git commit -m "docs: reconcile source clip expansion plan"
  ```

## Done Criteria

- [ ] The action clearly targets a Source Video and appears beside its duration
  track in All Clips.
- [ ] Each request appends at most three deterministic, unused, non-overlapping
  Candidate Clips using cached analysis only.
- [ ] Existing Candidate Clips, decisions, Timeline Items, and Undo History are
  preserved.
- [ ] Chat does not invoke this endpoint and does not generate Candidate Clips.
- [ ] Existing Version staleness behavior reflects the expanded library.
- [ ] Full backend and frontend verification gates pass.
