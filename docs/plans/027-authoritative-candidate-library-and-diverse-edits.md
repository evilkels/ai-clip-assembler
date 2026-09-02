# Authoritative Candidate Library And Diverse Suggested Edits Implementation Plan

Status: TODO · Priority P1 · Category correctness + clarity · Planned 2026-08-31
Absorbed plan 016 step 4 and plan 017 items 3-4 on 2026-09-02.

**Citation warning (2026-09-02):** the UI file:line references in the task
bodies below predate the studio redesign (`6d79c1b`) and no longer locate the
current code. The All Clips panel copy now lives around
`SourceClipsPanel.tsx:219-282`. Re-derive every frontend coordinate before
executing a task; the backend citations were re-verified and still hold
(`review_agent.py:416-491,529-584` still accept repeated candidates, and no
diversity module exists).

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `subagent-driven-development` (recommended) or `executing-plans` to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make All Clips the clearly stated Candidate Clip authority and ensure
every chat-generated Version avoids overlapping or materially similar clips.

**Architecture:** Keep Candidate Clip generation separate from edit selection.
The Manual Harness and analysis pipeline own the Candidate Clip library; chat
receives that library as bounded read context and may only compose Versions from
its members. Add one pure backend diversity module used by both deterministic
Version generation and model-response validation so prompt compliance is never
the correctness boundary.

**Tech Stack:** Python 3.12, FastAPI/Pydantic backend, pytest, React 19,
TypeScript, Playwright.

## Global Constraints

- Use the domain terms **Source Video**, **Candidate Clip**, **Version**, and
  **Working Timeline** from `UBIQUITOUS_LANGUAGE.md`; never call a Candidate
  Clip alternative a “Version.”
- All Clips is the complete persisted Candidate Clip library currently known to
  the project. Chat reads this library and never adds, removes, or silently
  regenerates Candidate Clips.
- The Working Timeline remains the sole export authority under ADR 0002.
- A Version may contain only Candidate Clips present in the supplied candidate
  context.
- Within one Version, two items are similar when any deterministic rule holds:
  their source ranges overlap in the same Source Video; they have the same
  non-null Look Group; or they have the same `(file_id, scene_id)` pair.
- Preserve the first, higher-priority item and omit later similar items. Never
  reject an otherwise valid complete Version solely because one redundant item
  was removed.
- A Version with no items after validation is invalid. Existing profile,
  duration, speed, transform, fingerprint, and optimistic-concurrency behavior
  stays unchanged.
- No new runtime dependencies.

---

### Task 1: Add one pure diversity policy for Version selection

**Files:**
- Create: `backend/src/version_diversity.py`
- Create: `backend/tests/test_version_diversity.py`

**Interfaces:**
- Consumes: Candidate Clip dictionaries with `clip_id`, `file_id`, `scene_id`,
  `start_sec`, `end_sec`, and optional `look_group`.
- Produces:
  `diverse_candidates(candidates: list[dict], *, limit: int | None = None) -> list[dict]`.
  Input order is priority order; output preserves that order.

- [ ] **Step 1: Write failing tests for every similarity rule**

  Add tests with a small `candidate(...)` fixture and assert:

  ```python
  def test_diverse_candidates_removes_overlapping_ranges_from_same_source():
      selected = diverse_candidates([
          candidate("best", file_id="a", scene_id=1, start=0, end=8),
          candidate("overlap", file_id="a", scene_id=2, start=7, end=12),
          candidate("other", file_id="b", scene_id=1, start=0, end=8),
      ])
      assert [item["clip_id"] for item in selected] == ["best", "other"]

  def test_diverse_candidates_keeps_only_first_look_group_member():
      selected = diverse_candidates([
          candidate("best", file_id="a", scene_id=1, start=0, end=8, look_group=4),
          candidate("similar", file_id="b", scene_id=2, start=0, end=8, look_group=4),
      ])
      assert [item["clip_id"] for item in selected] == ["best"]

  def test_diverse_candidates_keeps_only_first_clip_from_source_scene():
      selected = diverse_candidates([
          candidate("best", file_id="a", scene_id=1, start=0, end=4),
          candidate("later", file_id="a", scene_id=1, start=8, end=12),
      ])
      assert [item["clip_id"] for item in selected] == ["best"]
  ```

