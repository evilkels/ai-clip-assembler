# Real-footage QA improvements

Status: COMPLETE (2026-06-11). Backend 139 tests, frontend build, 6 Playwright
tests, synthetic E2E, and React Doctor branch check passed.

## Goal and delivered slices

Turn real-footage findings into persistent, truthful editing behavior while
separating changes that required labeled footage or new product contracts.

- **Workflow:** accepted order/trims auto-save and restore, including an
  intentionally empty edited Timeline; errors use the existing Review path.
  Local technical scores replaced hardcoded zeros; Timeline gained pointer-
  captured scrubbing, boundary snap, pointer-centered zoom, persisted resize,
  and native macOS title/project name.
- **Quality/assembly:** labeled abrupt/intentional-slow/stable fixtures, turn
  metrics, analyze-once format recommendation, chronological draft cleanup,
  preserved manual decisions, and explicit Regenerate Draft replacement.
- **Acceleration:** Open in DaVinci Resolve shipped. Speed/color controls remain
  deliberately deferred.

## Important invariants and surprises

An empty accepted order means “edited to empty,” not “no edits yet”; hydration
and debounced save depend on that distinction. Pi scoring preserves technical
fields via model-copy. Wheel zoom must not move the point under the cursor.
Switching from custom `hiddenInset` chrome to the native title bar removed the
custom row/CSS rather than layering another title mechanism.
