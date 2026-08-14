# Studio Workflow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Claude Design studio system to the shared desktop shell and the Import, Review, Timeline, and Export workflows without changing backend authority or product behavior.

**Architecture:** Keep `ReviewContext`, existing API contracts, and route controllers authoritative. Introduce focused presentational primitives and pure view-model helpers, then migrate one workflow at a time onto the shared tokens. The branch deliberately avoids a state-management rewrite: view modes, filtering, selection display, and layout remain renderer-local while timeline mutations and export stay backend-authoritative.

**Tech Stack:** Electron, React 19, TypeScript, Vite, CSS custom properties, Playwright.

## Status — 2026-08-14

**Overall:** In progress on `redesign/studio-workflows` (12 commits ahead of `origin/main`).

- [x] Task 1 — Shared studio system and shell (`9061a42..a8a4d7a`); reviewed clean for Critical/Important findings.
- [x] Task 2 — Import workflow (`468c0c7..0d56228`); reviewed clean for Critical/Important findings.
- [x] Task 3 — Candidate Clip browser (`cffdf6e..722d4cf`); independent re-review clean.
- [x] Task 4 — Ask AI and Suggested Versions (`76d4fec`); independent review clean.
- [x] Task 5 — Timeline redesign (`6dcd6a8..d8c45a9`); independent re-review clean.
- [ ] Task 6 — Export redesign; not started and blocked on Task 5.
- [ ] Task 7 — Integrated QA and documentation; not started and blocked on Tasks 4–6.

Current automated evidence: frontend typecheck and lint pass through Task 4; focused Review E2Es pass 7/7. The full repository gate is reserved for Task 7. Deferred UX/test notes are tracked in `.superpowers/sdd/2026-08-14-studio-workflow-redesign/progress.md`.

## Global Constraints

- Implement on the single branch `redesign/studio-workflows`.
- Design source of truth: Claude Design project `e135e2f6-0c3f-444a-84e0-d269f4b59f4a`, file `Clip Assembler Restyle.dc.html`, reviewed 2026-08-14.
- Local HTML reference: `AI CLIP ASSEMBLER Redesign APP + Landing page/Clip Assembler Restyle.dc.html`; use its workflow sections as the exact visual reference and do not stage or modify the supplied export.
- Scope is the shared design system, shell, and Import/Review/Timeline/Export workflow pages. Landing and Settings redesigns are excluded.
- Preserve the Manual Harness as the local default and existing explicit per-project consent for provider-backed analysis.
- Preserve the backend Timeline Document as the only export authority; all Timeline operations continue to address `item_id`.
- Preserve existing chat, VersionSet staleness, proposal, and `replace_timeline` behavior.
- Preserve system/light/dark theme preference and anti-FOUC behavior.
- Use the approved dark palette: `#08090b`, `#0d0f12`, `#12151a`, `#171b21`, borders `#23272e`/`#343a43`, text `#f4f5f7`/`#a2a8b2`/`#6b7280`, accent `#ff4d6d`, success `#5fd18b`, warning `#e6b450`.
- Use the approved light palette: `#e9eaec`, `#f7f7f8`, `#ffffff`, `#f1f2f4`, borders `#dcdce2`/`#bfc3c9`, text `#14161a`/`#52585f`/`#878d95`, accent `#e11d48`, success `#1f9d57`, warning `#b07d12`.
- Use Plex Sans for interface copy and Plex Mono for timecodes, scores, counts, file metadata, and compact labels, with local/system fallbacks and no runtime dependency on a web-font CDN.
- Use the shared radius scale: 6px chips, 8px rows/tiles, 10px inputs/controls, 14px cards/panels, and 999px pills.
- Status surfaces use one family: semantic wash, hairline inset outline, and restrained glow. Do not add solid left accent bars.
- Avoid eager `<video>` mounting for every Candidate Clip or Source Video.
- No dependency upgrades, backend schema changes, cloud behavior changes, analytics, animation system, or broad component-library migration.

---

### Task 1: Shared studio tokens, primitives, and shell

**Files:**
- Modify: `frontend/src/renderer/src/styles/tokens.css`
- Modify: `frontend/src/renderer/src/styles.css`
- Modify: `frontend/src/renderer/src/layouts/AppShell.tsx`
- Modify: `frontend/src/renderer/src/layouts/Sidebar.tsx`
- Modify: `frontend/src/renderer/src/layouts/ProjectHeader.tsx`
- Modify: `frontend/src/renderer/src/layouts/StatusBar.tsx`
- Create: `frontend/src/renderer/src/components/SegmentedControl.tsx`
- Create: `frontend/src/renderer/src/components/StatusSurface.tsx`
- Create: `frontend/src/renderer/src/components/ViewModeSwitcher.tsx`
- Modify: `frontend/e2e/app-shell-layout.spec.ts`
- Modify: `frontend/e2e/project-shell-regressions.spec.ts`

