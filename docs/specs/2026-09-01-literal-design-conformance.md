# Literal Design Conformance

**Status:** Approved 2026-09-01

## Decision

The Claude Design export is authoritative for application layout, visual
hierarchy, density, typography, colors, radii, borders, and route composition.
Existing application behavior, backend contracts, local-first guarantees, and
Timeline authority remain authoritative underneath that presentation.

The implementation on PR #68 is not visually complete. Its earlier completion
claim covered behavior, tokens, and geometric containment; it did not establish
literal conformance to the approved designs.

## Sources of truth

- App: `AI CLIP ASSEMBLER Redesign APP + Landing page/Clip Assembler Restyle.dc.html`
  (local, gitignored, read-only), specifically `#1d` Import, `#1b` Review,
  `#3a` Timeline, and `#3b` Export plus the design-system sections.
- Landing: `docs/design/2026-09-01-landing-page-handoff.md` and
  `docs/design/2026-09-01-landing-page-reference.html`.
- Behavior: existing React route behavior and automated functional tests.
- Product architecture: `CONTEXT.md`, `docs/ARCHITECTURE.md`, and applicable ADRs.

If the fixed-width prototype conflicts with responsive operation, preserve its
hierarchy and relationships at 1440px and adapt them at narrower widths without
removing controls or changing behavior. Any deviation must be recorded as an
intentional functional adaptation, not silently accepted.

## Required application composition

### Shared shell

- Match the prototype's compact project header, metadata treatment, collapsible
  workflow rail, branded sidebar, workflow counts, active accent washes, route
  workspace, workflow action footer, and global status rail.
- Fix the broken development logo by importing or resolving it through the
  renderer asset pipeline.
- Do not use the current active-row left accent bar.
- Use the supplied Plex fonts and approved light/dark tokens.

### Import

- Match the prototype's route header and step label, source aggregates, compact
  toolbar, selected-source action rail, dense browser, side-by-side analysis and
  rule regions, and persistent workflow footer.
- Preserve search, filters, view modes, columns, stable selection, harness choice,
  analysis, abort, rescan, and navigation behavior.

### Review

- Present Ask AI, Suggested Versions, and Your Clips as the prototype's visible
  workstation. Your Clips must not begin hidden behind a disclosure.
- Preserve grid/list/filmstrip modes, filtering, scoring, inclusion decisions,
  version comparison/application, stale-state handling, and chat.

### Timeline

- Match the prototype's full workspace: large preview and transport, timeline
  beneath it, selected-item inspector and item rail, header actions, and workflow
  footer.
- Preserve item-ID authority, playback, trim, reorder, remove, undo/redo, speed,
  transform, and keyboard behavior.

### Export

- Match format selection, summary, warning, receipt, payload disclosure, handoff
  actions, and workflow footer.
- Preserve all existing formats, overwrite behavior, and backend handoff semantics.

## Landing page and screenshots

- Keep the implemented handoff structure and both themes, but review it literally
  at 1440px against the reference and at responsive widths.
- Capture corrected Review-screen screenshots from the finished Electron app in
  both themes using deterministic representative data.
- Use those corrected images in the macOS window frame; do not advertise the
  currently divergent application.

## Acceptance

- Canonical app comparisons: 1440x1000 and 1024x768, light and dark.
- Canonical landing comparisons: widths 1440, 1200, 900, 500, and 390, light and dark.
- Add deterministic Playwright screenshot baselines for the shell and major route
  states. Mask only elapsed time and genuinely nondeterministic video frames.
- Retain functional and geometry tests. Screenshot tests supplement rather than
  replace them.
- A baseline may be approved only after side-by-side comparison with the design
  export. Capturing the current implementation is not evidence of conformance.
- Finish with a real Electron smoke pass and an independent literal design review.
