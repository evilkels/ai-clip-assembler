# Literal Design Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PR #68 by making the Electron application and landing page literally conform to the approved Claude designs while preserving existing product behavior.

**Architecture:** Keep the current React contexts, route controllers, API contracts, and backend Timeline Document. Rebuild the presentation around a shared studio shell, route headers, and workflow footer; migrate one route at a time so every slice can be compared and reviewed independently. Only after the corrected Review route is accepted are new Electron screenshots captured and installed in the landing page.

**Tech Stack:** Electron, React 19, TypeScript, Vite, CSS custom properties, Playwright, static HTML/CSS, Python site-contract tests.

**Spec:** `docs/specs/2026-09-01-literal-design-conformance.md`

## Global Constraints

- The app design export and landing handoff are visual authorities.
- Preserve existing backend schemas, local-first/privacy behavior, harness consent, Timeline item identity, export authority, and route functionality.
- Do not modify or stage the gitignored Claude Design export.
- Do not upgrade dependencies or introduce a component framework.
- Do not edit the shared shell or global stylesheet concurrently from separate work lanes.
- Preserve the user's existing `frontend/package-lock.json` modification unless its ownership is resolved separately.
- Every task requires a functional test gate and a literal side-by-side visual review.

---

### Task 1: Deterministic visual contract and screenshot harness

**Files:**
- Create: `frontend/e2e/visual-conformance.spec.ts`
- Create: `frontend/e2e/visual-conformance.spec.ts-snapshots/` through Playwright's snapshot updater
- Modify: `frontend/src/renderer/src/routes/PlaywriterQa.tsx`
- Modify: `frontend/playwright.config.ts` only if snapshot settings are not already deterministic

**Interfaces:**
- Produces: deterministic QA states addressable by route and query/fixture state.
- Produces: canonical screenshots for shell, Import analyzing, Review grid/list, Timeline selection, and Export receipt.

- [x] **Step 1: Add deterministic QA fixtures for each required state**

  Expose fixed project names, media metadata, analysis progress, candidates,
  Timeline Items, export receipt, and theme through the existing Playwriter QA
  route. Keep timestamps and video frames fixed or mask them in assertions.

- [x] **Step 2: Write the visual test matrix**

  Use `expect(page).toHaveScreenshot()` at 1440x1000 and 1024x768 in light and
  dark. Add region geometry assertions for sidebar, project header, workspace,
  workflow footer, and status bar. The first run must fail against the current UI.

- [x] **Step 3: Save design-reference captures outside the baseline directory**

  Capture the corresponding `#1d`, `#1b`, `#3a`, and `#3b` export regions and
  record them in the review workspace. Do not turn current-app screenshots into
  accepted baselines.

- [x] **Step 4: Run the focused gate**

  Run: `cd frontend && npm run test:e2e -- visual-conformance.spec.ts`
  Expected: functional fixture setup passes and visual assertions fail with useful diffs.

- [x] **Step 5: Commit the harness without accepting divergent baselines**

  Commit: `test(ui): add literal design conformance harness`

### Task 2: Shared studio shell and route chrome

**Files:**
- Modify: `frontend/src/renderer/src/layouts/AppShell.tsx`
- Modify: `frontend/src/renderer/src/layouts/Sidebar.tsx`
- Modify: `frontend/src/renderer/src/layouts/ProjectHeader.tsx`
- Modify: `frontend/src/renderer/src/layouts/StatusBar.tsx`
- Create: `frontend/src/renderer/src/components/WorkflowFooter.tsx`
- Create: `frontend/src/renderer/src/components/WorkflowHeader.tsx`
- Modify: `frontend/src/renderer/src/styles/tokens.css`
- Modify: `frontend/src/renderer/src/styles.css`
- Test: `frontend/e2e/app-shell-layout.spec.ts`
- Test: `frontend/e2e/project-shell-regressions.spec.ts`
- Test: `frontend/e2e/visual-conformance.spec.ts`

**Interfaces:**
- Produces: `WorkflowHeader({ title, step, description, actions, meta })`.
- Produces: `WorkflowFooter({ summary, detail, secondaryActions, primaryAction })`.
- Preserves: all current sidebar resizing, project actions, navigation, rename, theme, settings, diagnostics, and status behavior.

