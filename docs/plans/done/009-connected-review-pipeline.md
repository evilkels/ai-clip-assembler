# Connected Review Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect agent chat, three playable Version proposals, Source Clips,
and the authoritative Working Timeline with optimistic messages, durable
provenance, conflict-safe application, and visible state relationships.

**Architecture:** The persisted Timeline Document remains the only mutable
export state. Backend-owned revisions guard prepared writes, backend-owned
fingerprints identify equal/stale content, and backend-created VersionSets
carry their generation context. A lifted Review conversation controller feeds
both chat and the Version gallery; Source Clips and the gallery derive status
from the same live Timeline snapshot.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, pytest, Electron, React 19,
TypeScript, Playwright, CSS.

## Global Constraints

- Design authority:
  `docs/specs/2026-06-21-connected-review-pipeline-design.md`.
- Work on the current feature branch. Do not push or open a PR unless asked.
- Do not stage or modify the user's pre-existing `.gitignore` or
  `frontend/package-lock.json` changes.
- Use TDD: add the focused test, run it red for the expected missing behavior,
  implement minimally, then run it green.
- All Timeline mutations remain backend-authoritative, persisted, undoable,
  and reconciled over the existing SSE path.
- Revisions are concurrency tokens only. Content/context fingerprints determine
  equality and stale state.
- The frontend must never generate or hash a runtime VersionSet.
- Version regeneration is explicit and visible; never call the model silently.
- Version scrubbers navigate only; they do not edit order, bounds, speed, or
  transforms.
- Keep the current three-Version comparison and existing dark editor-console
  visual language. Add no component, Markdown, or state-management dependency.
- Claude implementation phases run sequentially in the shared workspace. The
  orchestrator must not edit concurrently with `claude -p`.
- Only the orchestrator updates this plan, the plans index, or completion state.

---

## Status

- **Status**: DONE (2026-06-28, reconcile pass)
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (persisted schema, concurrency, agent/session and UI state)
- **Depends on**: 005, 006, 007, 008
- **Planned at**: commit `f6dedc6`, 2026-06-21

### Completion record (2026-06-28, reconcile pass)

All five implementation tasks landed on `main` (commits `2ed448c`
revision-safe state identity, `a1caad8` version provenance, `173bbbc`/`c093a6f`
version playback scrubbers, `279778d` optimistic chat, `7d1900e`/`9db763e`
connected pipeline state, `95b2262` scrubber/playhead alignment). Verified green
at `f469e43`: **319 backend tests** (`pytest --ignore=tests/test_codex_cli_harness.py`),
**ruff** (`ruff check src tests`), **frontend typecheck**, **frontend build**,
and **`e2e/compare-versions.spec.ts`** (1 passed).

**Not re-run in this reconcile pass** (Task 6 steps 1–4 ceremony): the full
3-spec Playwright suite (only the 009 spec was run), `synthetic_e2e_qa.py`, the
`react-doctor` diff gate, and the optional independent Claude whole-branch
review. The implementation is merged and the core gates pass; run those four if
a formal Task 6 sign-off is wanted, but they are not blocking — closing the plan.

## Collaboration Protocol

The primary coding agent is the **orchestrator** and retains responsibility for
scope, integration, plan state, review, and final verification. Claude is an
implementation worker for the phases explicitly marked **CLAUDE**.

Before Task 1, the orchestrator must:

- [x] Confirm only the two known user changes are dirty, then create the ledger:

```bash
mkdir -p "$(git rev-parse --git-path sdd)"
printf 'Implementation base: %s\n' "$(git rev-parse HEAD)" > "$(git rev-parse --git-path sdd)/progress.md"
```

- [x] Change this plan and its README row to `IN PROGRESS`; commit only those
      docs with `docs(plans): start connected review pipeline`.

Exact Claude commands appear in Tasks 1 and 3. Each command constrains Claude
to one task and one commit.

After every worker task, the orchestrator must perform this review gate before
marking it complete:

