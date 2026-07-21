# Plan 012: Transparent, adjustable clip generation (live re-derive)

## Status

DONE (2026-06-28; re-verified 2026-07-21 at `9a6d56a`) — frame scores
persist, cached clip re-derive and generation stats are covered by backend
tests, controls remain wired through the Import flow established by plan 018
Phase E. Priority P1, depends on none. Planned at commit `32dc2f6`, 2026-06-28.

## Why this matters

"Source clips" are in/out ranges + scores on the original file, from the
clip-assembly sub-step of Analyze. This was opaque and rigid: the only GUI
control (a "Stability ≥" slider) was a display filter, not a regenerator; the
real creation knobs (min/max clip duration, smoothness threshold, turn rate,
per-scene/video caps) were only settable via a raw API `preferences` dict and
required a full re-Analyze (re-running slow ffmpeg) to change.

Key insight: steps 1-4 (motion analysis, frame extraction, scene detection,
scoring) are expensive but produce `frame_scores`, which were **not
persisted**. Step 5 (`assemble_smooth_clips`) is pure/fast — persisting frame
scores once made re-running it with new knobs sub-second with zero ffmpeg.
This plan delivered that live re-derive plus transparency.

## What shipped

- `frame_scores.json` sidecar (schema-versioned, mirrors
  `write/read_analysis_results`), populated during analysis and on reopen.
- `_finalize_clip_set` extracted as the shared response-builder for analyze
  and re-derive (pure extraction — full pytest suite stayed green).
- `POST /projects/{id}/clips/rederive`: assembly-knob overrides, 422s if no
  cached `frame_scores` (project predates the feature, needs one Analyze).
- `generation_stats` (candidates_generated/kept, scenes_total/at_cap,
  effective preferences) persisted and returned alongside clips.
- Frontend `ClipGenerationPanel` (collapsible bar above "Suggested cuts",
  chosen over the chat spine to avoid crowding conversation); "Stability ≥"
  relabeled "Display filter" to end confusion with the generation-time
  smoothness threshold; regenerate warns it resets manual state. Per-clip
  "why" and stats line sourced from `generation_stats`.

## Accepted tradeoffs / invariants

pi AI re-scoring is not reapplied on re-derive — cached rule-based scores
persist until the next full Analyze. Regenerating resets manual
selections/order/trims/working timeline since the pool changes;
`clip_id = uuid5(file+range)` keeps IDs stable for unchanged ranges, but
decision-preservation for survivors was deferred — MVP resets and warns
instead. `frame_scores.json` adds ~1 entry/sec/video on disk (negligible,
watch-item for very long footage). Re-derive must never re-run ffmpeg and
identical preferences must reproduce identical `clip_id`s.
