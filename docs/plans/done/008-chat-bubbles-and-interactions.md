# Plan 008: Present review chat as an accessible conversation

## Status

- **Status**: DONE (2026-06-21)
- **Priority**: P2; **Depends on**: 006
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

The review chat rendered each message as a bare `<p>`; CSS only changed
alignment/opacity, so turns read as unstructured text. Plan 006's persisted
roles/IDs/timestamps provide enough semantics to build clear bubbles, attach
Proposal cards to the right turn, auto-scroll, and announce new messages
accessibly.

## Decisions

- Reused existing design tokens (`--surface`, `--border`, etc.) rather than
  introducing a second palette.
- No frontend unit-test runner exists; relied on typecheck/build/lint plus an
  extended Playwright spec (`compare-versions.spec.ts`) instead of pixel
  snapshots — asserted structure/computed properties so theme tweaks don't
  make the test brittle.
- Did not announce the full historical log on hydration (`aria-live="polite"`
  only for content arriving after initial load) to avoid a wall of screen-
  reader noise on open.
- Auto-scroll only fires when the reader is already near the bottom, so it
  doesn't steal position from someone reading older history; initial
  hydration jumps to latest without animation.
- Kept the single-line `<input>` — no multiline composition in this plan.
- Explicitly out of scope: backend/session behavior (006), Version generation
  (007), token streaming, new component/icon/Markdown deps, Review shell
  redesign.

## Completion record

- Added distinct agent/editor bubbles: `<article>` markup with
  `data-message-id`, role class + accessible label, preserved line breaks
  (no `dangerouslySetInnerHTML`), `<time>` timestamps, Proposal card nested in
  the owning agent bubble.
- Styled bubbles (max-width 82%, agent left/editor right, existing tokens,
  asymmetric corners) plus a `prefers-reduced-motion`-aware typing indicator.
- Added near-bottom-aware scrolling, post-hydration live announcements, an
  accessible delayed-response indicator, and a recoverable error bubble
  (styled agent error while retaining the editor's message).
- Extended the Review E2E flow: role classes/labels, Proposal ownership,
  persisted IDs across navigation, busy status, reduced-motion visibility.
- Verification: `npm run build`, `npm run lint:frontend`,
  `npm run test:e2e -- compare-versions.spec.ts` passed 2026-06-21.