1. Inspect `git show --stat --oneline HEAD` and
   `git diff "$(git rev-parse HEAD^)"..HEAD`. A Claude task returning multiple
   commits violates its task contract; stop and review the full returned range.
2. Reject out-of-scope files or unrequested abstractions.
3. Run the task's focused verification independently.
4. Confirm both spec compliance and code quality; fix Critical/Important issues
   and re-run the gate.
5. Check the task boxes, append an exact base/head completion line to the SDD
   ledger, and commit the plan-state update separately.

Do not run two implementation workers in parallel: Tasks 1–5 build shared
contracts even when their primary files differ.

## File Map

**Backend contracts and authority**

- Create `backend/src/review_state.py`: canonical normalization and SHA-256
  fingerprints.
- Modify `backend/src/models.py`: revision, Proposal provenance, Review message
  correlation, VersionSet.
- Modify `backend/src/timeline_ops.py`: monotonic revisions, expected-revision
  checks, atomic operation batches.
- Modify `backend/src/review_agent.py`: idempotent turns, snapshot-based
  Proposals, backend-owned VersionSets and deterministic fallback.
- Modify `backend/src/api.py`: new request fields, conflict responses, enriched
  Timeline snapshots.
- Modify `backend/src/project_store.py`: backward-compatible Review Session and
  Timeline Document loading.

**Frontend orchestration and presentation**

- Create `frontend/src/renderer/src/hooks/useReviewConversation.ts`: one Review
  conversation/VersionSet controller.
- Create `frontend/src/renderer/src/components/VersionScrubber.tsx`: segmented
  playback navigation.
- Create `frontend/src/renderer/src/components/VersionApplyDialog.tsx`: current
  vs proposed replacement summary.
- Create `frontend/src/renderer/src/state/versionState.ts`: pure membership and
  display-state derivation using server fingerprints.
- Modify `frontend/src/renderer/src/api/client.ts`: typed snapshots, VersionSet,
  idempotent message and conflict APIs.
- Modify `frontend/src/renderer/src/state/ReviewContext.tsx`: expose the current
  revision/fingerprints and reconcile enriched snapshots.
- Modify Review chat, Version, Source Clip, and Review route components only as
  described in Tasks 3–5.

## Task 1: Timeline identity and atomic concurrency (**CLAUDE**)

**Files:**

- Create: `backend/src/review_state.py`
- Modify: `backend/src/models.py`
- Modify: `backend/src/timeline_ops.py`
- Modify: `backend/src/project_store.py`
- Test: `backend/tests/test_timeline_ops.py`
- Test: `backend/tests/test_project_store.py`

**Interfaces:**

- Produces:

```python
class TimelineRevisionConflict(TimelineOpError):
    expected_revision: int
    current_revision: int

def sequence_fingerprint(items: Iterable[object]) -> str:
    """Return the canonical SHA-256 sequence digest."""
    raise NotImplementedError

def review_context_fingerprint(
    document: TimelineDocument,
    candidates: Sequence[Mapping[str, object]],
) -> str:
    """Hash the exact bounded agent inputs plus Timeline review state."""
    raise NotImplementedError

async def TimelineController.apply(
    operation: str,
    *,
    expected_revision: int | None = None,
    **args: object,
) -> TimelineDocument:
    raise NotImplementedError

async def TimelineController.apply_batch(
    operations: Sequence[Mapping[str, object]],
    *,
    expected_revision: int,
) -> TimelineDocument:
    raise NotImplementedError
```

- Canonical sequence fields, in order: `source_clip_id`, `start_sec`,
  `end_sec`, `speed`, `transform.scale`, `transform.x`, `transform.y`.
- Round sequence floats to six decimals and candidate scores to four. Serialize
  canonical JSON with `sort_keys=True`, `separators=(",", ":")`.
- `item_id` never contributes to a sequence fingerprint.

- [x] **Worker invocation:** From the repository root, run exactly:

