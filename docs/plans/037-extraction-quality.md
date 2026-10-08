# 037: Extraction quality

More and longer Candidate Clips from each Source Video, and Short, Medium and
Long drafts that actually use them, with no AI. Roadmap milestone 1.

## Context

Extraction is the first impression (`../ROADMAP.md`, milestone 1). Today it
underdelivers for four reasons, all confirmed against the current code:

- **One window per steady run.** `backend/src/clip_assembly.py:77`
  (`best_window`) keeps a single window per run; a 120 s uniformly good run
  yields one 10 s clip. `backend/tests/test_clip_assembly.py:231` pins this.
- **Average score beats usable length.** `best_window` ranks by mean score and
  uses duration only to break ties, so a 3 s peak inside good footage wins over
  the 10 s window around it.
- **The longest-clip default disagrees with itself.** The API default is 10 s
  (`backend/src/api.py:1929`, `frontend/src/renderer/src/lib/clipGenerationPreferences.ts:5`),
  the dataclass says 15 s (`backend/src/clip_assembly.py:14`), and the Long
  format is only recommended when a candidate is at least 20 s long
  (`backend/src/assembly_profiles.py:117`), which default extraction cannot
  produce. Long's cuts are 18–35 s (`assembly_profiles.py:35`).
- **Draft scene caps are keyed by bare `scene_id`.** Scene IDs restart per
  Source Video, so twenty videos that are each one scene share one per-scene
  quota (`backend/src/assembly_profiles.py:175` and `:211`). Medium stops at
  4 clips. This is P1-4 in `../reviews/2026-10-04-whole-repo-audit.md` and
  replaces the quota-fix part of 027, parked in `later/` on 2026-10-08.
- **A format switch does not reach the saved Timeline.** `POST
  /projects/{id}/draft` (`backend/src/api.py`, `regenerate_draft`) writes only
  the legacy `project["timeline"]` and invalidates the controller; on a folder
  project with any saved edit the reloaded `timeline.json` wins, so switching
  to Medium or Long changes nothing the Editor sees (P1-3 in the same audit).
  Milestone 1's "Medium and Long edits fill their target" is invisible until
  this is fixed, so it is in this plan.

Test footage: `~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26`, four DJI files of
35.9 s, 75.3 s, 51.7 s and 30.8 s (193.7 s in total, 1.7 GB), all one scene
each. Its cached analysis predates v0.4.0's rules and has no
`clipassembler/analysis/frame_scores.json`, so Phase 1 produces one. The
footage is shorter than the Medium (240 s) and Long (480 s) targets, so its
fill numbers are read against what the footage can give. The second folder,
`~/Movies/DRONE_VIDEO/14-06-26-Detox-hike-lilaste` (13 files, 503.5 s, 4.1 GB,
hiking footage), is long enough to fill Long and is measured the same way in
its own table. Both folders are on the implementer's machine at the same
path; delete any `clipassembler/` folder inside them before the first
measurement so the numbers come from a fresh analysis.

Milestone 6 ([019](019-clip-library-generation-and-expansion.md)) reuses the
window selector from Phase 3 with an exclusion list; its signature is fixed
here so 019 does not redesign it.

### Decisions

- **D1 Scene key.** `build_draft_timeline` counts per `(file_id, scene_id)`.
  Nothing else in the draft changes.
- **D2 Selector.** `clip_assembly.select_windows(windows, *, limit, exclude=(), score_tolerance=LONGER_WINDOW_SCORE_TOLERANCE) -> list[CandidateWindow]`
  replaces `best_window`. `exclude` is a sequence of `(start_sec, end_sec)`
  source ranges that may not be touched (019 passes the ranges already in the
  library). Algorithm, in order:
  1. `claimed` starts as `list(exclude)`; score each window once with
     `weighted_overall(window.frames)`.
  2. Repeat until `limit` windows are picked or none remain: `free` = windows
     that overlap no claimed range (overlap means `start < c_end and end > c_start`;
     touching is allowed). `best` = the highest score in `free`. Pick the
     window in `free` with `score >= best - score_tolerance`, ordered by
     duration descending, then score descending, then start ascending. Add it
     to `claimed`.
  3. Return the picks sorted by `start_sec`.
  No minimum gap between windows: adjacent windows are different footage, and
  the draft already refuses overlapping ranges and caps per scene.
