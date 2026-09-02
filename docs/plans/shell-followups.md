# Shell Follow-ups

Status: TODO · Priority P3 · Category UI follow-up · Created 2026-09-02

Collects the shell work that survived the studio redesign (`6d79c1b`, v0.2.0).
Replaces `ui-polish-modern-shell.md`, which prescribed a shadcn/Radix migration
that the redesign overtook with hand-authored CSS, and takes over the deferred
interaction items from `project-sidebar.md`.

Nothing here is a defect. These are additive affordances and one verification
task, which is why they sit at P3 behind the correctness plans.

## Scope

1. **Cmd-K command palette.** Never built. The redesign shipped the shell,
   navigation rail, headers and status bar but no palette. Decide first whether
   it is worth the surface area for a four-route app; if it is, it should route
   to the same commands the navigation rail and keyboard shortcuts already
   expose rather than introducing a parallel command path.

2. **Score verification.** The Review score chips (`ScoreChip.tsx`) render
   overall and smoothness values on a 0-10 scale with tier colouring. Confirm
   the displayed numbers match what the backend computes, and that the tier
   thresholds (>=8 green, >=5 yellow) are the intended product boundaries
   rather than inherited placeholders.

3. **Settings and Diagnostics surfaces.** The redesign explicitly excluded
   these two routes, so they now sit visually apart from the four redesigned
   workflows. Bring them onto the shared design system, or decide deliberately
   that a utility route may look different and record that.

4. **Sidebar context menu.** Replace the inline Locate and Remove buttons on
   each project row (`Sidebar.tsx:190-215`) with a context-menu interaction, so
   the row is not carrying two always-visible affordances.

5. **Keyboard navigation and accessibility verification.** A keyboard-only pass
   over the shell and all routes: visible focus everywhere, no traps. Note that
   Timeline trim is currently a confirmed keyboard dead end — that defect is
   tracked in [`react-doctor-triage.md`](react-doctor-triage.md), not here.

## Already shipped, do not re-plan

`project-sidebar.md` listed collapse and resize as deferred. Both shipped in
the redesign and are covered by E2E: the collapsible rail lives in
`AppShell.tsx`, persisted width in `hooks/usePanelWidth.ts`, and
`project-shell-regressions.spec.ts:268-273` asserts the behaviour. Project row
rename and the card-style rows shipped earlier via
[plan 022](done/022-project-shell-header-and-sidebar.md).

## Open questions carried over

- Show backend health in the sidebar, or leave it in the status bar where the
  redesign put it?
- Pin support for recent projects?
- Drag-to-reorder recents — probably not; last-opened sort has been sufficient.

## Verification

`cd frontend && npm run lint && npm run typecheck && npm run test:e2e`. Any
change to the shell or a redesigned route must keep the visual conformance
baselines green, or update both the macOS and Linux sets deliberately — see the
`snapshotPathTemplate` note in `playwright.config.ts`.