```bash
claude -p "Implement Task 1, Timeline identity and atomic concurrency, from docs/plans/009-connected-review-pipeline.md. Read AGENTS.md, CONTEXT.md, docs/specs/2026-06-21-connected-review-pipeline-design.md, Global Constraints, and all of Task 1 first. Work only in Task 1's file list. Use strict TDD and run the named red and green commands. Do not update docs/plans, touch .gitignore or frontend/package-lock.json, push, or begin another task. Produce exactly one scoped commit named feat(timeline): add revision-safe state identity. Return status, design summary, files changed, commit SHA, exact tests/results, and concerns."
```

- [x] **Step 1: Write the red fingerprint and revision tests.** Add focused
      tests proving different item IDs hash equally, order/bounds/speed/
      transform hash differently, Candidate context changes alter the context
      hash, `TimelineDocument().revision == 0`, and legacy JSON loads with zero.

```python
def test_sequence_fingerprint_ignores_live_item_ids():
    left = TimelineItem(item_id="left", source_clip_id="clip-a", start_sec=1, end_sec=3)
    right = left.model_copy(update={"item_id": "right"})
    assert sequence_fingerprint([left]) == sequence_fingerprint([right])
```

- [x] **Step 2: Run the tests red.**

Run:
`cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_timeline_ops.py tests/test_project_store.py -q`

Expected: FAIL because fingerprint helpers/revision do not exist.

- [x] **Step 3: Implement canonical fingerprints and persisted revision.** Keep
      hashing pure and independent from FastAPI. Load absent revision as zero;
      do not rewrite project files merely by reading them.

- [x] **Step 4: Write red controller tests** for monotonic apply/undo/redo,
      stale `expected_revision` with zero mutation, and a two-operation batch
      producing one revision, notification, and undo snapshot.

```python
with pytest.raises(TimelineRevisionConflict):
    await controller.apply("include", clip_id="clip-a", expected_revision=0)
assert controller.document == before
```

- [x] **Step 5: Implement one locked commit path.** `apply`, `apply_batch`,
      `undo`, and `redo` must assign `revision = previous_live_revision + 1`
      immediately before the single notify. Undo restores prior content but not
      the old revision number.

- [x] **Step 6: Run focused tests green**, then run:
      `cd backend && .venv/bin/ruff check src tests`.

- [x] **Step 7: Commit** with
      `feat(timeline): add revision-safe state identity`.

## Task 2: Review provenance, VersionSets, and idempotent turns (**ORCHESTRATOR**)

**Files:**

- Modify: `backend/src/models.py`
- Modify: `backend/src/review_agent.py`
- Modify: `backend/src/api.py`
- Modify: `backend/src/project_store.py`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/types/version.ts`
- Test: `backend/tests/test_review_agent.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**

```python
class VersionSet(BaseModel):
    version_set_id: str
    versions: List[CreativeVersion]
    created_at: str
    based_on_timeline_revision: int
    based_on_sequence_fingerprint: str
    based_on_review_context_fingerprint: str
```

Add `reply_to_message_id: Optional[str] = None` to the existing
`ReviewMessage`, and `based_on_timeline_revision: int` to the existing
`Proposal`; preserve their other fields and defaults.

TypeScript mirrors `VersionSet`; `Version.sequence_fingerprint` is required.
`ReviewTurnRequest.client_message_id` is a UUID string. Introduce this type now:

```ts
interface TimelineSnapshot {
  document: TimelineDocument;
  sequence_fingerprint: string;
  review_context_fingerprint: string;
}
```

Existing frontend Timeline API functions may continue returning the nested
`document` during this task so current consumers compile. Task 5 migrates the
client and `ReviewContext` together to consume the complete snapshot.

- [x] **Step 1: Add red model/agent tests** for Version fingerprints and
      VersionSet provenance, Proposal baseline revision, captured Timeline
      snapshot, deterministic Manual/model-failure fallback, and existing bare
      `payload.versions` migration.

- [x] **Step 2: Add red API tests** for enriched Timeline snapshots, HTTP 409
      conflict detail (`expected_revision`, `current_revision`, current
      snapshot), atomic Proposal acceptance, and message idempotency:

