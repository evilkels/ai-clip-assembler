# Plan 005: Separate rich Candidate Clip discovery from draft selection

## Status

- **Status**: DONE (2026-06-21)
- **Priority**: P1 | **Effort**: M | **Risk**: MED (changes the population stored as Candidate Clips)
- **Depends on**: none
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

Real source `IMG_0888.MOV` (49.03s) had three detected Scenes but only one
persisted Candidate Clip — Pi couldn't recover Scenes 2/3 because it only saw
clips that deterministic assembly had already kept. The Review Board/Version
gallery need a bounded but rich pool; non-overlap, target-duration, and
per-scene density are draft-selection concerns, not discovery concerns.

## Decisions / target design

Split `clip_assembly.py` into two operations: **candidate discovery** (capped
pool of scene-aware 3-10s ranges) and **draft selection** (consumes the pool,
applies non-overlap/max-per-scene/target-duration/profile). Discovery derives
bounds from Scene start/end and sample cadence (not from `scene_id`
reconstruction); a run of samples at 38/39/40s can still produce a >=3s
candidate if Scene end allows it (fixed a duration-undercount bug). Every
Scene with duration >= `min_clip_duration_sec` gets at least one fallback
Candidate Clip even if no threshold-passing run exists — fallback scores stay
honestly low, never inflated. Pool is capped per-Scene and per-Source-Video
(<=12 Pi calls per 49s video) to bound cost. Stable UUID5 Candidate Clip IDs
from `make_clip` are preserved since persisted editor decisions/Timeline Items
reference them. Out of scope: scene-detection thresholds/detector type,
vidstab/turn-rate recalibration, creative Version generation (plan 007),
parallel Pi calls.

## Completion record

- Exact-source validation on `IMG_0888.MOV` returned four candidates spanning
  all detected Scenes: Scene 1 (`0-3`, `2-5`), Scene 2 (`34-37`), Scene 3
  (`38-41`). No project files were overwritten.
- Full backend verification: 266 tests passed; Ruff and synthetic E2E passed.

## Maintenance notes

Review focus: boundary math, stable IDs, pool-size growth, and whether
low-quality fallback ranges are visually distinguished rather than
misrepresented. Plan 007 consumes this pool for project-level creative
Versions; future candidate changes must retain the discovery/selection split.
