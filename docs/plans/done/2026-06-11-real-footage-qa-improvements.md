# Real-Footage QA Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> or executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Status:** complete (2026-06-11)

**Goal:** Turn the June 11 real-footage QA findings into a reliable editing
workflow with persistent review decisions, truthful scoring, stronger Timeline
interaction, and a roadmap for adaptive assembly.

**Architecture:** Ship the confirmed workflow defects as one release slice,
using the existing FastAPI timeline persistence contract and React editor
components. Keep analyzer-quality changes and adaptive draft generation in
separate follow-up slices because they need labeled footage and new product
contracts rather than UI-only changes.

**Tech Stack:** FastAPI, Pydantic, Python/pytest, Electron, React 19,
TypeScript, Playwright, CSS.

---

## Scope And Sequencing

### Release Slice A — Confirmed workflow defects

- Auto-save accepted clip order and trims after Review Board or Timeline edits.
- Restore accepted clips after reopening a folder-backed project.
- Expose and display truthful local technical scores instead of hardcoded
  zeros.
- Add draggable playhead scrubbing, snapping, pointer-centered wheel zoom, and
  a persisted draggable preview/Timeline split.
- Use native macOS window controls and the actual project name.

### Release Slice B — Analysis quality and adaptive assembly

- Create a labeled real-footage fixture containing abrupt, slow intentional,
  and stable motion.
- Add an abrupt-turn metric that rejects or splits sudden rotations while
  allowing slow smooth turns.
- Analyze once, recommend Short Social, Cinematic Highlight, Long Scenic, or
  Custom, then create a chronological draft with repetition cleanup.
- Preserve manual decisions on re-analysis; replace drafts only through a
  confirmed **Regenerate Draft** action.

### Release Slice C — Editing acceleration

- Add an **Open in DaVinci Resolve** export handoff.
- Revisit speed adjustments and color-grade metadata after the core workflow
  and adaptive assembly are validated.

## Task 1: Persist Accepted Clips And Timeline Edits

**Files:**
- Modify: `frontend/src/renderer/src/state/ReviewContext.tsx`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/e2e/playwriter-preview.spec.ts`

- [x] Add an E2E regression that includes a clip, reopens the same folder
  project, and asserts the accepted clip is restored.
- [x] Run `cd frontend && npm run test:e2e -- playwriter-preview.spec.ts` and
  confirm the regression fails because no `PUT /timeline` occurs.
- [x] Add a hydration guard and debounced `updateTimeline(projectId, {
  order: acceptedOrder, trims })` effect. Empty accepted order must persist as
  an intentionally empty edited timeline.
- [x] Surface auto-save failures through the existing Review context error.
- [x] Re-run the focused E2E test and confirm it passes.

## Task 2: Display Truthful Combined And Technical Scores

**Files:**
- Modify: `backend/src/models.py`
- Modify: `backend/src/clip_assembly.py`
- Modify: `backend/tests/test_clip_assembly.py`
- Modify: `frontend/src/renderer/src/types/clip.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`

- [x] Add a failing backend test asserting assembled clips expose average
  sharpness, exposure, and contrast scores.
- [x] Extend `ClipSuggestion` and clip assembly with those averages; Pi scoring
  must preserve the fields through its existing model-copy flow.
- [x] Map those backend fields instead of hardcoding zero in the frontend.
- [x] Label `overall` as Combined and place local technical scores in an
  expandable details section.
- [x] Run focused backend tests and the frontend build.

## Task 3: Upgrade Timeline Interaction And Layout

**Files:**
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Modify: `frontend/e2e/timeline-playback.spec.ts`

- [x] Add failing E2E coverage for dragging the playhead and wheel zoom.
- [x] Implement pointer-captured playhead/ruler scrubbing.
- [x] Snap playhead and trim edits to clip boundaries by default.
- [x] Implement pointer-centered wheel zoom without changing the visible
  timeline point under the pointer.
- [x] Add a vertical resize handle between preview and editor; persist the
  preview height in versioned local storage.
- [x] Refine the Timeline layout into dense preview, transport, and track
  panels.
- [x] Run focused Timeline E2E tests and the frontend build.

## Task 4: Fix Native Window Title Presentation

**Files:**
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/layouts/AppShell.tsx`
- Delete: `frontend/src/renderer/src/layouts/TitleBar.tsx`
- Modify: `frontend/src/renderer/src/styles.css`

- [x] Use the native macOS title bar instead of `hiddenInset`.
- [x] Add a narrow IPC method that sets the BrowserWindow title.
- [x] Update the native title to `AI Clip Assembler — <project>` when a project
  opens and reset it when no project is open.
- [x] Remove the custom title-bar row and traffic-light CSS.
- [x] Run frontend typecheck and build.

## Task 5: Verify And Record The Release Slice

**Files:**
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/done/2026-06-11-real-footage-qa-improvements.md`

- [x] Run the full backend suite.
- [x] Run the frontend production build and full Playwright suite.
- [x] Run `backend/.venv/bin/python scripts/synthetic_e2e_qa.py`.
- [x] Run `git diff --check`.
- [x] Mark the QA improvement plan complete. Speed adjustments and color
  grading remain deliberately deferred because the operator classified them as
  later nice-to-have features.

## Completion Record

- Release Slice A: persistent review decisions, truthful scores, Timeline
  interaction/layout, and native title behavior shipped.
- Release Slice B: adaptive profiles, automatic chronological drafts,
  re-analysis preservation, and abrupt-turn filtering shipped.
- Release Slice C: DaVinci Resolve launch/import handoff shipped. Speed and
  color controls remain deferred by product decision.
- Verification: backend `139 passed`; frontend build passed; Playwright
  `6 passed`; synthetic end-to-end QA passed; React Doctor branch diff reported
  no issues.