**Interfaces:**
- Produces: `SegmentedControl<T extends string>({ value, options, onChange, ariaLabel })`.
- Produces: `StatusSurface({ tone: 'accent' | 'success' | 'warning' | 'danger', className?, children })`.
- Produces: `ViewModeSwitcher<T extends string>` as a labeled `SegmentedControl` specialization.
- Preserves: all current Sidebar project actions, workflow routes, rename behavior, resize behavior, and Settings/Diagnostics entry points.

- [x] **Step 1: Add failing shell and theme assertions**

Extend the shell E2E suites to assert the workflow rail, active-step semantics, project selection, footer status, and both `data-theme="dark"` and `data-theme="light"` renders. Assert geometric containment rather than pixel snapshots.

- [x] **Step 2: Run the focused tests and verify failure**

Run: `npm run test:e2e -- app-shell-layout.spec.ts project-shell-regressions.spec.ts`

Expected: FAIL on the new studio-system hooks/classes or theme assertions.

- [x] **Step 3: Replace tokens and add primitives**

Update the CSS variables to the approved palettes and geometry. Implement the three primitives as controlled, accessible components; options use `{ value: T; label: string; disabled?: boolean }` and buttons expose `aria-pressed`.

- [x] **Step 4: Restyle the shared shell**

Apply the design's 34px expanded workflow rail rhythm, accent-wash active project/step treatment, compact mono metadata, quieter project header, and status rail. Keep `AppShell`'s grid ownership and resize bounds unchanged.

- [x] **Step 5: Verify shared shell behavior**

Run: `npm run typecheck && npm run test:e2e -- app-shell-layout.spec.ts project-shell-regressions.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/styles frontend/src/renderer/src/components/SegmentedControl.tsx frontend/src/renderer/src/components/StatusSurface.tsx frontend/src/renderer/src/components/ViewModeSwitcher.tsx frontend/src/renderer/src/layouts frontend/e2e/app-shell-layout.spec.ts frontend/e2e/project-shell-regressions.spec.ts
git commit -m "feat: add studio workflow design system"
```

### Task 2: Import source browser and docked analysis rail

**Files:**
- Modify: `frontend/src/renderer/src/routes/Import.tsx`
- Modify: `frontend/src/renderer/src/components/ClipGenerationPanel.tsx`
- Create: `frontend/src/renderer/src/components/SourceVideoBrowser.tsx`
- Create: `frontend/src/renderer/src/components/SourceVideoSelectionBar.tsx`
- Create: `frontend/src/renderer/src/lib/sourceVideoView.ts`
- Create: `frontend/e2e/import-workflow-redesign.spec.ts`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Produces: `SourceVideoViewMode = 'table' | 'thumbs' | 'compact'`.
- Produces: `SourceVideoFilters { query: string; analysis: 'all' | 'analyzed' | 'unanalyzed' | 'running' }`.
- Produces: `visibleSourceVideos(videos, analyzedIds, filters, sort): UploadedVideo[]` as a pure helper.
- Consumes: current `uploadedVideos`, `deselected`, `selectedIds`, `toggleOne`, `toggleAll`, `handleAnalyze`, `handleAbort`, `analysisStatus`, and `ClipGenerationPreferences` from `ImportPage`.

- [x] **Step 1: Write failing Import workflow tests**