- **D3 Tolerance.** `LONGER_WINDOW_SCORE_TOLERANCE = 0.5` overall-score points
  on the 0–10 scale. With the drone weights (`scoring_weights.py`) one
  smoothness point moves the overall score by 0.54, so a 10 s window around a
  3 s peak wins while a window that dips a full point does not.
- **D4 How many per run and per scene.** Drone files are usually one Scene
  each (all four Estepona files are), so a fixed per-scene cap is a per-video
  cap, and that is the owner's "too few clips from one video" complaint. The
  generation cap therefore scales with the Scene's length:
  `scene_cap(scene) = preferences.max_clips_per_scene * max(1, ceil(scene_duration_sec / 60))`
  (4 per started minute by default), still bounded by
  `max_candidates_per_video` (30). `select_windows` gets
  `limit = scene_cap(scene)` for each run, and `_bounded_scene_pool` uses
  `scene_cap` instead of the flat `max_clips_per_scene`. Several runs in one
  Scene still compete in `_bounded_scene_pool` as today. Draft-level per-scene
  caps (`assembly_profiles.py`) are unchanged.
  - Test `test_scene_cap_scales_with_scene_length` in
    `backend/tests/test_clip_assembly.py`: one steady 150 s Scene,
    `max_clip_duration_sec=10`, default preferences → 12 Candidate Clips
    (4 × 3 started minutes), no overlaps.
- **D5 Fallback.** A scene with no steady run still gets one fallback clip, now
  chosen with `select_windows(fallback_windows, limit=1)` so the tolerance rule
  applies there too. Scenes shorter than the minimum are still skipped.
- **D6 Longest-clip options and the rule.** Measure 10, 15, 20 and 30 s with
  the Phase 1 script on the Phase 3 code. Adopt **20 s** unless the total
  candidate count at 20 s is below half of the count at 10 s; in that case
  adopt **15 s**. 30 s is measured for the record but not adopted: 30 s
  windows sampled at 1 fps average over dips the Editor would see, and there
  is no ground truth to check that. The chosen value goes into all three
  defaults plus `scripts/backend_smoke_test.py:130`; a test asserts the
  dataclass and the API agree.
- **D7 Existing projects.** The Import step seeds "How clips are found" from
  `generation_stats.preferences`, so a project analyzed before this change
  keeps its old longest-clip value until the Editor regenerates. New projects
  get the new default. No migration.
- **D8 Measurement record.** The table below is the record. The implementer
  fills it in the PR that produces each row; numbers are not kept anywhere
  else.

### Measurements (Estepona)

Produced by `scripts/extraction_stats.py` (Phase 1). "Steady s" is the number
of Frame Samples that pass the smoothness and turn-rate gates (1 s each at
1 fps); "Covered s" is the union of candidate ranges. Draft columns are
`total_duration_sec` of `build_draft_timeline` for each format.

| Code | Max s | Clips 0813 / 0814 / 0815 / 0816 | Total | Median s | p90 s | Steady s | Covered s | Short s / 60 | Medium s / 240 | Long s / 480 | Recommended |
|---|---|---|---|---|---|---|---|---|---|---|---|
| main before Phase 2 | 10 | | | | | | | | | | |
| after Phase 3 | 10 | | | | | | | | | | |
| after Phase 3 | 15 | | | | | | | | | | |
| after Phase 3 | 20 | | | | | | | | | | |
| after Phase 3 | 30 | | | | | | | | | | |
| after Phase 4 (adopted default) | | | | | | | | | | | |

### Measurements (Detox hike)

Same script and columns; the per-file column lists the 13 counts in
`project.json` order, separated by `/`.

