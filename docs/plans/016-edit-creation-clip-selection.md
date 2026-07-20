# Plan 016: Fix edit creation — no duplicate clips, no unusable slivers, agent-influenced selection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report; do not improvise.
> When done, update this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6fc6c6d..HEAD -- backend/src/assembly_profiles.py backend/src/clip_assembly.py backend/src/analysis_service.py backend/src/api.py`
> If any of these changed, re-read the cited line ranges against live code
> before editing. On a structural mismatch, treat it as a STOP condition.

## Status

- **Status**: STEP 1 DONE (shipped this session), STEPS 2–4 TODO
- **Priority**: P1 (directly breaks the core "create an edit" flow)
- **Effort**: M
- **Risk**: LOW (Step 1, done), MEDIUM (Step 2 — touches candidate generation
  which feeds Review + Timeline), LOW-MEDIUM (Steps 3–4)
- **Depends on**: builds on plans 005 (rich candidate pool), 012 (adjustable
  generation / re-derive), and the agent-operable-timeline work (MCP + ops core)
- **Planned at**: commit `6fc6c6d`, 2026-07-20

## Symptom (reported)

Uploaded 7–8 videos → analysis produced 24 source clips → **"create an edit"
used some of the clips and made the edits really short and not usable.**

Two distinct defects, both reproduced with evidence (see below):

1. **Unusable slivers** — the assembled edit ended with a ~1-second clip.
2. **Duplicate clips** — the edit stacked many overlapping near-identical
   windows of the same footage, so it replayed the same moment repeatedly.

## Where edits are created

"Create an edit" = the **draft-timeline** step, distinct from candidate
generation:

- **Candidate generation** (`backend/src/clip_assembly.py`) — turns frame
  scores into `ClipSuggestion` candidates (the "24 source clips").
  - `candidate_windows` (`:47`) emits **every** (start,end) window between
    `min`/`max` duration over each smooth run — an O(n²) family of heavily
    **overlapping** windows covering the same footage.
  - `candidate_runs` (`:77`) splits frames into smooth runs.
  - `_bounded_scene_pool` (`:155`) keeps up to `max_clips_per_scene` per scene,
    ranked by score — but does **not** de-overlap, so multiple near-identical
    windows from one run survive into the pool.
- **Draft timeline** (`backend/src/assembly_profiles.py`) — selects candidates
  into the actual edit.
  - `build_draft_timeline` (`:94`) sorts candidates by `overall_score` desc and
    fills a duration budget, capped by `max_clips_per_scene` and `max_clips`.
  - Called from `analysis_service.py:374` (initial draft on analyze),
    `api.py:691` (`POST /projects/{id}/draft` re-draft), and after
    `api.py:702` `rederive_clips`.
  - Profiles in `PROFILE_DEFAULTS` (`:15`). Note `short_social` sets
    `max_clips_per_scene = 99` — effectively no scene-density limit, which is
    what let one scene's overlapping windows dominate an edit.

### Root causes (verified by reproduction)

- **Sliver**: `duration = min(available, clip_length, target - total)`. As
  `total` approaches `target`, the `target - total` term shrinks the final clip
  to whatever budget remains; the only guard was `if duration <= 0`. Repro:
  six 30s clips, `cinematic_highlight`, `target=50` → last clip `dur=1.0`.
- **Duplicates**: selection had a per-scene *count* cap but no *overlap* check.
  Repro: one smooth run exploded into overlapping windows (10–20s region) →
  `short_social` selected **12** overlapping near-duplicate clips (two of them
  the identical range 10–14).

## Steps

### Step 1 — De-overlap + sliver floor at draft time (DONE, shipped this session)

Implemented in `build_draft_timeline` (`assembly_profiles.py:94`):

1. **Overlap dedup**: track claimed source ranges per `file_id`
   (`claimed_spans`); skip any candidate whose `[start_sec, end_sec)` overlaps a
   range already selected from the same file. Adjacent clips (`end == start`)
   are allowed; identical ranges in *different* files are allowed (distinct
   footage).
2. **Sliver floor**: `min_clip_sec = min(clip_lengths)` (the profile's shortest
   intended cut). Once `selected` is non-empty and `target - total <
   min_clip_sec`, stop rather than emit a truncated tail. The first clip is
   exempt so a tiny `target` still yields one clip instead of an empty timeline.

New tests in `tests/test_assembly_profiles.py`:
`test_draft_skips_overlapping_windows_from_same_footage`,
`test_draft_skips_overlap_per_file_not_across_files`,
`test_draft_does_not_emit_sliver_tail_to_hit_target`.

- **Verify** (done): `pytest -q` → 362 passed; `ruff check` clean. Repro after
  fix: the 12-duplicate `short_social` edit collapses to 2 distinct clips, no
  sliver.
- **Why draft-time first**: it is pure, deterministic, well-tested, and fixes
  the *edit* the user complained about without disturbing candidate identity
  (`clip_id`s), the Review UI, or persistence.

### Step 2 — De-overlap candidate generation at the source (TODO)

The 24 source clips still contain overlapping near-duplicates (Step 1 only
hides them from the *edit*). Reduce duplication where candidates are created so
Review and re-derive show distinct footage too.

1. In `clip_assembly.py`, after `candidate_windows` builds windows for a run,
   apply non-maximum suppression: rank windows by `overall_score` and drop any
   window overlapping a kept one by more than a threshold (e.g. IoU > 0.5 or any
   overlap beyond `min_clip_duration_sec`). Do this per run before adding to
   `clips`, or inside `_bounded_scene_pool` (`:155`) before the per-scene cap.
2. Preserve `clip_id` stability: `clip_id = uuid5(file:start:end)` — keeping the
   highest-scored window per footage region means surviving IDs are unchanged.
3. Expose an "overlap tolerance" knob via `AssemblyPreferences`
   (`clip_assembly.py:11`) and thread it through `preferences_from_request`
   (`api.py`) so the re-derive endpoint (plan 012) can tune it without
   re-analyze.
- **Verify**: new backend test — a synthetic run with overlapping windows yields
  a de-overlapped pool; identical preferences reproduce identical `clip_id`s
  (uuid5 stability); `generation_stats.candidates_kept` drops as expected.
- **STOP** if de-overlap would re-run any ffmpeg step (it must operate on cached
  frame scores only — see plan 012's frame-score sidecar).

### Step 3 — Surface & control it in Review (TODO)

1. In the Clip Generation panel (plan 012, Step 5) add the overlap-tolerance
   control alongside the existing generation knobs, wired to `rederiveClips`.
2. Extend the generation-stats line to report duplicates suppressed
   (`candidates_generated → deduped → kept`) so the user sees why the pool
   shrank.
- **Verify**: `npx tsc --noEmit` and `npx eslint . --max-warnings=0` clean;
  values render for a seeded project.

### Step 4 — Let the in-app agent influence selection (TODO)

The agent-operable timeline (MCP + ops core; see
`docs/plans/agent-operable-timeline.md` and `docs/MCP_SERVER.md`) already lets
the review agent drive timeline operations. Give it the context and tools to
curate *selection*, not just trims:

1. Give the review agent the candidate pool with overlap/scene metadata so it
   can prefer diverse, non-duplicate clips when proposing a Version.
2. Add/confirm an operation to swap a selected clip for a better
   non-overlapping candidate from the same scene (reuse the ops core; no new
   write path).
3. Prompt/system-context update: instruct the agent to avoid overlapping
   footage and unusably short cuts, mirroring the deterministic invariants from
   Steps 1–2 so GUI drafts and agent proposals agree.
- **Verify**: synthetic e2e (existing pattern) — agent proposal over a pool with
  overlapping candidates yields a Version with no overlapping selections;
  backend tests green.

## STOP conditions

- Drift check shows a cited range moved and you cannot confidently re-map it.
- Step 2 de-overlap changes `clip_id`s for footage regions whose top window is
  unchanged (would break decision/version provenance — plan 009).
- Any change here re-runs ffmpeg (candidate quality must derive from cached
  frame scores only).

## Verification (run before claiming done)

```
cd backend && source .venv/bin/activate && python -m pytest -q && .venv/bin/ruff check src tests
cd frontend && npx tsc --noEmit -p tsconfig.json && npx eslint . --max-warnings=0
```

## Tradeoffs (accepted, not blockers)

1. **Step 1 can under-fill the budget** — stopping before a sliver means an edit
   may land slightly under `target_duration_sec` (e.g. 49s vs 50s). This is
   correct: a usable 49s beats a 50s that ends on a 1s stub.
2. **Overlap = "any intersection on the same file"** — chosen because candidate
   windows over one smooth run always replay the same footage. If a future need
   arises for deliberate overlapping instances (e.g. a repeated beat cut), make
   the tolerance a knob (Step 2/3) rather than removing the guard.
3. **Step 1 hides but does not remove** source-clip duplicates — Step 2 is the
   root-cause fix; until it lands, Review still lists overlapping candidates.
