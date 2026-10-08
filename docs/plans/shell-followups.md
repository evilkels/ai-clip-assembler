# Shell Follow-ups

The shell work that survived the studio redesign is decided, built or dropped,
and the score chips are verified against the backend.

## Context

Priority P3 · Category UI follow-up · Created 2026-09-02. Status when written:
TODO.

Collects the shell work that survived the studio redesign (`6d79c1b`, v0.2.0).
Replaces `ui-polish-modern-shell.md`, which prescribed a shadcn/Radix migration
that the redesign overtook with hand-authored CSS, and takes over the deferred
interaction items from [`done/project-sidebar.md`](done/project-sidebar.md).

Nothing here is a defect. These are additive affordances and one verification
task, which is why they sit at P3 behind the correctness plans.

### Settings and Diagnostics surfaces

**MOVED 2026-09-03** to [plan 031](031-app-restyle-conformance.md) Phase 4,
which is no longer the open question this item posed. The restyle handoff
answers it: Settings becomes a four-panel left rail with a new `AI assistance`
panel, and Diagnostics gets a designed failure card. Two plans must not own the
same surface, so this one does not.

### Keyboard navigation and accessibility verification

A keyboard-only pass over the shell and all routes: visible focus everywhere,
no traps.

- The pass is a release check; it moved to [040](040-release-qa.md) (H2).
- Timeline trim is not a dead end: its keyboard path is the inspector's In/Out
  fields, proven by `timeline-playback.spec.ts` — see
  [`done/react-doctor-triage.md`](done/react-doctor-triage.md).

### Already shipped, do not re-plan

[`done/project-sidebar.md`](done/project-sidebar.md) listed collapse and resize as deferred. Both shipped in
the redesign and are covered by E2E: the collapsible rail lives in
`AppShell.tsx`, persisted width in `hooks/usePanelWidth.ts`, and
`project-shell-regressions.spec.ts:268-273` asserts the behaviour. Project row
rename and the card-style rows shipped earlier via
[plan 022](done/022-project-shell-header-and-sidebar.md).

### Open questions carried over

- Show backend health in the sidebar, or leave it in the status bar where the
  redesign put it?
- Pin support for recent projects?
- Drag-to-reorder recents — probably not; last-opened sort has been sufficient.

### Verification

`cd frontend && npm run lint && npm run typecheck && npm run test:e2e`. Any
change to the shell or a redesigned route must keep the visual conformance
baselines green, or update both the macOS and Linux sets deliberately — see the
`snapshotPathTemplate` note in `playwright.config.ts`.

## Phase 1: Shell follow-ups

- [ ] 1.1 Cmd-K command palette. Never built: the redesign shipped the shell, navigation rail, headers and status bar but no palette. Done when it is decided whether it is worth the surface area for a four-route app and, if built, it routes to the same commands the navigation rail and keyboard shortcuts already expose rather than a parallel command path.
- [ ] 1.2 Score verification. The Review score chips (`ScoreChip.tsx`) render overall and smoothness values on a 0-10 scale with tier colouring. Done when the displayed numbers are confirmed to match what the backend computes.
- [ ] 1.3 Sidebar context menu. Done when the inline Locate and Remove buttons on each project row (`Sidebar.tsx:190-215`) are replaced with a context-menu interaction, so the row no longer carries two always-visible affordances.
