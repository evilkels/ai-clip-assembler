# Task 5 implementer report

Status: DONE

## Scope delivered

- Added the pure `timelineProjection` view model with stable `item_id` identity,
  repeated-source support, per-item bounds, speed-aware effective duration,
  transform defaults/pass-through, and missing-source fallback metadata.
- Adopted the projection in Timeline route summaries, the playback track,
  Timeline editor rows/inspector, and Export payload/effective-duration
  calculations. Backend Timeline Document operations remain authoritative.
- Lifted selected `item_id` to the Timeline route and added a compact selected
  item inspector without changing reorder, trim, split, remove, speed,
  transform, undo/redo, playback, keyboard, or SSE operation paths.
- Added studio Timeline styling using existing tokens, static clip thumbnail /
  missing-source fallback treatment, and non-eager clip media presentation.
- Extended `timeline-playback.spec.ts` with selected-item inspector, repeated
  block, ruler/transport, and missing-source fallback assertions.

## Review fix round

- Sequence playback now deterministically skips missing-source placements when
  a playable successor exists and safely stops when every remaining placement
  is unavailable. Effective Timeline duration and offsets still include every
  authoritative item.
- Added mixed missing→valid and all-missing playback E2Es, plus request/document
  assertions for `item_id`-targeted speed, transform, split, reorder,
  undo/redo, and keyboard mutations. Existing live reorder/removal coverage
  continues to verify SSE reconciliation.
- Added native selection buttons to editor rows and clip blocks with
  `aria-pressed`, avoiding nested interactive roles while preserving drag and
  operation controls.
- Added Timeline-specific dark/light surface assertions. Presentation remains
  aligned with the supplied design reference: transport/ruler/playhead, clip
  blocks with thumbnail treatment, selected inspector, and compact item rows.

## Visual conformance round

- Reorganized the Timeline page into a responsive two-column workspace: the
  main preview/transport/ruler/track remains authoritative, while a roughly
  320px inspector exposes editable In/Out/Speed/Zoom, Split, Remove, and the
  compact all-items list.
- Reused `TimelineItemControls` and `TimelineItemRow` so inspector mutations
  continue to send the selected placement's `item_id`; no duplicate full-width
  control rows were added below the track.
- Strengthened Timeline presentation E2E coverage for representative track,
  clip/static fallback, transport, ruler, inspector theme surfaces, desktop
  column containment, responsive stacking, no horizontal overflow, and native
  keyboard row selection.

## Verification

- Red evidence: `npm run test:main -- --test-name-pattern='projects repeated|each item bounds|missing source'` initially failed because `timelineProjection` did not exist.
- `npm run test:e2e -- timeline-playback.spec.ts`: PASS (17/17).
- `npm run test:e2e -- preview-audio.spec.ts`: PASS (3/3).
- `npm run test:main`: PASS (64/64).
- `npm run lint:frontend`: PASS (0 warnings).
- `npm run typecheck`: PASS, including generated-type freshness.
- `git diff --check`: PASS.
- Review fix focused E2Es: PASS (4/4 new Timeline cases).
- Final combined focused E2Es: PASS (23/23 Timeline + preview-audio tests).
- Visual-round focused E2Es: PASS (23/23 Timeline + preview-audio tests),
  including the two-column, responsive, theme, keyboard-selection, and
  inspector Remove assertions.

## Concerns

- Thumbnail treatment is intentionally static and local; no backend thumbnail
  endpoint or contract was introduced.
- The repository-wide backend test suite and integrated Task 7 QA remain the
  responsibility of the parent workflow; no backend files changed here.
