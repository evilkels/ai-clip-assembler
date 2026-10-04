# React Doctor Triage

Status: **DONE 2026-10-04.** All four defects are fixed (branch
`feat/small-plans-batch`), and so are two further project-switch races that
the closing review found in the same hook. The judgment calls below stay
architecture decisions, not open work. Originally re-triaged 2026-09-02 against
v0.2.0 (`6d79c1b`) with react-doctor 0.2.14; every finding group was read in the
source before being classified, and the large majority of the 94 findings are
false positives. Defect 4 was added 2026-09-03.

**Goal:** Fix the defects react-doctor actually found, and stop treating its
score as a quality signal for this repo.

## Read this before using the score

The tool reports **94 issues (5 errors, 89 warnings) and 46/100**. That number
is not a useful health metric here, because two of the five *errors* are wrong:

- `no-mutable-in-deps` at `ProjectHeader.tsx:32` flags `location.pathname` as a
  mutable global. `location` is React Router's `useLocation()`
  (`ProjectHeader.tsx:2,11`), which is reactive, so the dependency is correct.
  The rule pattern-matched the identifier against `window.location`.
- `deslop/unused-dev-dependency` claims `json-schema-to-typescript` is unused.
  It supplies the `json2ts` binary that `gen:types` and `check:types-fresh`
  invoke (`frontend/package.json:29-30`), and `check:types-fresh` is what
  `npm run typecheck` runs in CI. **Removing it breaks the CI typecheck gate.**

React Doctor runs only as a local pre-commit hook; it is not part of CI, so no
finding here blocks a build.

## The real defects

1. ~~**Stale "shown" count in the Review header.**~~ **FIXED 2026-09-02.**
   `SourceClipsPanel` computed the filtered records during render then reported
   the count upward from a `useEffect`, and `Review` mirrored it into state, so
   the header lagged one commit behind each filter change. Filtering now lives
   in `Review`, which builds the records once and derives both the header count
   and the browser rows from them during render. The effect, the mirrored state
   and the `onVisibleCountChange` prop are gone, and the panel no longer needs
   `decisions`, `acceptedOrder` or `versionMembership` at all.

   Worth recording honestly: this was **not** user-visible. The staleness lasted
   a single frame, and `review-browser-redesign.spec.ts:297,303` already
   asserted the header count after filtering and passed, because Playwright
   retries assertions. The value of the change is the removed state mirror and
   the narrower component interface, not a bug users were hitting.

2. ~~**Timeline trim handles are a keyboard dead end.**~~ **FIXED 2026-10-04.**
   The keyboard path already existed and is now the decided one: each timeline
   clip's focusable `Select <file>` button opens the inspector, whose `In` / `Out`
   fields set the bounds. `timeline-playback.spec.ts` "trims a clip with the
   keyboard alone" proves it with Tab, Enter and typing only. The drag handles
   stay pointer-only and are now `aria-hidden`. Original finding:
   The handles are
   non-focusable `<div>`s carrying pointer/mouse handlers with no keyboard
   equivalent (`Timeline.tsx:750-755,793-798`). Clip *selection* and *reorder*
   do have keyboard paths (`Timeline.tsx:369-405`), and mouse trimming is
   tested (`timeline-playback.spec.ts:286-302`), but trimming cannot be done
   from the keyboard at all. This matters because the keyboard-only
   accessibility pass is still an open release-QA item. Rules:
   `no-static-element-interactions`. Do not "fix" this by adding a `role` to
   the existing `<div>`s — that satisfies the linter without giving keyboard
   users a trim path.

3. ~~**Project switching can render the previous project's conversation for one
   commit.**~~ **FIXED 2026-10-04.** `useReviewConversation` now resets during
   render when `projectId` changes, and the `activeProject` guard is set in a
   `useLayoutEffect` so no late response can slip between the reset and the
   guard. `e2e/review-project-switch.spec.ts` failed 3/3 before the fix. The
   closing review also disproved the claim below that the async race was fully
   guarded: a proposal Undo resolving after a switch reconciled the old
   project's Timeline into the new one (`ReviewContext.undo` now reconciles only
   for the project that asked), and a message queued behind a pending request
   was delivered into the next project (`deliver` now drops it). Both have red
   tests in the same spec. Original finding:
   `useReviewConversation` clears `messages`, `versionSet` and
   `error` inside an effect keyed on `projectId` (`useReviewConversation.ts:58-62`)
   rather than during render, so stale review data can paint briefly. The
   async race itself *is* correctly guarded by both the `alive` flag and the
   `activeProject` ref (`useReviewConversation.ts:67-83`) — this is stale UI,
   not a data-overwrite bug. Rule: `no-adjust-state-on-prop-change`.

