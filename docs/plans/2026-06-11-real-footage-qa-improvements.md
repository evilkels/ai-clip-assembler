# Real-Footage QA Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> or executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Status:** in progress

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

- [ ] Add an E2E regression that includes a clip, reopens the same folder
  project, and asserts the accepted clip is restored.
- [ ] Run `cd frontend && npm run test:e2e -- playwriter-preview.spec.ts` and
  confirm the regression fails because no `PUT /timeline` occurs.
- [ ] Add a hydration guard and debounced `updateTimeline(projectId, {
  order: acceptedOrder, trims })` effect. Empty accepted order must persist as
  an intentionally empty edited timeline.
- [ ] Surface auto-save failures through the existing Review context error.
- [ ] Re-run the focused E2E test and confirm it passes.

## Task 2: Display Truthful Combined And Technical Scores

**Files:**
- Modify: `backend/src/models.py`
- Modify: `backend/src/clip_assembly.py`
- Modify: `backend/tests/test_clip_assembly.py`
- Modify: `frontend/src/renderer/src/types/clip.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`

- [ ] Add a failing backend test asserting assembled clips expose average
  sharpness, exposure, and contrast scores.
- [ ] Extend `ClipSuggestion` and clip assembly with those averages; Pi scoring
  must preserve the fields through its existing model-copy flow.
- [ ] Map those backend fields instead of hardcoding zero in the frontend.
- [ ] Label `overall` as Combined and place local technical scores in an
  expandable details section.
- [ ] Run focused backend tests and the frontend build.

## Task 3: Upgrade Timeline Interaction And Layout

**Files:**
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Modify: `frontend/e2e/timeline-playback.spec.ts`

- [ ] Add failing E2E coverage for dragging the playhead and wheel zoom.
- [ ] Implement pointer-captured playhead/ruler scrubbing.
- [ ] Snap playhead and trim edits to clip boundaries by default.
- [ ] Implement pointer-centered wheel zoom without changing the visible
  timeline point under the pointer.
- [ ] Add a vertical resize handle between preview and editor; persist the
  preview height in versioned local storage.
- [ ] Refine the Timeline layout into dense preview, transport, and track
  panels.
- [ ] Run focused Timeline E2E tests and the frontend build.

## Task 4: Fix Native Window Title Presentation

**Files:**
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/layouts/AppShell.tsx`
- Delete: `frontend/src/renderer/src/layouts/TitleBar.tsx`
- Modify: `frontend/src/renderer/src/styles.css`

- [ ] Use the native macOS title bar instead of `hiddenInset`.
- [ ] Add a narrow IPC method that sets the BrowserWindow title.
- [ ] Update the native title to `AI Clip Assembler — <project>` when a project
  opens and reset it when no project is open.
- [ ] Remove the custom title-bar row and traffic-light CSS.
- [ ] Run frontend typecheck and build.

## Task 5: Verify And Record The Release Slice

**Files:**
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/2026-06-11-real-footage-qa-improvements.md`

- [ ] Run the full backend suite.
- [ ] Run the frontend production build and full Playwright suite.
- [ ] Run `backend/.venv/bin/python scripts/synthetic_e2e_qa.py`.
- [ ] Run `git diff --check`.
- [ ] Mark Release Slice A complete and leave B/C as explicit follow-up work.