| Code | Max s | Clips per file | Total | Median s | p90 s | Steady s | Covered s | Short s / 60 | Medium s / 240 | Long s / 480 | Recommended |
|---|---|---|---|---|---|---|---|---|---|---|---|
| main before Phase 2 | 10 | | | | | | | | | | |
| after Phase 4 (adopted default) | | | | | | | | | | | |

### Out of scope

- Smoothness and turn-rate gate values, sampling rate and scene-detection
  parameters. Calibrating them needs ground truth on several folders
  (`../VALIDATION_RUNBOOK.md`, flow D); nothing cheap falls out of this plan.
- `max_clips_per_scene` and `max_candidates_per_video` defaults, and the
  draft's per-scene and Look Group policy (027, 025).
- Find more clips ([019](019-clip-library-generation-and-expansion.md)).

## Phase 1: Measure the current library

- [ ] 1.1 Add `scripts/extraction_stats.py` with a test. Done when
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_extraction_stats_script.py -q`
  passes and the script prints one Markdown table row for a folder project.
  - Usage: `cd backend && PYTHONPATH=. .venv/bin/python ../scripts/extraction_stats.py <folder> [--max-clip-sec N] [--json]`.
  - Reads `<folder>/clipassembler/project.json` (for folder projects
    `file_id` is the file name, `backend/src/api.py:1654`) and
    `<folder>/clipassembler/analysis/frame_scores.json` through
    `project_store.read_frame_scores`. Exit 2 with
    `Analyze this folder in the app first; frame_scores.json is missing` when
    the sidecar is absent.
  - Per file: `FrameScore.model_validate` each frame, `scene_bounds` and
    `source_duration_sec` exactly as `rederive_clips` builds them
    (`backend/src/api.py:838-855`), preferences from
    `api.preferences_from_request({"max_clip_duration_sec": N})` when
    `--max-clip-sec` is given, else `preferences_from_request({})`, then
    `assemble_smooth_clips`.
  - Metrics: candidate count per file; total; median and p90 of
    `duration_sec`; steady seconds = frames inside `candidate_runs(...)`;
    covered seconds = union length of candidate ranges; for each of
    `FORMATS` `short`, `medium`, `long`: `build_draft_timeline(clips_as_dicts, profile=..., target_duration_sec=...)["total_duration_sec"]`
    and clip count; `recommend_format(clips)`.
  - Output: one row in the column order of the table above, file columns in
    `project.json` order; `--json` prints the same as one JSON object.
  - Test `backend/tests/test_extraction_stats_script.py`: load the script the
    way `tests/test_backend_smoke_test_script.py` loads
    `scripts/backend_smoke_test.py`; write a temp folder with a `project.json`
    naming two files and a schema-3 `frame_scores.json` with 30 synthetic
    frames each (one steady, one half shaky); assert the per-file counts, the
    steady seconds and that the three draft totals are numbers.
- [ ] 1.2 Produce `frame_scores.json` for Estepona on `main`. Done when
  `~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26/clipassembler/analysis/frame_scores.json`
  exists with four `per_file` entries. (after 1.1)
  - Start the backend from `frontend/` with `npm run dev:backend`, then:
    `curl -s -X POST http://127.0.0.1:8000/projects/from-folder -H 'Content-Type: application/json' -d '{"folder_path":"<absolute folder>"}'`
    and
    `curl -s -X POST http://127.0.0.1:8000/projects/<project_id>/analyze -H 'Content-Type: application/json' -d '{"project_id":"<project_id>","harness_id":"manual","preferences":{}}'`.
    The analyze call blocks for a few minutes (vidstab is the slow stage).
  - This replaces the folder's old `results.json` (Pi-scored, pre-v0.4.0) with
    a rule-based library. That is intended; the copy on the implementer's
    machine is the measurement fixture.
- [ ] 1.3 Record the "main before Phase 2" rows. Done when the first row of
  both tables (Estepona and Detox hike) is filled from the script output at
  `--max-clip-sec 10` and committed in the Phase 1 PR. (after 1.2)
  - Produce Detox hike's `frame_scores.json` the same way as 1.2.

## Phase 2: Draft counts keyed per Source Video