- [x] **Step 1: Extend failing shell assertions** for rail collapse, counts, metadata, workflow footer placement, logo rendering, and absence of the active left bar.
- [x] **Step 2: Implement shell structure** matching the export at 1440px while retaining the current resize bounds and adding an explicit collapsed state.
- [x] **Step 3: Add shared workflow chrome** and migrate route wrappers without changing route actions.
- [x] **Step 4: Consolidate shell CSS** so later legacy rules cannot override tokens, typography, or layout; replace inline route-chrome styles.
- [x] **Step 5: Verify** with `npm run typecheck`, the two shell suites, and shell visual comparisons in both themes and sizes.
- [x] **Step 6: Commit** as `feat(ui): rebuild studio shell from design`.

### Task 3: Import workstation conformance

**Files:**
- Modify: `frontend/src/renderer/src/routes/Import.tsx`
- Modify: `frontend/src/renderer/src/components/SourceVideoBrowser.tsx`
- Modify: `frontend/src/renderer/src/components/SourceVideoSelectionBar.tsx`
- Modify: `frontend/src/renderer/src/components/ClipGenerationPanel.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Test: `frontend/e2e/import-workflow-redesign.spec.ts`
- Test: `frontend/e2e/visual-conformance.spec.ts`

**Interfaces:**
- Consumes: `WorkflowHeader` and `WorkflowFooter` from Task 2.
- Preserves: existing source filtering, sorting, view modes, columns, selection identity, analysis handlers, abort, harness, and navigation.

- [x] **Step 1: Add failing structural assertions** for source aggregates, compact toolbar, selected action rail, docked analysis/rules composition, and footer actions.
- [x] **Step 2: Recompose Import** in the prototype's order and hierarchy; move actions to their designed surfaces without duplicating handlers.
- [x] **Step 3: Remove conflicting legacy analysis rules** and inline layout declarations, including the later cascade that constrains `.analysis-progress` to the old narrow panel.
- [x] **Step 4: Verify** Import behavior at both current functional viewports and literal visual parity at canonical sizes/themes.
- [x] **Step 5: Independent visual review** against export `#1d`; fix Important or higher deviations before proceeding.
- [x] **Step 6: Commit** as `feat(ui): match import workstation design`.

### Task 4: Review workstation conformance

**Files:**
- Modify: `frontend/src/renderer/src/routes/Review.tsx`
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx`
- Modify: `frontend/src/renderer/src/components/ReviewChatPanel.tsx`
- Modify: `frontend/src/renderer/src/components/VersionGallery.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Test: `frontend/e2e/review-browser-redesign.spec.ts`
- Test: `frontend/e2e/compare-versions.spec.ts`
- Test: `frontend/e2e/visual-conformance.spec.ts`

**Interfaces:**
- Consumes: Task 2 workflow chrome.
- Preserves: Candidate Clip decisions, view/filter state, source context, chat, version generation/comparison/application, and stale-state rules.

- [x] **Step 1: Add failing assertions** that Your Clips is initially visible and that the Ask AI, versions, and clip browser regions occupy the designed workstation.
- [x] **Step 2: Remove the collapsed-by-default disclosure composition** and match the `#1b` toolbar, card/row density, score treatment, source tracks, and footer.
- [x] **Step 3: Recompose AI and version surfaces** without changing their domain behavior or asynchronous states.
- [x] **Step 4: Verify** both existing Review suites and visual comparisons for grid/list in both themes.
- [x] **Step 5: Independent visual review** against export `#1b`; fix Important or higher deviations.
- [x] **Step 6: Commit** as `feat(ui): match review workstation design`.

### Task 5: Timeline workspace conformance