```python
first = client.post(url, json={"message": "Faster", "client_message_id": message_id})
second = client.post(url, json={"message": "Faster", "client_message_id": message_id})
assert first.json()["agent_message"]["message_id"] == second.json()["agent_message"]["message_id"]
assert [m["message_id"] for m in second.json()["session"]["messages"]].count(message_id) == 1
```

- [x] **Step 3: Run tests red.**

Run:
`cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_review_agent.py tests/test_api.py -q`

Expected: FAIL on missing request/model fields and conflict behavior.

- [x] **Step 4: Implement Review Session v2 compatibility.** Persist
      client-generated editor IDs and agent `reply_to_message_id`. On retry,
      return the correlated completed response or resume an incomplete turn;
      never append the editor message twice.

- [x] **Step 5: Implement backend-owned VersionSet production.** The exact
      bounded candidates placed in the model/fallback context feed
      `review_context_fingerprint`. Port the deterministic fallback behavior
      from `mockVersions.ts` into a typed backend factory; Manual Harness and
      model-unavailable turns use it without any model call. Keep the frontend
      fallback temporarily so Task 3 can land independently; Task 4 removes it
      when the shared conversation controller consumes VersionSets.

- [x] **Step 6: Make Proposals snapshot-safe.** Deep-copy the Timeline Document
      before model invocation, simulate against that copy, persist its revision,
      and accept via `apply_batch(operations, expected_revision=baseline_revision)`.

- [x] **Step 7: Return `TimelineSnapshot` consistently** from get/apply/undo/
      redo/Proposal-accept endpoints. Map `TimelineRevisionConflict` to HTTP 409
      before the generic 422 handler.

- [x] **Step 8: Update frontend wire types only.** Do not begin UI behavior in
      this task.

- [x] **Step 9: Run focused backend tests, full backend lint, and frontend
      typecheck.**

Run:

```bash
(cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_review_agent.py tests/test_api.py tests/test_timeline_ops.py -q)
(cd backend && .venv/bin/ruff check src tests)
(cd frontend && npm run typecheck)
```

- [x] **Step 10: Commit** with
      `feat(review): persist version provenance`.

## Task 3: Segmented Version playback timeline (**CLAUDE**)

**Files:**

- Create: `frontend/src/renderer/src/components/VersionScrubber.tsx`
- Modify: `frontend/src/renderer/src/components/useSequencePlayer.types.ts`
- Modify: `frontend/src/renderer/src/components/useSequencePlayer.ts`
- Modify: `frontend/src/renderer/src/components/VersionPlayer.tsx`
- Modify: `frontend/src/renderer/src/components/VersionCard.tsx`
- Modify: `frontend/src/renderer/src/components/VersionGallery.tsx`
- Modify: `frontend/src/renderer/src/styles.css` (Version-player classes only)
- Test: `frontend/e2e/compare-versions.spec.ts`

**Interfaces:**

```ts
interface UseSequencePlayerResult {
  // existing fields remain
  currentSourceTimeSec: number;
  currentTimelineTimeSec: number;
  totalDurationSec: number;
  seekToTimelineTime: (timelineTimeSec: number) => void;
}

interface VersionScrubberProps {
  items: VersionItem[];
  currentTimelineTimeSec: number;
  totalDurationSec: number;
  currentIndex: number;
  onSeek: (timelineTimeSec: number) => void;
}
```

- [x] **Worker invocation:** From the repository root, run exactly:

```bash
claude -p "Implement Task 3, Segmented Version playback timeline, from docs/plans/009-connected-review-pipeline.md. Read AGENTS.md, CONTEXT.md, docs/specs/2026-06-21-connected-review-pipeline-design.md, Global Constraints, and all of Task 3 first. Work only in Task 3's file list. Use strict TDD and run the named red and green commands. Do not update docs/plans, touch .gitignore or frontend/package-lock.json, push, or begin another task. Produce exactly one scoped commit named feat(review): add version playback scrubbers. Return status, design summary, files changed, commit SHA, exact tests/results, and concerns."
```