- [ ] 2.1 Add the regression test. Done when
  `test_draft_scene_cap_counts_each_source_video_separately` in
  `backend/tests/test_assembly_profiles.py` fails on `main`.
  - Fixture: 20 Source Videos `file-0` … `file-19`, one candidate each,
    range 0–10 s, `scene_id=1`, `overall_score = 9.0 - i / 100`, no
    `look_group`. `build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=120)`.
  - Assert at least 12 clips, every `file_id` distinct and
    `total_duration_sec >= 108` (the cut cycle 10, 10, 10, 7, 10, 10 gives
    114 s in 12 clips, then the 6 s remainder is below the 7 s shortest cut).
    On `main` the draft stops at 4 clips and 37 s.
- [ ] 2.2 Key the counts on the Source Video. Done when 2.1 and
  `tests/test_assembly_profiles.py` pass. (after 2.1)
  - In `build_draft_timeline`, `scene_key = (clip.get("file_id"), scene_id)`
    for both the read at `assembly_profiles.py:176` and the write at `:211`.

## Phase 3: Several windows per steady run

- [ ] 3.1 Add selector tests. Done when the four tests below and D4's
  `test_scene_cap_scales_with_scene_length` exist in
  `backend/tests/test_clip_assembly.py` and fail because `select_windows`
  does not exist.
  - All build windows with `candidate_windows(frames, 3, 10)` and call
    `select_windows` directly; the `frame()` helper gives sharpness,
    exposure and contrast 8.0 and visual interest 0.
  - `test_select_windows_returns_non_overlapping_windows_longest_first`:
    31 frames 0–30 s at smoothness 9.0, `limit=4` → ranges
    `[(0, 10), (10, 20), (20, 30)]`.
  - `test_select_windows_skips_excluded_ranges`: same frames,
    `exclude=[(0.0, 12.0)]`, `limit=4` → `[(12, 22), (22, 30)]`.
  - `test_select_windows_prefers_longer_window_within_tolerance`: 21 frames
    0–20 s at 8.0 with 10, 11 and 12 s at 9.0, `limit=1` → one window of
    10 s whose range contains 10–13 s (the 3 s peak scores about 7.6, the
    10 s windows around it 7.35).
  - `test_select_windows_keeps_short_peak_when_longer_windows_fall_outside_tolerance`:
    same shape with the surround at 5.0, `limit=1` → one window shorter than
    10 s whose range contains 10–13 s.
- [ ] 3.2 Implement `select_windows` and use it everywhere. Done when 3.1
  passes and `rg -n best_window backend` prints nothing. (after 3.1)
  - `backend/src/clip_assembly.py`: add `LONGER_WINDOW_SCORE_TOLERANCE = 0.5`
    and `select_windows` per D2; in `assemble_smooth_clips` replace
    `chosen = best_window(windows)` with
    `select_windows(windows, limit=scene_cap(scene))` (D4) and
    append one `make_clip` per pick; replace
    `_rank_clips(fallback_clips)[0]` with
    `select_windows(fallback_windows, limit=1)` then `make_clip(..., fallback=True)`.
  - Add `scene_cap` per D4 and use it in `_bounded_scene_pool`.
  - `candidates_generated` in `generation_stats` now counts every window
    kept per run.