Cover Table/Thumbs/Compact switches, filename search, analysis filter, column chooser, visible row counts, per-row selection, select/deselect all, Analyze/Abort state, and light/dark analysis surfaces.

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm run test:e2e -- import-workflow-redesign.spec.ts`

Expected: FAIL because the new controls do not exist.

- [x] **Step 3: Extract pure source-video projection and browser**

Move table rendering out of `ImportPage`. Keep selection identity keyed by source-video ID across filtered views. Thumbs use a static placeholder/poster treatment; do not mount one playing video per card and do not introduce a backend thumbnail contract.

- [x] **Step 4: Add view controls and selection bar**

Use `ViewModeSwitcher`; add Search, Analysis filter, and Columns controls. The selection bar shows the full selected count and delegates to existing analysis handlers.

- [x] **Step 5: Redesign analysis and generation controls**

Render analysis progress in an accent `StatusSurface` with phase rail, current video, elapsed/ETA, Abort, and background-run copy. Flatten `ClipGenerationPanel` into one bordered panel with a divided three-column rule list instead of nested mini-cards.

- [x] **Step 6: Verify Import and existing regressions**

Run: `npm run typecheck && npm run test:e2e -- import-workflow-redesign.spec.ts project-shell-regressions.spec.ts compare-versions.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add frontend/src/renderer/src/routes/Import.tsx frontend/src/renderer/src/components/ClipGenerationPanel.tsx frontend/src/renderer/src/components/SourceVideoBrowser.tsx frontend/src/renderer/src/components/SourceVideoSelectionBar.tsx frontend/src/renderer/src/lib/sourceVideoView.ts frontend/src/renderer/src/styles.css frontend/e2e/import-workflow-redesign.spec.ts
git commit -m "feat: redesign the import workflow"
```

### Task 3: Review selectors and multi-view Candidate Clip browser

**Files:**
- Modify: `frontend/src/renderer/src/routes/Review.tsx`
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Create: `frontend/src/renderer/src/components/ClipListRow.tsx`
- Create: `frontend/src/renderer/src/components/ClipFilmstripItem.tsx`
- Create: `frontend/src/renderer/src/lib/reviewView.ts`
- Create: `frontend/e2e/review-browser-redesign.spec.ts`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Produces: `ReviewViewMode = 'grid' | 'list' | 'filmstrip'`.
- Produces: `ReviewFilters { minOverall: number; minSmoothness: number; decision: 'all' | 'included' | 'excluded' | 'undecided' }`.
- Produces: `buildReviewClipRecords(clips, decisions, acceptedOrder, versionMembership, filters): ReviewClipRecord[]`.
- Preserves: `ClipDecision`, Include/Remove actions, `acceptedOrder`, Version membership, `SourceTrack`, `ScoreChip`, and Candidate Clip identity.

- [x] **Step 1: Add failing browser/filter tests**

Test all three view modes, Overall/Smoothness/decision filters, stable rank ordering, Timeline membership, Include/Remove actions, and no eager video mounting in list/filmstrip modes.

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm run test:e2e -- review-browser-redesign.spec.ts`

Expected: FAIL because the new modes and filters do not exist.

- [x] **Step 3: Extract pure Review view models**

Centralize rank, filter, group, decision, Timeline position, and Version membership projections in `reviewView.ts`. Do not move authoritative state out of `ReviewContext`.

- [x] **Step 4: Add the three Candidate Clip projections**

Keep `ClipCard` as the rich grid view. Implement compact list and filmstrip projections that reuse `SourceTrack`, `ScoreChip`, file/time metadata, and the same action callbacks. Use CSS custom properties for per-file accents instead of theme-dependent inline colors.

- [x] **Step 5: Add view/filter toolbar and score rails**

Use `ViewModeSwitcher`. Compose existing score/timecode primitives and keep the score thresholds centralized in `ScoreChip.tsx`.

- [x] **Step 6: Verify Review decisions and media behavior**

Run: `npm run typecheck && npm run test:e2e -- review-browser-redesign.spec.ts preview-audio.spec.ts compare-versions.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add frontend/src/renderer/src/routes/Review.tsx frontend/src/renderer/src/components/SourceClipsPanel.tsx frontend/src/renderer/src/components/ClipCard.tsx frontend/src/renderer/src/components/ClipListRow.tsx frontend/src/renderer/src/components/ClipFilmstripItem.tsx frontend/src/renderer/src/lib/reviewView.ts frontend/src/renderer/src/styles.css frontend/e2e/review-browser-redesign.spec.ts
git commit -m "feat: add multi-view clip review"
```

### Task 4: Ask AI and Suggested Versions studio layout

**Files:**
- Modify: `frontend/src/renderer/src/routes/Review.tsx`
- Modify: `frontend/src/renderer/src/components/ReviewChatPanel.tsx`
- Modify: `frontend/src/renderer/src/components/VersionGallery.tsx`
- Modify: `frontend/src/renderer/src/components/VersionCard.tsx`
- Modify: `frontend/src/renderer/src/components/VersionPlayer.tsx`
- Modify: `frontend/src/renderer/src/components/VersionScrubber.tsx`
- Modify: `frontend/e2e/compare-versions.spec.ts`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: unchanged `useReviewConversation`, `VersionSet`, `VersionDisplayState`, `replace_timeline`, `useSequencePlayer`, and stale refresh behavior.
- Produces: the approved three-zone Review layout: Ask AI rail, Suggested cuts, and Candidate Clip browser.

