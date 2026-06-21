# Plan 008: Present review chat as an accessible conversation

> **Executor instructions**: Execute after plan 006. Follow all steps and gates;
> stop rather than expanding scope. Update `docs/plans/README.md` when done unless
> a reviewer owns the index.
>
> **Drift check (run first)**:
> `git diff --stat 6744eaa..HEAD -- frontend/src/renderer/src/components/ReviewChatPanel.tsx frontend/src/renderer/src/styles.css frontend/e2e/compare-versions.spec.ts`
> Plan 006 is expected to change the component. Reconcile against its persisted
> message model before editing.

## Status

- **Status**: DONE (2026-06-21)
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 006
- **Category**: UX / accessibility
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

The current chat renders each message as a bare paragraph. CSS only changes
alignment and opacity, so user and agent turns read like unstructured text.
Persisted roles, IDs, and timestamps from plan 006 provide enough semantics to
build clear bubbles, attach Proposal cards to the correct turn, auto-scroll,
and announce new messages accessibly.

## Current state

- `ReviewChatPanel.tsx:98-107` renders `<div><p>{text}</p>...</div>` and a plain
  `Thinking...` paragraph.
- `styles.css:1658-1661` only applies paragraph margin, alignment, opacity, and
  italic busy text. There is no max width, padding, background, border, role
  label, timestamp, or message grouping.
- `styles.css` already defines reusable color tokens such as `--surface`,
  `--border`, muted text, primary button styles, and rounded card surfaces.
  Reuse them rather than introducing a second palette.
- There is no frontend unit-test runner. Use typecheck/build/lint and extend the
  existing Playwright Review test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Build | `cd frontend && npm run build` | exit 0 |
| Lint | `cd frontend && npm run lint:frontend` | exit 0 |
| Focused E2E | `cd frontend && npm run test:e2e -- compare-versions.spec.ts` | passes |

## Scope

**In scope**:

- `frontend/src/renderer/src/components/ReviewChatPanel.tsx`
- `frontend/src/renderer/src/styles.css`
- `frontend/e2e/compare-versions.spec.ts`
- `docs/plans/README.md` status only

**Out of scope**:

- Backend/session behavior (plan 006).
- Creative response content or Version generation (plan 007).
- Token streaming.
- A new component library, icon library, or Markdown dependency.
- Redesigning the three-zone Review shell or Version cards.

## Git workflow

- Branch: `feat/review-chat-bubbles`
- Conventional commit example: `feat(review-chat): style conversation bubbles`.
- Do not push/open a PR unless instructed.

## Steps

### Step 1: Add semantic message markup

Render each persisted message as an `<article>` with:

- stable `data-message-id`
- role-specific class and accessible label
- visible compact role label (`Review agent` or `You`)
- message text preserving line breaks without `dangerouslySetInnerHTML`
- localized timestamp via `<time dateTime=...>`
- Proposal card inside the agent bubble that owns it

Use `aria-live="polite"` on the log and give the busy indicator `role="status"`.
Do not announce the entire historical log on initial hydration; enable live
announcements only after initial load or use an inner status region for newly
arrived content.

**Verify**: typecheck and lint pass.

### Step 2: Style actual conversation bubbles

Add scoped `.review-chat` styles:

- message row width 100%; agent left, editor right
- bubble max-width 82% (responsive to 100% on narrow spine widths)
- distinct but restrained agent and editor backgrounds using existing tokens/
  accent colors
- 10-12px padding, readable line height, border, and asymmetric corner treatment
- subdued role/timestamp metadata
- `white-space: pre-wrap` and safe overflow wrapping
- Proposal card visually continuous with the owning agent bubble
- a three-dot CSS typing indicator that respects
  `prefers-reduced-motion: reduce`

Ensure focus outlines, Accept/Reject buttons, and contrast remain visible.

**Verify**: build passes and CSS changes are confined under chat/proposal class
names.

### Step 3: Add scroll and input interaction polish

Add an end-of-log ref. Scroll smoothly after a newly sent/received message only
when the reader is already near the bottom; do not steal position when they are
reading older history. Initial hydration may jump to the latest message without
animation.

Keep Enter-to-send. Do not add multiline composition in this plan because the
input remains a single-line `<input>`. On failure, show a styled agent error
bubble while retaining the editor's message.

**Verify**: typecheck and lint pass.

### Step 4: Add focused E2E assertions

Extend `compare-versions.spec.ts` to assert:

- editor and agent messages have different role classes/labels
- a Proposal card is nested in its agent message
- stable persisted message IDs survive navigation away/back (plan 006 behavior)
- busy status is exposed while a delayed stub response is pending
- reduced-motion does not prevent message visibility

Avoid pixel snapshots. Assert structure and computed high-signal properties
(background differs, max width is constrained) so theme tweaks do not make the
test brittle.

Run all frontend gates.

## Test plan

The focused Playwright test is the behavioral contract. Manual visual QA at
desktop and narrow Review-spine widths remains required before merge, but it
does not replace automated structure/accessibility assertions.

## Done criteria

- [x] Editor and agent turns render as visually distinct bubbles.
- [x] Role label, timestamp, and stable message ID render for every persisted turn.
- [x] Proposal cards are attached to the owning agent bubble.
- [x] New messages auto-scroll only when already near the bottom.
- [x] Busy state is accessible and reduced-motion compliant.
- [x] Typecheck, build, lint, and focused E2E pass.
- [x] Only in-scope files plus plan completion records are modified.

## STOP conditions

- Plan 006 did not provide stable message IDs, roles, and timestamps.
- Styling requires changing the Review shell layout rather than chat-scoped CSS.
- A new Markdown/component dependency appears necessary; report the need rather
  than adding it in this small plan.
- The E2E environment cannot stub/delay review turns deterministically.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

Plan 007 may attach Version proposals or richer structured content to an agent
message. Keep message chrome generic and render new payload cards inside the
same agent bubble. Reviewers should check narrow widths, long filenames/IDs,
keyboard focus, and a long restored conversation.

## Completion record

- Added distinct agent/editor conversation bubbles with visible role and time
  metadata, stable message IDs, preserved line breaks, and attached Proposal
  cards.
- Added near-bottom-aware scrolling, post-hydration live announcements, an
  accessible delayed-response indicator, reduced-motion behavior, and a
  recoverable error bubble.
- Extended the Review E2E flow to cover message semantics, responsive width,
  visual distinction, Proposal ownership, busy feedback, and persistence after
  route navigation.
- Verification: `npm run build`, `npm run lint:frontend`, and
  `npm run test:e2e -- compare-versions.spec.ts` passed on 2026-06-21.