4. ~~**The rail-collapse preference is persisted from inside a state updater.**~~
   **FIXED 2026-10-04.** `toggleSidebar` derives `next` outside the updater and
   persists it after `setSidebarCollapsed`. Original finding:
   `AppShell.toggleSidebar` writes `localStorage` inside the
   `setSidebarCollapsed` callback (`AppShell.tsx:52-62`). Rules:
   `no-impure-state-updater` (error), `no-side-effect-in-state-updater-function`.
   Found 2026-09-03 while implementing the step gates; the code predates that
   work and was not touched by it.

   Honest severity: **low, and not currently user-visible.** React may invoke an
   updater more than once for a single dispatch, which today means the same
   value is written to `localStorage` twice — harmless. The reason to fix it is
   that a discarded concurrent render would persist a state the UI never
   adopted, and the fix is small: derive `next` outside the updater, or move the
   write to an effect keyed on `sidebarCollapsed`.

## Judgment calls, not defects

Keep these open as architecture decisions rather than lint items:

- **`no-giant-component`** — `Timeline` (761 lines) mixes playback, scrubbing,
  zoom, drag/drop, trim, rendering and keyboard handling; `Import` (818 lines)
  mixes the folder/upload flow, polling, preferences and preview. Both are real
  maintenance risk, both are large refactors, neither is a bug.
- **`no-effect-chain` / `no-chain-state-updates`** at `Timeline.tsx:282-290`:
  stopping playback sets `playing`, which drives `direction`, which settles
  `playhead`. The chain is real, but unwinding it needs an explicit
  player/Timeline completion contract first.
- **`no-reset-all-state-on-prop-change`** at `ClipGenerationPanel.tsx:65`:
  switching to a `key` would decide whether unsaved preference edits survive a
  stats refresh. That is a product question.

## Confirmed false positives

Do not act on these; they describe intentional design:

| Rule | Why it is wrong |
|---|---|
| `no-mutable-in-deps` | Router `location` is reactive (`ProjectHeader.tsx:11`) |
| `deslop/unused-dev-dependency` | `json2ts` is used by the typecheck gate (`package.json:29-30`) |
| `prefer-use-effect-event` | `paintPlayhead` is already `useCallback([])`-stable and reads refs deliberately (`Timeline.tsx:191-204`) |
| `async-defer-await` | Guards already precede the awaits (`useReviewConversation.ts:155-160`; `reviewModelAuth.ts:339-351`) |
| `async-await-in-loop` | Polling and ordered uploads are deliberately sequential (`backendLifecycle.ts:195-201`; `Import.tsx:219-231`) |
| `prefer-tag-over-role` | Several cited nodes are `group`/`separator`, not status regions (`SegmentedControl.tsx:28`; `ResizeHandle.tsx:59`) |
| `js-tosorted-immutable` | All three sites already sort a copy (`projectSort.ts:24-32`) |
| `no-render-in-render` | `renderAction()` returns callbacks; no render fn is passed as a component type (`SourceClipsPanel.tsx:116-165`) |
| `prefer-useReducer` | The grouped states are separate concerns |
| a11y group on dialogs | `ConfirmDialog` is `role="dialog"` with backdrop handling (`ConfirmDialog.tsx:43-53`); `Import` uses native `<dialog>` + `onCancel` (`Import.tsx:560-593`) |
| `control-has-associated-label` | The range input has a matching label and the number input an `aria-label` (`Review.tsx:137-155`) |

## Batches

- [x] 1. **Tests first.** The project-switch spec failed before its fix. The
      keyboard trim test passed on the old code — the inspector path already
      worked — so it is a characterization test, not a red one.
- [x] 2. **Safe mechanical fixes:** `VIEW_OPTIONS` is module-scoped in
      `SourceVideoBrowser.tsx`, and `preferencesFromGenerationStats` lives in
      `lib/clipGenerationPreferences.ts`, so `ClipGenerationPanel.tsx` exports
      only the component.
- [x] 3. ~~Fix the stale header count.~~ Done 2026-09-02.
- [x] 4. **Keyboard trim.** Inspector-based path, decided from the code: it
      already existed and was reachable, so no new trim UI was needed.
- [x] 5. **Project-reset refactor** in `useReviewConversation`, keeping the
      `alive` flag and `activeProject` guards.
- 6. **Architecture last** — whether to split `Timeline` and `Import`, and
   whether to redesign the direction/playing state machine. Not scheduled;
   these are the judgment calls above, not defects.

Do not quote a predicted score for these batches; the earlier snapshots in
this plan's history (88 → 90 → 44 → 46) tracked codebase growth more than
code quality.

## Side effects of having installed react-doctor

A git pre-commit hook now runs doctor on every commit and prints a warning
that does not block the commit. Three npm vulnerabilities arrived with its
transitive dependencies.
