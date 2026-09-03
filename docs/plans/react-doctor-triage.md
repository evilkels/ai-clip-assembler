# React Doctor Triage

Status: re-triaged 2026-09-02 against v0.2.0 (`6d79c1b`) with react-doctor
0.2.14. Every finding group below was read in the source before being
classified. Three real defects remain (a fourth is fixed); the large majority of
the 94 findings are false positives. Defect 4 was added 2026-09-03.

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

2. **Timeline trim handles are a keyboard dead end.** The handles are
   non-focusable `<div>`s carrying pointer/mouse handlers with no keyboard
   equivalent (`Timeline.tsx:750-755,793-798`). Clip *selection* and *reorder*
   do have keyboard paths (`Timeline.tsx:369-405`), and mouse trimming is
   tested (`timeline-playback.spec.ts:286-302`), but trimming cannot be done
   from the keyboard at all. This matters because the keyboard-only
   accessibility pass is still an open release-QA item. Rules:
   `no-static-element-interactions`. Do not "fix" this by adding a `role` to
   the existing `<div>`s — that satisfies the linter without giving keyboard
   users a trim path.

3. **Project switching can render the previous project's conversation for one
   commit.** `useReviewConversation` clears `messages`, `versionSet` and
   `error` inside an effect keyed on `projectId` (`useReviewConversation.ts:58-62`)
   rather than during render, so stale review data can paint briefly. The
   async race itself *is* correctly guarded by both the `alive` flag and the
   `activeProject` ref (`useReviewConversation.ts:67-83`) — this is stale UI,
   not a data-overwrite bug. Rule: `no-adjust-state-on-prop-change`.

4. **The rail-collapse preference is persisted from inside a state updater.**
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

1. **Tests first.** Assert that project switching clears the conversation, and
   that trim is reachable by keyboard. These must fail before any fix lands.
2. **Safe mechanical fixes** (behavior-preserving): hoist `viewOptions` to
   module scope (`SourceVideoBrowser.tsx:93-97`), and move
   `preferencesFromGenerationStats` out of the component file to restore the
   Fast Refresh boundary (`ClipGenerationPanel.tsx:29-43`).
3. ~~Fix the stale header count.~~ Done 2026-09-02.
4. **Keyboard trim.** Product decision required: focusable handles with
   arrow-key increments, or an inspector-based trim path. Needs batch 1.
5. **Project-reset refactor** in `useReviewConversation`, preserving the
   existing `alive`/`activeProject` guards.
6. **Architecture last** — whether to split `Timeline` and `Import`, and
   whether to redesign the direction/playing state machine.

Do not quote a predicted score for these batches; the earlier snapshots in
this plan's history (88 → 90 → 44 → 46) tracked codebase growth more than
code quality.

## Side effects of having installed react-doctor

A git pre-commit hook now runs doctor on every commit and prints a warning
that does not block the commit. Three npm vulnerabilities arrived with its
transitive dependencies.