- [x] **Step 1: Add failing layout/state assertions**

Extend the Version E2E suite for Ask AI rail containment, Short/Medium/Long selection, stale warning surface, non-mutating playback, out-of-date Apply state, and both themes.

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm run test:e2e -- compare-versions.spec.ts`

Expected: FAIL on the new layout/state hooks.

- [x] **Step 3: Restyle Ask AI without changing its controller**

Keep optimistic messages, retry, Proposal cards, resize persistence, and conversation API calls intact. Apply the compact studio rail and mono timestamps.

- [x] **Step 4: Restyle Suggested Versions**

Use two-column cards at normal desktop widths, preserve complete-Version preview and segmented scrubbing, and show stale/out-of-date state with the approved warning family. Buttons must not shrink below their labels.

- [x] **Step 5: Verify complete Review workflow**

Run: `npm run typecheck && npm run test:e2e -- compare-versions.spec.ts review-browser-redesign.spec.ts preview-audio.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/routes/Review.tsx frontend/src/renderer/src/components/ReviewChatPanel.tsx frontend/src/renderer/src/components/VersionGallery.tsx frontend/src/renderer/src/components/VersionCard.tsx frontend/src/renderer/src/components/VersionPlayer.tsx frontend/src/renderer/src/components/VersionScrubber.tsx frontend/src/renderer/src/styles.css frontend/e2e/compare-versions.spec.ts
git commit -m "feat: restyle AI-assisted review"
```

### Task 5: Authoritative Timeline projection and studio editor

**Files:**
- Modify: `frontend/src/renderer/src/routes/Timeline.tsx`
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: `frontend/src/renderer/src/components/TimelineEditor.tsx`
- Modify: `frontend/src/renderer/src/components/TimelineItemRow.tsx`
- Create: `frontend/src/renderer/src/lib/timelineProjection.ts`
- Create: `frontend/tests/main/timelineProjection.test.ts`
- Modify: `frontend/e2e/timeline-playback.spec.ts`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Produces: `TimelineProjectionItem { itemId; sourceClipId; fileName; startSec; endSec; speed; durationSec; transform; missingSource }`.
- Produces: `projectTimelineItems(items, clips): TimelineProjectionItem[]` and `effectiveTimelineDuration(items): number`.
- Preserves: reorder, trim, split, remove, speed, transform, undo/redo, playback, keyboard transport, SSE reconciliation, repeated source clips, and `item_id` targeting.

- [x] **Step 1: Write failing projection tests**

Test repeated Candidate Clips, per-item bounds, speed-aware duration, transform passthrough, and missing-source fallback.

- [x] **Step 2: Run and verify the unit test fails**

Run: `npm run test:main -- timelineProjection.test.ts`

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement and adopt the pure projection**

Remove duplicated duration/projection calculations from Timeline and Export consumers. Keep item identity stable by `item_id`.

- [x] **Step 4: Add failing Timeline presentation assertions**

Extend `timeline-playback.spec.ts` for selected-item inspector/table, transport/ruler/playhead, repeated blocks, thumbnail fallback, and light/dark presentation.

- [x] **Step 5: Implement the studio Timeline layout**

Lift selected `item_id` to the route or a shared parent. Restyle clip blocks, ruler, transport, preview, and compact inspector/table. Use a lightweight static thumbnail/fallback treatment until a real thumbnail endpoint exists; do not add a backend contract in this branch.

- [x] **Step 6: Verify Timeline behavior**

Run: `npm run typecheck && npm run test:main && npm run test:e2e -- timeline-playback.spec.ts preview-audio.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add frontend/src/renderer/src/routes/Timeline.tsx frontend/src/renderer/src/components/Timeline.tsx frontend/src/renderer/src/components/TimelineEditor.tsx frontend/src/renderer/src/components/TimelineItemRow.tsx frontend/src/renderer/src/lib/timelineProjection.ts frontend/tests/main/timelineProjection.test.ts frontend/src/renderer/src/styles.css frontend/e2e/timeline-playback.spec.ts
git commit -m "feat: redesign the authoritative timeline"
```

### Task 6: Export format cards, receipt, and handoff actions

**Files:**
- Modify: `frontend/src/renderer/src/routes/Export.tsx`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/e2e/timeline-playback.spec.ts`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `ExportFormat`, complete `ExportResult`, and Task 5's `effectiveTimelineDuration`.
- Produces: `revealExportFile(filePath: string): Promise<void>` through a guarded preload/main IPC handler backed by `shell.showItemInFolder`.
- Preserves: overwrite confirmation, Resolve-specific Open action, export-time receipt metadata, EDL degradation warnings, and payload inspector.