- [x] **Step 1: Extend Playwright fixtures and write red assertions** for one
      segment per Version item, effective-duration-proportional widths,
      `current / total`, current filename/source time, click-to-seek, keyboard
      Left/Right seek, and exclusive playback.

- [x] **Step 2: Run the focused E2E red.**

Run: `cd frontend && npm run test:e2e -- compare-versions.spec.ts`

Expected: FAIL because no Version scrubber exists.

- [x] **Step 3: Centralize timeline-time math in `useSequencePlayer`.** Convert
      timeline time to item index/source time using effective durations. Clamp
      seeks to `[0, totalDurationSec]`; never mutate Version items.

- [x] **Step 4: Implement accessible segmented navigation.** Use a labelled
      range-like control with clickable segment buttons, visible playhead,
      `MM:SS.s` time, `clip N of M`, filename, and source time. Segment width is
      `(end_sec - start_sec) / speed / totalDurationSec * 100%`.

- [x] **Step 5: Coordinate one active player in `VersionGallery`.** Starting a
      Version stops the previously active player. Expanding/collapsing a card
      must not reset its current position.

- [x] **Step 6: Add reduced-motion CSS** and keep all new selectors scoped
      under `.version-player` / `.version-scrubber`.

- [x] **Step 7: Run focused E2E, typecheck, lint, and React Doctor.**

```bash
(cd frontend && npm run test:e2e -- compare-versions.spec.ts)
(cd frontend && npm run typecheck)
(cd frontend && npm run lint:frontend)
(cd frontend && ./node_modules/.bin/react-doctor . --diff HEAD --no-score --fail-on warning)
```

- [x] **Step 8: Commit** with
      `feat(review): add version playback scrubbers`.

## Task 4: Optimistic conversation controller (**ORCHESTRATOR**)

**Files:**

- Create: `frontend/src/renderer/src/hooks/useReviewConversation.ts`
- Modify: `frontend/src/renderer/src/components/ReviewChatPanel.tsx`
- Modify: `frontend/src/renderer/src/routes/Review.tsx`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/state/mockVersions.ts` (remove runtime use;
  retain fixture helpers only if a test imports them)
- Modify: `frontend/src/renderer/src/styles.css` (chat status classes only)
- Test: `frontend/e2e/compare-versions.spec.ts`

**Interfaces:**

```ts
type DeliveryState = 'sending' | 'persisted' | 'failed';
type ReviewMessageView = ReviewMessage & { deliveryState: DeliveryState };

interface ReviewConversation {
  messages: ReviewMessageView[];
  versionSet: VersionSet | null;
  busy: boolean;
  error: string | null;
  send: (text: string, existingMessageId?: string) => Promise<void>;
  resolveProposal: (proposalId: string, accept: boolean) => Promise<void>;
}
```

- [x] **Step 1: Write the red delayed-response E2E.** Immediately after Send,
      assert the submitted editor bubble and `Sending` are visible while the
      stubbed response is unresolved. Add a failed response case asserting
      retained text and `Retry`, then retry with the same ID and assert one
      persisted editor message.

- [x] **Step 2: Run focused E2E red.** It must fail because the editor bubble
      still waits for the response.

- [x] **Step 3: Extract `useReviewConversation`.** It owns hydration, kickoff,
      optimistic messages, idempotent retry, Proposal resolution, and latest
      VersionSet selection. `ReviewChatPanel` becomes presentation plus input;
      `ReviewPage` consumes the same controller for Versions.

- [x] **Step 4: Remove the runtime frontend Version producer.** Manual and
      model-failure VersionSets now arrive from the backend. No Review render
      may call `proposeVersions`.

- [x] **Step 5: Reconcile by exact message ID.** Never match by text or arrival
      position. A failed message stays in transcript; Retry reuses its UUID.
      Historical messages do not announce on hydration.

- [x] **Step 6: Run focused E2E, typecheck, lint, and build.**

```bash
(cd frontend && npm run test:e2e -- compare-versions.spec.ts)
(cd frontend && npm run typecheck)
(cd frontend && npm run lint:frontend)
(cd frontend && npm run build)
```

- [x] **Step 7: Commit** with
      `fix(review-chat): show outgoing messages immediately`.

## Task 5: Connect VersionSet, Source Clips, and Working Timeline (**ORCHESTRATOR**)

**Files:**

- Create: `frontend/src/renderer/src/state/versionState.ts`
- Create: `frontend/src/renderer/src/components/VersionApplyDialog.tsx`
- Modify: `frontend/src/renderer/src/state/ReviewContext.tsx`
- Modify: `frontend/src/renderer/src/routes/Review.tsx`
- Modify: `frontend/src/renderer/src/components/VersionGallery.tsx`
- Modify: `frontend/src/renderer/src/components/VersionCard.tsx`
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Modify: `frontend/src/renderer/src/components/WorkingTimelineStrip.tsx`
- Modify: `frontend/src/renderer/src/styles.css` (Review connection classes)
- Test: `frontend/e2e/compare-versions.spec.ts`

**Interfaces:**

```ts
type VersionDisplayState = 'applied' | 'current' | 'stale' | 'unavailable';