- [ ] 3.3 Update the tests that pin one window per run. Done when
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q` passes with
  these edits and no other count assertion loosened. (after 3.2)
  - `test_one_best_window_per_run_no_overlaps` → rename
    `test_windows_in_one_run_never_overlap`: 31 frames 0–30 s,
    `source_duration_sec=30`, `max_clip_duration_sec=10.0` as today, default
    per-scene cap → three clips
    `(0, 10)`, `(10, 20)`, `(20, 30)` and no two ranges overlap.
  - `test_assembly_caps_clips_per_scene` → rename
    `test_scene_cap_bounds_windows_from_one_run`; assert `len == 2`
    (`max_clips_per_scene=2` now bounds the run's windows instead of
    one-per-run).
  - `test_assemble_smooth_clips_respects_duration_and_thresholds`: durations
    become `[5, 5]` and `total_duration_sec == 10` (two 5 s windows from the
    20 s run, per-scene cap 2).
  - `test_assemble_smooth_clips_finds_ranked_segments_with_reason`,
    `test_assembly_picks_highest_scoring_window_in_scene`,
    `test_candidate_pool_keeps_each_scene_and_counts_sample_interval_at_boundary`
    and the `test_api.py` analyze tests (5–8 frame fixtures, per-scene cap 1 or
    runs that one window fills) keep their assertions; if one fails, re-read
    its fixture rather than widen the assertion.
- [ ] 3.4 Run the PR gate. Done when `npm run test:backend`, `npm run lint`,
  `npm run typecheck` and `npm run test:e2e` pass from `frontend/`. (after 3.3)

## Phase 4: Align the longest-clip default

- [ ] 4.1 Measure the four options. Done when the four "after Phase 3" rows
  are filled from `scripts/extraction_stats.py --max-clip-sec 10|15|20|30`
  on the merged Phase 3 code.
- [ ] 4.2 Adopt the value D6 selects and make the defaults agree. Done when
  `test_default_preferences_match_dataclass` in `backend/tests/test_api.py`
  (`api.preferences_from_request({}) == AssemblyPreferences()`) passes and
  `rg -n "max_clip_duration_sec" backend/src frontend/src/renderer/src/lib scripts` shows
  one value. (after 4.1)
  - D6 reads the Estepona counts.
  - Change `backend/src/clip_assembly.py:14`, `backend/src/api.py:1929`,
    `frontend/src/renderer/src/lib/clipGenerationPreferences.ts:5` and
    `scripts/backend_smoke_test.py:130`; rename
    `test_default_analysis_preferences_cap_candidate_windows_at_ten_seconds`
    to name the adopted value.
  - Write the adopted value and the D6 comparison (count at 20 s versus
    count at 10 s) in a sub-bullet here.
- [ ] 4.3 Record the adopted rows and refresh the index. Done when the last
  row of both tables is filled, `../USER_GUIDE.md`'s "How clips are found" text names
  the new default, and `python3 scripts/plans.py sync` leaves
  `docs/plans/README.md` consistent. (after 4.2)

## Phase 5: A format switch reaches the Timeline

- [ ] 5.1 Add the regression test. Done when
  `test_draft_format_switch_replaces_saved_timeline_document` in
  `backend/tests/test_api.py` fails on `main`.
  - Folder project analyzed with stubbed media (as the existing folder-project
    analyze tests do), one `include` Operation applied so `timeline.json` is
    saved, then `POST /projects/{id}/draft` with `{"format": "long"}`.
  - Assert `GET /projects/{id}/timeline/document` has profile
    `long_scenic`, the draft's `target_duration_sec`, and item
    `source_clip_id`s equal to the draft response's clips in order; after a
    simulated reload (drop the in-memory project and controller, load from
    disk, as the existing reload tests do) the document is the same; one
    `undo` restores the previous document.
- [ ] 5.2 Route the draft through the operations core. Done when 5.1 and
  `tests/test_api.py` pass. (after 5.1)
  - In `regenerate_draft`, after `build_draft_timeline`, get the controller
    (`TimelineLifecycle.get_controller`) and call `apply_batch` with three
    Operations as one undo step: `replace_timeline` (items: each draft clip's
    `clip_id` as `source_clip_id`, its draft `start_sec`/`end_sec`, speed 1.0),
    `set_profile`, `set_target_duration`. Persist through the controller's
    normal save path. Keep writing `project["timeline"]` for the response and
    legacy readers; remove the `invalidate_timeline_controller` call.
- [ ] 5.3 Run the PR gate. Done when `npm run test:backend`, `npm run lint`,
  `npm run typecheck` and `npm run test:e2e` pass from `frontend/`. (after 5.2)

## Human tasks

- [ ] H1 Open Estepona in the built app after Phase 4, switch between Short,
  Medium and Long, and say whether the first cut is worth keeping.
