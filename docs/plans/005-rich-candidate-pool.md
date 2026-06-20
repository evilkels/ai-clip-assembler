# Plan 005: Separate rich Candidate Clip discovery from draft selection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `docs/plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6744eaa..HEAD -- backend/src/clip_assembly.py backend/src/api.py backend/src/models.py backend/src/pi_cli_harness.py backend/tests/test_clip_assembly.py backend/tests/test_api.py backend/tests/test_pi_cli_harness.py docs/HARNESS_SPEC.md`
> If an in-scope file changed, compare the excerpts below with the live code.
> Stop if the candidate-generation contract no longer matches.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes the population stored as Candidate Clips)
- **Depends on**: none
- **Category**: bug / architecture
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

The exact reported source, `IMG_0888.MOV` (49.03s), contains three detected
Scenes (`0-21.21`, `21.21-37.21`, `37.21-49.03`) but the persisted result contains
only one Candidate Clip (`0-3s`, Scene 1). Pi cannot recover Scenes 2 and 3
because it only receives the clips that deterministic assembly already kept.
The Review Board and Version gallery need a bounded but rich pool; non-overlap,
target-duration, and per-scene density are draft-selection concerns.

## Current state

- `backend/src/scene_detection.py:35-44` returns Scene boundaries. The current
  default detector finds the three ranges above on the reported source.
- `backend/src/clip_assembly.py:37-50` derives duration as
  `last_sample.timestamp - first_sample.timestamp`. Three one-second samples at
  38, 39, and 40 seconds therefore count as 2s even though they cover roughly
  38-41s. This rejects valid edge ranges.
- `backend/src/clip_assembly.py:53-75` breaks a run whenever one Frame Sample is
  below the Smoothness Score or turn-rate threshold.
- `backend/src/clip_assembly.py:116-166` generates all windows and immediately
  applies ranking, global non-overlap, target duration, and
  `max_clips_per_scene`. Its returned `clips` are therefore a draft, not a rich
  Candidate Clip pool.
- `backend/src/api.py:539-584` sends only that returned list to Pi. Lines
  637-642 already build a separate draft later with `build_draft_timeline`, so
  early draft selection is duplicated.
- `backend/src/pi_cli_harness.py:337-341` samples only `manual_result.clips`.
- Use domain names from `UBIQUITOUS_LANGUAGE.md`: Source Video, Scene, Frame
  Sample, Candidate Clip, Review Board, Timeline Item, and Timeline Document.
- Preserve stable UUID5 Candidate Clip IDs from `make_clip`; persisted editor
  decisions and Timeline Items refer to them.

## Target design

Create two explicit operations in `clip_assembly.py`:

1. **Candidate discovery** produces a capped pool of scene-aware 3-10s ranges.
2. **Draft selection** consumes that pool and applies non-overlap,
   `max_clips_per_scene`, target duration, and profile decisions.

The pool algorithm must:

- Use Scene start/end information and the sample cadence when calculating clip
  bounds. End bounds represent the end of the final sample interval, clamped to
  the Scene and Source Video.
- Prefer threshold-passing runs, but guarantee one fallback Candidate Clip for
  every Scene whose duration is at least `min_clip_duration_sec`. Rank fallback
  windows with a continuous penalty for weak Smoothness Score/turn rate rather
  than rejecting the entire Scene.
- Generate a small set of varied windows (short/medium/long, within 3-10s) with
  controlled overlap. Cap the pool per Scene and per Source Video using named
  preferences so a 49s file does not create an unbounded number of Pi calls.
- Keep quality labels/scores honest. A fallback candidate remains low-scoring;
  guaranteeing discoverability must not inflate Smoothness Score.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_clip_assembly.py tests/test_api.py tests/test_pi_cli_harness.py -q` | exit 0 |
| Backend suite | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` | all pass |
| Lint | `cd frontend && npm run lint:backend` | exit 0, no Ruff errors |
| Synthetic E2E | `backend/.venv/bin/python scripts/synthetic_e2e_qa.py` | exits 0 |

## Scope

**In scope**:

- `backend/src/clip_assembly.py`
- `backend/src/api.py`
- `backend/src/models.py` only if an explicit candidate-quality field is needed
- `backend/src/pi_cli_harness.py` only to preserve pool ordering/sequence semantics
- `backend/tests/test_clip_assembly.py`
- `backend/tests/test_api.py`
- `backend/tests/test_pi_cli_harness.py` if the pool contract changes its fixtures
- `docs/HARNESS_SPEC.md`
- `docs/plans/README.md` status only

**Out of scope**:

- Changing PySceneDetect thresholds or detector type; it already finds the three
  Scenes in the reported source.
- Recalibrating vidstab/turn-rate formulas.
- Creative Version generation or chat changes (plan 007).
- Parallel Pi calls/retry implementation; plan 002's completed spike owns that
  recommendation. Keep this plan's pool cap conservative.
- Reanalyzing or overwriting the user's real project as part of automated work.