function deriveVersionState(args: {
  version: Version;
  versionSet: VersionSet;
  snapshot: TimelineSnapshot;
  availableClipIds: Set<string>;
}): VersionDisplayState;

function buildVersionMembership(versionSet: VersionSet | null): Map<string, string[]>;
```

`ReviewContext` exposes the current `TimelineSnapshot`, not independent revision
and hash states that can tear during rendering.

- [x] **Step 1: Write red E2E assertions** for:
      Source Clip `Timeline #N`; current-only `Proposed in A/C`; manual Include
      updating Working Timeline; stale banner retaining playable Versions;
      visible Refresh editor turn; applied/unavailable Version states; and
      numbered Direct/Compare/Inspect/Commit cues.

- [x] **Step 2: Add a red adoption-conflict E2E.** Open Apply, mutate the stubbed
      current snapshot before submission, return HTTP 409, and assert no success
      state or lost Version.

- [x] **Step 3: Implement pure Version state derivation.** Use only server
      fingerprints. Hide proposed-membership badges for stale sets. Missing
      Candidate Clip IDs make Apply unavailable and list their filenames/IDs.

- [x] **Step 4: Reconcile enriched Timeline snapshots atomically** in
      `ReviewContext`; retain existing optimistic Include/Exclude behavior but
      replace it with the returned/SSE snapshot as authority.

- [x] **Step 5: Add the stale banner and explicit refresh.** Refresh calls
      `conversation.send("Refresh the three versions using my current Working Timeline and Source Clip decisions.")`.
      Old Versions remain visible until a successful VersionSet arrives.

- [x] **Step 6: Implement `VersionApplyDialog`.** Compare against the current
      snapshot: item count/effective duration, added/removed sources, and order/
      bounds/speed/transform changes. Submit `replace_timeline` with the current
      revision captured when the dialog opened. On 409, reconcile and require a
      new review; never force apply.

- [x] **Step 7: Add relationship copy and target-specific actions.** Use
      `Add to working timeline`, `Remove from working timeline`, and
      `Apply to working timeline`. Label the bottom strip
      `Working Timeline · authoritative · sent to export`.

- [x] **Step 8: Run focused E2E, frontend gates, and React Doctor.**

```bash
(cd frontend && npm run test:e2e -- compare-versions.spec.ts)
(cd frontend && npm run typecheck)
(cd frontend && npm run lint:frontend)
(cd frontend && npm run build)
(cd frontend && ./node_modules/.bin/react-doctor . --diff HEAD --no-score --fail-on warning)
```

- [x] **Step 9: Commit** with
      `feat(review): connect review pipeline state`.

## Task 6: Whole-flow verification and independent review (**ORCHESTRATOR + CLAUDE REVIEW**)

**Files:**

- Modify only files required to resolve verified final-review findings.
- Modify: `docs/plans/009-connected-review-pipeline.md`
- Modify: `docs/plans/README.md`
- Move on completion:
  `docs/plans/009-connected-review-pipeline.md` →
  `docs/plans/done/009-connected-review-pipeline.md`

