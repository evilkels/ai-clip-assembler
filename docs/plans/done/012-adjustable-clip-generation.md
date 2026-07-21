# Plan 012: Transparent, adjustable clip generation (live re-derive)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 32dc2f6..HEAD -- backend/src/api.py backend/src/clip_assembly.py backend/src/assembly_profiles.py backend/src/project_store.py frontend/src/renderer/src/state/ReviewContext.tsx frontend/src/renderer/src/routes/Review.tsx`
> If any of these changed, re-read the line ranges below against live code
> before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Status**: DONE (2026-06-28; re-verified 2026-07-21 at `9a6d56a`) — frame
  scores persist, cached clip re-derive and generation statistics are covered
  by backend tests, and the controls remain wired through the current Import
  flow established by Plan 018 Phase E.
- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM (touches the analysis pipeline tail + Review wiring; clips feed the Review agent and Timeline)
- **Depends on**: none (the assembly knobs were already widened on branch `fix/auto-detect-pi-bin`, commit `27a370f`)
- **Category**: feature / transparency / UX
- **Planned at**: commit `32dc2f6`, 2026-06-28

## Why this matters

"Source clips" are created in the **clip-assembly** sub-step of Analyze
(`assemble_smooth_clips`). They are **in/out ranges + scores on the original
file**, never new media. Today this step is opaque and rigid:

- The only GUI control, the "Stability ≥" slider on Review, is a **display
  filter** over already-generated clips — it does not regenerate anything.
- The real creation knobs (`min/max_clip_duration_sec`, `smoothness_threshold`,
  `max_turn_rate_deg_per_sec`, `max_clips_per_scene`, `max_candidates_per_video`)
  are only settable via the API `preferences` dict and require a full re-Analyze
  (re-running the slow ffmpeg steps) to change.
- Pool-bounding silently discards most candidate windows; the user sees only
  survivors with a one-line `ai_reason`.

Key insight: steps 1–4 (motion analysis, frame extraction, scene detection,
frame scoring) are expensive but produce `frame_scores`, which **are not
persisted**. Step 5 (`assemble_smooth_clips`) is pure, deterministic and runs in
milliseconds. **Persist the frame scores once, and re-running step 5 with new
knobs becomes sub-second with zero ffmpeg.** This plan delivers that live
re-derive plus the transparency (counts + per-clip "why") to make the step
understandable.

## Current state (verified at `32dc2f6`)

- `backend/src/api.py:462-628` — `run_analysis_pipeline`: per-video loop;
  `frame_scores` computed at `:545-550`; `assemble_smooth_clips` called at
  `:551-563` with `preferences`, `scene_bounds`, `source_duration_sec`.
- `backend/src/api.py:630-667` — pipeline tail: merge non-analyzed clips
  (`:631-635`), `enrich_clips_with_source_metadata` (`:638`), rank (`:639`),
  recommend + `build_draft_timeline` (`:656-661`), write
  `projects[id]["clips"]/["timeline"]/["harness_id"]`, `invalidate_timeline_controller`,
  `persist_project_results` (`:663-667`).
- `backend/src/api.py:741-756` — `POST /projects/{id}/draft` (`regenerate_draft`):
  the template for a re-derive endpoint (loads `project["clips"]`, rebuilds the
  draft, invalidates, persists).
- `backend/src/api.py:1639-1648` — `preferences_from_request` maps the
  `preferences` dict → `AssemblyPreferences` (defaults already widened).
- `backend/src/api.py:1496-1511` — `persist_project_results` →
  `write_analysis_results(folder, harness_id, clips, timeline)`.
- `backend/src/api.py:228-247` — folder reopen restores `clips`/`timeline` via
  `read_analysis_results`.
- `backend/src/clip_assembly.py:189-253` — `assemble_smooth_clips`; returns
  `AssemblyResult(clips, sequence, metadata={"local": True, "model_used": …})`.
  `_bounded_scene_pool` (`:154-186`) is where candidates are dropped.
- `backend/src/project_store.py:224-258` — `write_analysis_results` /
  `read_analysis_results` (schema-versioned JSON sidecar pattern to mirror).
- `backend/src/models.py:33-48` — `FrameScore`; `:51+` — `ClipSuggestion`
  (already carries `scene_id`, `tags` `["drone","smooth"|"fallback"]`, scores,
  `ai_reason`, `source_*`).
- `frontend/src/renderer/src/state/ReviewContext.tsx:323-357` — `setClips`,
  `applyAnalysisResult`, `regenerateDraft` (wiring template).
- `frontend/src/renderer/src/routes/Review.tsx:105-130` — the "Stability ≥"
  display-filter control; `:41` is the filter itself.
- `frontend/src/renderer/src/api/client.ts:235-245` `analyzeProject`;
  `:598+` `regenerateDraft` (client-fn template).

Conventions to match: schema-versioned JSON sidecars in `project_store.py`;
backend-authoritative state mutated through `projects[id]` then persisted; plain
CSS + design tokens in `styles.css`; FastAPI route → thin wrapper over a helper.

## Steps

### Step 1 — Persist frame scores (backend)
1. Add `FRAME_SCORES_FILENAME = "frame_scores.json"` and
   `write_frame_scores(folder, per_file)` / `read_frame_scores(folder)` to
   `project_store.py`, schema-versioned, mirroring `write/read_analysis_results`.
   Shape: `{schema_version, per_file: {<file_id>: {frames: [FrameScore…],
   scene_bounds: {<scene_id>: [start,end]}, source_duration_sec, fps}}}`.