**Files:**
- Modify: `frontend/src/renderer/src/routes/Timeline.tsx`
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: `frontend/src/renderer/src/components/TimelineEditor.tsx`
- Modify: `frontend/src/renderer/src/components/TimelineItemRow.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Test: `frontend/e2e/timeline-playback.spec.ts`
- Test: `frontend/e2e/studio-workflow-redesign.spec.ts`
- Test: `frontend/e2e/visual-conformance.spec.ts`

**Interfaces:**
- Consumes: Task 2 workflow chrome.
- Preserves: every mutation by `item_id`, playback, selection, trim, reorder, removal, undo/redo, speed, transform, and keyboard guards.

- [x] **Step 1: Add failing workspace assertions** for preview/timeline/inspector proportions, header actions, selection, and workflow footer.
- [x] **Step 2: Recompose the route** into the `#3a` preview-and-track workspace plus right inspector/item rail, reusing current controllers.
- [x] **Step 3: Consolidate timeline CSS** to remove nested legacy card geometry that conflicts with the edge-to-edge workspace.
- [x] **Step 4: Run all Timeline functional suites** and both visual themes/sizes.
- [x] **Step 5: Independent identity and visual reviews**; reject any change that weakens Timeline Document authority or visibly diverges from `#3a`.
- [x] **Step 6: Commit** as `feat(ui): match timeline workspace design`.

### Task 6: Export conformance and application-wide cleanup

**Files:**
- Modify: `frontend/src/renderer/src/routes/Export.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Test: `frontend/e2e/studio-workflow-redesign.spec.ts`
- Test: `frontend/e2e/visual-conformance.spec.ts`

**Interfaces:**
- Consumes: shared workflow chrome.
- Preserves: format selection, overwrite flow, payload snapshot, copy/reveal/open actions, and export authority.

- [x] **Step 1: Add failing `#3b` structural assertions** for format cards, summary, persistent warning, receipt, payload disclosure, and footer.
- [x] **Step 2: Apply conformance polish** and remove remaining app-route inline layout styles or contradictory redesign/legacy rules.
- [x] **Step 3: Run lint, typecheck, main tests, all frontend E2E, build, and the full visual matrix.** Fresh completion-gate results are recorded below.
- [x] **Step 4: Independent literal review** across shell and all four routes in both themes; resolve Important or higher findings.
- [x] **Step 5: Commit** as `feat(ui): complete studio design conformance`.

### Task 7: Corrected Electron screenshots and landing-page finish

**Files:**
- Replace: `site/img/review-dark.webp`
- Replace: `site/img/review-light.webp`
- Modify: `site/index.html` only for findings from literal reference comparison
- Modify: `scripts/tests/test_site_contract.py` only when a new stable contract assertion is required
- Create: landing visual snapshots under the selected browser test harness

**Interfaces:**
- Consumes: accepted Review implementation from Task 4 and final shell from Task 6.
- Produces: real 2x Review captures cropped consistently for the landing's macOS frame.

- [x] **Step 1: Capture deterministic Electron Review screenshots** in dark and light at 1328x1040 or larger, with no Playwriter labels or debug overlays.
- [x] **Step 2: Encode WebP assets** at visually lossless quality, preserving source dimensions and documenting the command/output sizes in the review record.
- [x] **Step 3: Compare the landing literally** with `docs/design/2026-09-01-landing-page-reference.html` at 1440px and fix only demonstrated conformance gaps.
- [x] **Step 4: Verify responsive states** at 1200, 900, 500, and 390px in both themes, including navigation, theme toggle, anchors, downloads, reduced motion, focus, and no-JS dark rendering.
- [x] **Step 5: Run** `python3 -m unittest scripts.tests.test_site_contract`, landing visual checks, frontend build, and an Electron smoke pass.
- [x] **Step 6: Independent final review** of the app, screenshots, and landing as one visual identity.
- [x] **Step 7: Commit** as `feat(site): finish landing with redesigned app captures`.

### Task 8: Completion record and PR handoff

**Files:**
- Modify: `docs/plans/2026-08-14-studio-workflow-redesign.md`
- Modify: `docs/plans/2026-09-01-landing-page-restyle.md`
- Create: `docs/reviews/2026-09-01-literal-design-conformance.md`
- Modify: PR #68 description through `gh`

- [x] **Step 1: Supersede inaccurate completion language** with the literal-conformance result and exact commit/test evidence.
- [x] **Step 2: Record side-by-side review findings**, accepted responsive adaptations, Electron smoke evidence, screenshot provenance, and any remaining human-only checks.
- [x] **Step 3: Run the complete repository verification gate** and record exact counts/output, not inherited results.
- [x] **Step 4: Review `git diff main...HEAD` and `git status`**, ensuring the design export and unrelated package-lock modification are not staged.
- [x] **Step 5: Commit documentation**, push the branch, update PR #68, and confirm checks start.

Completed by the parent agent during final handoff.