## Git workflow

- Branch: `fix/rich-candidate-pool`
- Use Conventional Commits, e.g. `fix(analysis): preserve scene candidates`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing characterization tests

In `backend/tests/test_clip_assembly.py`, model a 49s Source Video with three
Scene spans. Include:

- Scene 1 with a long passing run.
- Scene 2 with only a 4-sample passing run.
- Scene 3 with samples at 38, 39, 40 followed by weak samples, plus a Scene end
  after 41s. Assert the interval-aware bounds make a >=3s candidate.
- A completely weak but >=3s Scene. Assert it contributes one low-scoring
  fallback candidate.
- A Scene shorter than the minimum. Assert no invalid candidate is fabricated.
- Determinism, stable IDs, per-Scene cap, per-video cap, and no bounds outside
  Scene/Source Video.

Add an API test using the existing monkeypatch pattern around
`test_analyze_runs_motion_and_scene_detection_before_scoring`: three detected
Scenes must reach persisted/returned `clips`, while the initial draft remains
allowed to select fewer.

**Verify**: run the focused test command and confirm the new regression tests
fail for the expected missing-scene/duration reasons, not fixture errors.

### Step 2: Introduce scene-aware Candidate Clip discovery

Refactor `clip_assembly.py` so discovery receives the Scene bounds and source
duration it needs. Prefer explicit typed parameters over reconstructing bounds
from `scene_id`. Wire `api.py`'s existing `scenes` and video duration into it.

Calculate each range from interval coverage. Derive cadence from adjacent Frame
Sample timestamps with a safe 1.0s fallback. Clamp every start/end to its Scene
and Source Video and reject `end <= start`.

Generate high-quality windows first. If a qualifying Scene has no valid
minimum-duration window, choose its best continuous fallback window and retain
its real metrics. Deduplicate identical ranges before assigning stable IDs.

**Verify**: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_clip_assembly.py -q`
must pass all old and new assembly tests.

### Step 3: Move final-cut constraints to draft selection

Make `AssemblyResult.clips` represent the Candidate Clip pool. Remove global
non-overlap, target-duration stopping, and final per-scene density from pool
creation. Keep those constraints in `build_draft_timeline`/
`assembly_profiles.py`, which already runs at `api.py:637-642`.

Add bounded discovery preferences with conservative defaults. The API test must
prove that `projects[project_id]["clips"]` contains the rich pool while the
Timeline Document/draft contains a curated subset.

Do not silently change the public `ClipSuggestion` fields. If pool/fallback
status is useful in UI, add an optional backward-compatible field with a
default and update mapping tests.

**Verify**: focused API and Pi harness tests pass.

### Step 4: Preserve Pi behavior over the bounded pool

Confirm Pi receives every bounded Candidate Clip and can rerank it without
dropping candidates or changing their stable ranges. Ensure `sequence.clips`
contains each enhanced candidate exactly once. Add a test covering one fallback
candidate and candidates from three Scenes.

Record pool size in analysis metadata/logging. The default cap must prevent a
single 49s Source Video from producing more than 12 Pi calls until plan 007
introduces project-level creative curation.

**Verify**: focused tests pass and a unit test asserts the cap.

### Step 5: Update the harness contract and run all gates

Document that the Manual Harness emits a rich Candidate Clip pool and that
draft/Version selection is separate. Document fallback candidates as
discoverable low-quality options, not recommendations.

Run backend suite, backend lint, and synthetic E2E.

## Test plan

Use `backend/tests/test_clip_assembly.py` as the unit-test pattern and
`backend/tests/test_api.py` for pipeline persistence. Required regression cases
are the six cases in Step 1 plus Pi preservation and API pool-vs-draft behavior.
No real cloud model call belongs in the tests.

## Done criteria

- [ ] Three synthetic detected Scenes yield at least one Candidate Clip each.
- [ ] Samples at 38/39/40 can produce a >=3s range when Scene bounds allow it.
- [ ] Weak fallback Scenes remain honestly low-scoring.
- [ ] Pool generation is deterministic and bounded to <=12 candidates/video by default.
- [ ] Draft selection still enforces non-overlap, scene density, and target duration.
- [ ] Pi unit tests prove all bounded pool candidates survive enhancement/fallback.
- [ ] Backend suite, lint, and synthetic E2E exit 0.
- [ ] Only in-scope files plus this status row are modified.

## STOP conditions

- Current default scene detection no longer finds three Scenes on the reported
  source; detector work must then be replanned rather than hidden here.
- Stable Candidate Clip IDs cannot be preserved for unchanged ranges.
- A rich pool requires more than 12 model calls per 49s Source Video under the
  chosen defaults.
- Existing accepted Timeline Items are deleted during reanalysis.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

Reviewers should scrutinize boundary math, stable IDs, pool-size growth, and
whether low-quality fallback ranges are visually distinguished rather than
misrepresented. Plan 007 will consume this pool for project-level creative
Versions; future candidate changes must retain that separation.