2. In `run_analysis_pipeline`, accumulate a `per_file_frames` dict during the
   loop and write it after the loop (folder projects only). Also stash it on
   `projects[id]["frame_scores"]`.
3. On folder reopen (`api.py:228-247`), load via `read_frame_scores` into
   `projects[id]["frame_scores"]`.
- **Verify**: new backend test — analyze a seeded project, assert
  `frame_scores.json` exists and reload-from-folder repopulates
  `projects[id]["frame_scores"]`.

### Step 2 — Extract `_finalize_clip_set` (backend, no behaviour change)
1. Move `api.py:630-667` into
   `_finalize_clip_set(project_id, per_file_results, preferences) -> dict`,
   where `per_file_results` is the list of per-file `AssemblyResult`s (or already
   source-metadata-tagged clip dicts). Have `run_analysis_pipeline` call it.
2. Return `{clips, sequence/timeline, recommendation, generation_stats}` (stats
   from Step 4) so both callers share one response builder.
- **Verify**: full `pytest` stays green (characterization — no assertion
  changes expected). `git diff` shows pure extraction.

### Step 3 — Re-derive endpoint (backend)
1. Add `POST /projects/{id}/clips/rederive`, body = assembly-knob overrides →
   `preferences_from_request`. 404 if unknown project; **422 if
   `projects[id]["frame_scores"]` is absent** (project predates this feature →
   user must Analyze once). Model the route on `regenerate_draft` (`:741`).
2. For each cached file: rebuild `FrameScore` objects, call
   `assemble_smooth_clips` with the new preferences + cached `scene_bounds` +
   `source_duration_sec`, then `_finalize_clip_set`.
3. Add a client fn `rederiveClips(projectId, preferences)` in `client.ts`.
- **Verify**: backend tests — same prefs reproduce the same `clip_id`s
  (uuid5 stability); different `max_clips_per_scene`/duration change
  `candidates_kept`; 422 when no cache.

### Step 4 — Transparency stats (backend)
1. Extend `assemble_smooth_clips` to put in `AssemblyResult.metadata`:
   `candidates_generated` (pre-pool count), `candidates_kept`, `scenes_total`,
   `scenes_at_cap`, and the effective `preferences` dict.
2. Aggregate per-video into a `generation_stats` block on the analyze /
   re-derive response and `projects[id]["generation_stats"]`; persist it inside
   `write_analysis_results` (bump its `schema_version`).
- **Verify**: response includes `generation_stats`; persisted + reloaded.

### Step 5 — Clip Generation panel (frontend)
1. New `components/ClipGenerationPanel.tsx`: a collapsible bar **above
   "Suggested cuts"** in `Review.tsx` (chosen over the chat spine to avoid
   crowding the conversation). Inputs: min/max clip duration, **generation**
   smoothness threshold, max turn rate, max clips per scene, max candidates per
   video, + a "Regenerate clips" button.
2. ReviewContext: add `rederiveClips(prefs)` that calls the client fn then reuses
   `applyAnalysisResult` (`:335`) to reseed. Surface `generation_stats`.
3. **Relabel the existing "Stability ≥" control to "Display filter"** and label
   the panel's smoothness "used to generate clips", to end the two-thresholds
   confusion.
4. Warn (inline note + confirm) that regenerating resets manual
   include/exclude/order + working timeline.
- **Verify**: `npx tsc --noEmit` and `npx eslint .` clean.

### Step 6 — Per-clip "why" + counts (frontend)
1. Stats line by "All clips (N)": *"Generated X → kept Y · scene cap on A/B
   scenes · video cap N."* from `generation_stats`.
2. In `SourceClipsPanel` clip cards, add a compact "why" line from existing
   fields: source scene, smooth vs. fallback (`tags`), qualifying
   smoothness/turn.
- **Verify**: `tsc` + `eslint` clean; values render for a seeded project.

## STOP conditions
- Drift check shows any referenced range moved and you cannot confidently
  re-map it.
- `assemble_smooth_clips` output for identical preferences is **not**
  byte-identical to pre-change (would mean Step 2 changed behaviour — it must
  not).
- Re-derive would need to re-run any ffmpeg step (means frame-score persistence
  is incomplete — fix Step 1, don't paper over it).

## Verification (run before claiming done)
```
cd backend && source .venv/bin/activate && python -m pytest -q && .venv/bin/ruff check src tests
cd frontend && npx tsc --noEmit -p tsconfig.json && npx eslint . --max-warnings=0
```
Optional E2E (needs Electron + live backend + ~180s analyze):
`cd frontend && npx playwright test e2e/compare-versions.spec.ts`

## Tradeoffs (accepted, not blockers)
1. **pi AI re-scoring is not reapplied on re-derive** — it uses cached
   rule-based scores. Re-deriving on a pi project yields rule-based clip scores
   until the next full Analyze. (Optional future: re-score survivors with pi.)
2. **Regenerating resets manual decisions** (selections/order/trims/working
   timeline) because the candidate pool changes. `clip_id` is `uuid5(file+range)`
   so unchanged ranges keep their IDs — a later enhancement could preserve
   decisions for surviving IDs; MVP resets and warns.
3. `frame_scores.json` adds ~1 entry/sec/video on disk — negligible for typical
   projects; noted for very long footage.