- [ ] **Step 1: Run all release gates from a clean implementation diff.**

```bash
(cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py)
(cd backend && .venv/bin/ruff check src tests)
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
(cd frontend && npm run typecheck)
(cd frontend && npm run lint:frontend)
(cd frontend && npm run build)
(cd frontend && npm run test:e2e)
START_COMMIT="$(git log --format=%H --grep='^docs(plans): start connected review pipeline$' -1)"
(cd frontend && ./node_modules/.bin/react-doctor . --diff "$START_COMMIT" --no-score --fail-on warning)
```

Expected: every command exits zero. Record exact counts in the completion
record.

- [ ] **Step 2: Ask Claude for an independent read-only whole-branch review.**

```bash
START_COMMIT="$(git log --format=%H --grep='^docs(plans): start connected review pipeline$' -1)"
claude -p "Review the implementation of docs/plans/009-connected-review-pipeline.md against docs/specs/2026-06-21-connected-review-pipeline-design.md. Read AGENTS.md and inspect git diff ${START_COMMIT}..HEAD. Do not edit files. Findings first, ordered Critical/Important/Minor, with file:line evidence. Focus on concurrency, persistence migration, idempotency, fingerprint correctness, lost manual edits, stale Version behavior, accessibility, and missing tests. Explicitly state if no findings."
```

- [ ] **Step 3: Orchestrator adjudicates every finding.** Reproduce confirmed
      bugs with a red focused test, fix them, rerun the covering gate, and
      commit `fix(review): address pipeline review findings`. Record rejected
      findings with one-line rationale in this plan's completion record.

- [ ] **Step 4: Re-run the full release gates** after review fixes. Do not rely
      on pre-review results.

- [ ] **Step 5: Update plan state.** Check every done criterion, add a completion
      record with commits/test counts/Claude review disposition, mark the README
      row DONE, and move this plan into `docs/plans/done/`.

- [ ] **Step 6: Commit plan completion** with
      `docs(plans): complete connected review pipeline`.

## Done Criteria

- [ ] Submitted editor messages appear immediately and retry idempotently.
- [ ] Timeline revisions are monotonic and prepared writes reject stale bases.
- [ ] Fingerprints, not revisions, determine Version equality/staleness.
- [ ] Manual/model-failure and Pi paths all return backend-owned VersionSets.
- [ ] Every Version has a seekable segmented playback timeline and exclusive
      playback.
- [ ] Source Clips visibly connect to current Versions and Working Timeline.
- [ ] Manual, accepted-agent, and MCP edits reconcile through one snapshot.
- [ ] Version Apply compares against current state, is revision-guarded, atomic,
      and undoable.
- [ ] Missing Candidate Clips block Apply with a useful explanation.
- [ ] Backend suite, synthetic E2E, frontend type/build/lint, full Playwright,
      and React Doctor pass.
- [ ] Independent Claude review has no unresolved Critical/Important findings.
- [ ] Plan and index are archived/updated; unrelated dirty files remain
      untouched.

## STOP Conditions

- Persisted Timeline or Review Session migration cannot be made backward
  compatible without discarding user data.
- Fingerprint inputs cannot be tied to the exact bounded agent context.
- A Claude phase edits outside its file scope or stages the known user changes;
  stop and restore only the worker's changes, never the user's files.
- Optimistic idempotency requires a database or distributed queue; report the
  concrete failure instead of adding infrastructure.
- Version playback requires rendered proxy files; retain client-side sequence
  playback and report the blocker.
- Any focused test fails twice after a reasonable implementation fix.

## Maintenance Notes

- Any future Timeline Item field affecting playback must be added to canonical
  sequence normalization and fingerprint tests in the same change.
- Any change to bounded agent context must update context fingerprint coverage.
- Review Session schema changes require fixture coverage for the immediately
  previous version.
- Version history/branching, automatic regeneration, and scrubber editing remain
  separate product decisions, not incremental additions to this plan.