- [ ] **Step 2: Run the focused tests and confirm red**

  Run:
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_version_diversity.py -q`

  Expected: collection fails because `src.version_diversity` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

  Iterate in input order. Track claimed ranges per `file_id`, claimed non-null
  Look Groups, and claimed `(file_id, scene_id)` pairs. Add a candidate only
  when none of the three rules rejects it; stop at `limit` when supplied. Treat
  missing `scene_id` and missing `look_group` as unconstrained rather than
  grouping every unknown candidate together.

- [ ] **Step 4: Run the focused tests**

  Run the command from Step 2.

  Expected: all `test_version_diversity.py` tests pass.

- [ ] **Step 5: Commit the pure policy**

  ```bash
  git add backend/src/version_diversity.py backend/tests/test_version_diversity.py
  git commit -m "feat: centralize suggested edit diversity"
  ```

---

### Task 2: Enforce diversity in model and deterministic Versions

**Files:**
- Modify: `backend/src/review_agent.py:372-394`
- Modify: `backend/src/review_agent.py:416-492`
- Modify: `backend/src/review_agent.py:529-584`
- Modify: `backend/tests/test_review_agent.py`

**Interfaces:**
- Consumes: `diverse_candidates` from Task 1.
- Produces: every `CreativeVersion.items` list satisfies the diversity policy,
  regardless of whether it came from the model or deterministic fallback.

- [ ] **Step 1: Add a failing model-Version validation test**

  Supply `_validate_versions` with one raw Version containing, in order, a
  strong candidate, an overlapping candidate from the same file, a candidate
  in the same Look Group from another file, and one distinct candidate. Assert
  that the returned Version contains only the strong and distinct IDs and that
  `total_duration_sec` and `sequence_fingerprint` are recomputed from those two.

- [ ] **Step 2: Add a failing deterministic-Version test**

  Feed `deterministic_versions` score-sorted candidates containing the same
  three forms of duplication. Assert every returned Version satisfies the
  shared diversity helper and includes the distinct candidate when its recipe
  has capacity.

- [ ] **Step 3: Run the focused tests and confirm red**

  Run:
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_review_agent.py -q`

  Expected: the new tests fail because model validation and fallback recipes
  currently accept similar candidates independently.

- [ ] **Step 4: Apply the shared policy to both producers**

  In `_validate_versions`, resolve and validate item values as today, but skip a
  later item when its Candidate Clip fails the shared diversity policy against
  already-kept candidates. In `deterministic_versions`, apply
  `diverse_candidates` before recipe slicing. Preserve priority: model item
  order for model Versions and existing score order for deterministic Versions.

- [ ] **Step 5: Strengthen the model prompt without trusting it**

  Add concise prompt language saying that one edit must not repeat overlapping
  ranges, the same Source Video scene, or the same Look Group. State that the
  Candidate Clip list is exhaustive for the current turn and chat must not
  invent ranges or claim it generated new clips.

- [ ] **Step 6: Run review-agent and profile regression tests**

  Run:

  ```bash
  cd backend
  PYTHONPATH=. .venv/bin/python -m pytest tests/test_review_agent.py tests/test_assembly_profiles.py -q
  ```

  Expected: all tests pass; existing one-Look-Group-per-draft tests remain green.

- [ ] **Step 7: Commit backend enforcement**

  ```bash
  git add backend/src/review_agent.py backend/tests/test_review_agent.py
  git commit -m "fix: keep suggested edits visually diverse"
  ```

---

### Task 3: Make authority explicit in Review UI and tests