- [ ] **Step 1: Add failing Export UI and IPC tests**

Cover selectable Resolve/FCPXML/EDL cards, no pre-export Timeline write, complete receipt metadata, persistent warning, Copy feedback, Resolve Open, Reveal, non-wrapping actions, and path containment/ellipsis.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm run test:e2e -- timeline-playback.spec.ts`

Expected: FAIL on cards, receipt hooks, and Reveal.

- [ ] **Step 3: Add guarded Reveal IPC**

Validate that the requested path is a non-empty absolute path before calling `shell.showItemInFolder`. Return a rejected promise on invalid input or shell failure; do not expose a generic shell command surface.

- [ ] **Step 4: Implement format cards and handoff summary**

Use a controlled selected format. Export remains an explicit action and calls the existing endpoint once. The right-hand summary lists item count, effective runtime, source-file count, repeated items, and format caveats.

- [ ] **Step 5: Implement the success receipt**

Render a success `StatusSurface` with `min-width: 0` on every grid/flex ancestor, ellipsized path, and `flex: 0 0 auto; white-space: nowrap` actions. Preserve the result's duration and warnings even if Timeline state later changes.

- [ ] **Step 6: Verify Export and main-process contracts**

Run: `npm run typecheck && npm run test:main && npm run test:e2e -- timeline-playback.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderer/src/routes/Export.tsx frontend/src/renderer/src/api/client.ts frontend/src/preload/index.ts frontend/src/main/index.ts frontend/src/renderer/src/styles.css frontend/e2e/timeline-playback.spec.ts
git commit -m "feat: redesign export handoff"
```

### Task 7: Integrated visual QA, accessibility, and documentation

**Files:**
- Modify: `frontend/src/renderer/src/routes/PlaywriterQa.tsx`
- Create: `frontend/e2e/studio-workflow-redesign.spec.ts`
- Modify: `docs/QA.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/plans/README.md`
- Create: `docs/reviews/2026-08-14-studio-workflow-redesign.html`

**Interfaces:**
- Consumes: the completed shared shell and four workflows.
- Produces: one browser-driven acceptance path and a standalone review record.

- [ ] **Step 1: Add the integrated acceptance path**

Drive Import → Review → Timeline → Export through the real renderer/backend QA route. Verify focus-visible controls, accessible names, keyboard transport, no horizontal workflow-page overflow, and both themes at 1440×900 and 1024×768.

- [ ] **Step 2: Run integrated E2E and fix only redesign regressions**

Run: `npm run test:e2e -- studio-workflow-redesign.spec.ts`

Expected: PASS after focused fixes.

- [ ] **Step 3: Update product and QA documentation**

Document the three Import views, three Review views, selected Timeline inspector, Export receipt/actions, and the unchanged local-first/backend-authoritative behavior. Add the plan to `docs/plans/README.md` with ACTIVE status until final verification passes.

- [ ] **Step 4: Write the review record**

Record scope, design source, screenshots reviewed, automated evidence, known limitations (no Settings redesign and no real thumbnail endpoint), commit identifiers, and any pending human real-footage/NLE checks.

- [ ] **Step 5: Run the full gate**

Run:

```bash
cd frontend
npm run lint
npm run typecheck
npm run test:main
npm run test:backend
npm run test:e2e
npm run build
```

Expected: all automated checks PASS. Human macOS/Electron and real-NLE checks are recorded separately and never reported as automated proof.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/renderer/src/routes/PlaywriterQa.tsx frontend/e2e/studio-workflow-redesign.spec.ts docs/QA.md docs/USER_GUIDE.md docs/ARCHITECTURE.md docs/plans/README.md docs/reviews/2026-08-14-studio-workflow-redesign.html
git commit -m "docs: verify studio workflow redesign"
```

## Agent Execution Order

1. Task 1 must land first because every workflow consumes its tokens/primitives.
2. Tasks 2 and 3 may run in parallel after Task 1 if agents coordinate edits to `styles.css`; otherwise run sequentially.
3. Task 4 follows Task 3 because both modify `Review.tsx` and Review layout CSS.
4. Task 5 follows Task 1 and produces the projection consumed by Task 6.
5. Task 6 follows Task 5.
6. Task 7 runs only after Tasks 2–6 are integrated.

Each implementation task receives a fresh Luna/high agent and a focused review before the next overlapping task starts. Agents must not broaden scope, update dependencies, or push the branch.