**Files:**
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx:78-112`
- Modify: `frontend/src/renderer/src/routes/Review.tsx:210-246`
- Modify: `frontend/e2e/compare-versions.spec.ts`

**Interfaces:**
- Consumes: existing Candidate Clip count and Version membership state.
- Produces: stable user-facing copy naming All Clips as the generated library
  and chat Versions as selections from that library.

- [ ] **Step 1: Add failing Playwright copy assertions**

  Extend the existing compare-versions flow to assert the open panel exposes:

  ```text
  All generated clips
  These are the clips currently found across your Source Videos.
  Chat creates suggested edits from these clips; it does not generate hidden clips.
  ```

  Keep existing assertions that Version membership badges point back to listed
  Candidate Clips.

- [ ] **Step 2: Run the focused browser test and confirm red**

  Run:
  `cd frontend && npx playwright test e2e/compare-versions.spec.ts`

  Expected: failure because the current panel says “Browse your clips” and does
  not explain the authority relationship.

- [ ] **Step 3: Update the Review copy**

  Rename the panel heading from “Browse your clips” to “All generated clips.”
  Replace “Every usable clip found” with the exact authority copy from Step 1.
  Keep “Add to working timeline” and “Remove from working timeline”; those are
  mutations of the Timeline Document, not Candidate Clip generation.

- [ ] **Step 4: Run frontend verification**

  ```bash
  cd frontend
  npm run typecheck
  npm run lint:frontend
  npx playwright test e2e/compare-versions.spec.ts
  ```

  Expected: all commands exit 0.

- [ ] **Step 5: Commit UI clarity**

  ```bash
  git add frontend/src/renderer/src/components/SourceClipsPanel.tsx frontend/src/renderer/src/routes/Review.tsx frontend/e2e/compare-versions.spec.ts
  git commit -m "feat: clarify candidate clip authority"
  ```

---

### Task 4: Reconcile overlapping active plans and run the full gate

**Files:**
- Modify: `docs/plans/016-edit-creation-clip-selection.md`
- Modify: `docs/plans/017-review-page-clarity-and-polish.md`
- Modify: `docs/plans/README.md`

**Interfaces:**
- Consumes: completed behavior from Tasks 1-3.
- Produces: one non-contradictory active queue.

- [ ] **Step 1: Reconcile plan 016**

  Mark step 4 superseded by plan 027. Explain that chat selection is enforced
  when Versions are validated; no new swap operation is required. Preserve the
  already-completed de-overlap history.

- [ ] **Step 2: Reconcile plan 017**

  Mark the authority/onboarding portion of its remaining work delivered by plan
  027. Leave poster-first cards, smoothness-copy cleanup, included-preference
  semantics, and design-system adoption as separate remaining work.

- [ ] **Step 3: Run the full repository gate**

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

  Expected: every command exits 0 with no test failures or lint errors.

- [ ] **Step 4: Verify scope and authority mechanically**

  Run:

  ```bash
  rg -n "All generated clips|does not generate hidden clips" frontend/src frontend/e2e
  rg -n "diverse_candidates" backend/src backend/tests
  git status --short
  ```

  Expected: copy occurs in the Review panel and its test; the diversity helper
  is used by both Version paths; only files named in this plan are modified.

- [ ] **Step 5: Commit plan reconciliation**

  ```bash
  git add docs/plans/016-edit-creation-clip-selection.md docs/plans/017-review-page-clarity-and-polish.md docs/plans/README.md
  git commit -m "docs: reconcile clip selection plans"
  ```

## Done Criteria

- [ ] Chat cannot return a Version containing overlapping same-source ranges,
  repeated non-null Look Groups, or multiple Candidate Clips from one Source
  Video scene.
- [ ] Deterministic fallback Versions obey exactly the same policy.
- [ ] All Clips explicitly states that it is the generated Candidate Clip
  library and chat only selects from it.
- [ ] No Candidate Clip generation behavior or Working Timeline authority
  changes in this plan.
- [ ] Full backend and frontend verification gates pass.

## Absorbed scope

### From plan 016, step 4 — agent-influenced selection

Let the in-app review agent influence *selection*, not only trims: give it the
candidate pool plus overlap and scene metadata, add an operation to swap a
selected clip for a better non-overlapping candidate, and mirror the
deterministic invariants in the prompt guidance.

This belongs here because plan 027 already defines the diversity policy such a
swap must obey. Plan 016's steps 1-2 shipped (de-overlap at draft time, and
one-best-window per smooth run via plan 018); step 3 was superseded by 018.

**Carried constraints from 016:** overlap means any intersection on the same
`file_id`; deliberate overlap should become a knob rather than removing the
guard. Any further de-overlap work must use cached frame scores only, never
re-run ffmpeg, and must not change a `clip_id` (uuid5 of file plus range)
where the top window is unchanged — that would break decision and version
provenance (plan 009). Under-filling the duration budget (49s of a 50s target)
is preferred over emitting a 1s stub.

### From plan 017, items 3-4 — authority and onboarding

- **Included means preferred:** pass included clip IDs into review generation
  and bias both the deterministic Versions and the prompt; exclusion stays a
  hard veto.
- **Onboarding:** one dismissible, project-persisted explainer covering
  Suggested cuts, Candidate Clips and the Working Timeline, using the
  ubiquitous language from the domain model.

These moved here because both depend on All Clips being the stated Candidate
Clip authority, which is this plan's core goal. Plan 017 keeps its
presentation-only remainder (poster-first cards, one smoothness model).
