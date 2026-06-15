# Clip Quality, Composition & Review UX Improvements

> **For agentic workers:** Use the executing-plans / subagent-driven-development
> workflow to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`)
> syntax for tracking. Read the whole phase before starting it; honor the
> **Guardrails** in each phase. Update the status row in `docs/plans/README.md`
> when a phase lands.
>
> **Drift check (run first):**
> `git diff --stat 3fdad32..HEAD -- backend/src frontend/src/renderer/src`
> If any in-scope file changed since this plan was written, re-verify the cited
> line numbers against live code before editing.

## Status

- **Priority**: P1 (Phases 1–2), P2 (Phase 3), P3 (Phases 4–5)
- **Effort**: L overall (phased; each phase independently shippable)
- **Risk**: LOW (Phase 1), MEDIUM (Phases 2–3 change analysis output), MEDIUM-HIGH (Phase 4 new product contract)
- **Depends on**: none to start; Phase 4 builds on Phase 2
- **Category**: quality + UX
- **Planned at**: commit `3fdad32`, 2026-06-15
- **Progress (2026-06-15)**: All phases landed. Backend 160 tests green,
  frontend typecheck clean. Final two carve-outs closed:
  - **3.1 rotation (done):** `fit_rotation_degrees` recovers per-frame rotation
    from the vidstab local-motion field (least-squares about the centroid),
    `parse_trf` populates `da`, and `turn_rates_for_samples` feeds real turn
    rate into scoring — re-enabling the `candidate_runs` filter, slow-mo gate,
    and `build_reason`. *Manual calibration of `max_turn_rate_deg_per_sec`
    (12.0) and the 3°/s slow-mo gate against real footage still recommended.*
  - **4.2 (done):** the three profiles now parameterise clip-length range,
    `max_clips_per_scene` (99 / 2 / 1), `speed_policy`, and `ordering`, applied
    at draft time so profile switches re-draft instantly. No new named profiles
    (existing three enriched, per decision).

## Why this matters

A real 3-video analysis run (2026-06-15, ~5 min — speed is now good) surfaced
that the *output* quality, not the runtime, is the weak link:

1. **Clips feel random / "cut from the start."** Candidate clips are chopped on
   a uniform 15s grid anchored to wherever a smooth run happens to begin, and
   detected **scene boundaries are computed but never used** to choose cut
   points. Default ranking is purely technical (no visual interest), so nothing
   optimizes for "interesting."
2. **Stability scoring is crude.** Smoothness — the single highest-weighted
   metric (0.60) — is `mean(cv2.absdiff)` between sampled frames, which
   conflates subject motion, exposure changes, and scene cuts with camera
   shake. Meanwhile `vidstabdetect` already runs every analysis and writes a
   `.trf` motion file that is **thrown away** — a free, better signal.
3. **Review flow is confusing.** Profile/target selections reset on tab-switch,
   reopening a project can drop review decisions, clip cards are hard to read,
   and there's no way to tell which videos were already analyzed in a batch.
4. **Bugs:** Rescan never removes files deleted from the folder.

The throughline: the pipeline already *computes* the data needed for a much
better edit (scene boundaries, motion transforms, per-frame scores) and then
discards most of it. Several high-impact wins therefore cost **no extra
processing time**.

## Investigation findings (evidence)

All confirmed by reading the code at commit `3fdad32`:

- **Smoothness formula:** `quality_scoring.py:22-27` (`smoothness = clamp(10 - motion_magnitude)`, rotation penalty only > 6°/s); `motion_magnitude` from `cv2.absdiff` at `quality_scoring.py:117`; weight 0.60 at `scoring_weights.py:1-6`.
- **`.trf` unused:** written `api.py:459-463`, never read anywhere. On ffmpeg 8.x it is the binary `TRF1` format (per-frame *local* motion fields). Detection compute is already paid for → parsing is ~zero added runtime. The separate optical-flow rotation pass (`quality_scoring.py:82-95`) could be retired for a net time *saving*.
- **Cuts ignore scenes:** `candidate_runs` (`clip_assembly.py:52-70`) groups smooth runs; `split_by_duration` (`clip_assembly.py:35-49`) chops them into fixed `max_clip_duration` chunks from each run's start; `make_clip` (`clip_assembly.py:82-104`) sets start/end to the chunk's first/last frame. `scene_id` is stamped onto frames (`api.py:494-495`) but **never read** in `clip_assembly.py`.
- **Speed never varied:** `suggested_speed=1.0` hardcoded (`clip_assembly.py:101-102`); `export_engine.py:70-160` never reads it (no retime emitted).
- **`visual_interest_score` = 0.0** in the default path (`clip_assembly.py:98`) unless the AI harness runs.
- **Rescan additive-only:** `rescan_project` (`project_store.py:130-154`) only appends new files and early-returns when none are new (lines 142-143); deletions never pruned. Frontend already replaces state correctly (`ReviewContext.tsx:219-232`).
- **Review reset:** `profile`/`targetDuration` are local `useState` in `Review.tsx:96-98` (lost on unmount, re-seeded from recommendation at `Review.tsx:100-104`); decisions live in context but are dropped on reopen when `getSavedTimeline` returns null for string-id timelines (`client.ts:285-298`, `ReviewContext.tsx:108-118`).

---

## Phase 1 — Workflow correctness & visibility (quick wins, no extra runtime)

**Goal:** Stop the obviously-wrong behaviors and make batched analysis legible.
All low-risk, UI/state/manifest only.

**Guardrails:** No changes to the analysis algorithm. Add/adjust tests beside
each fix.

### Task 1.1 — Rescan prunes files deleted from the folder
**Files:** `backend/src/project_store.py`, `backend/tests/test_project_store.py`
- [x] Add a failing test: manifest with two source videos, delete one from disk, `rescan_project` → manifest has only the remaining one.
- [x] Rewrite `rescan_project` (`project_store.py:130-154`) to **reconcile** against `scan_source_video_filenames`: keep existing entries whose file is still on disk, append new ones, drop vanished ones. Remove the "no new files → early return" short-circuit so pure deletions persist.
- [x] Confirm `videos_from_manifest` (`api.py:780-803`) + `ReviewContext.rescanOpenProject` (`ReviewContext.tsx:219-232`) then drop the rows (frontend already replaces state).
- [x] Run backend tests.

### Task 1.2 — Persist Review selections across navigation & reopen
**Files:** `frontend/src/renderer/src/state/ReviewContext.tsx`, `frontend/src/renderer/src/routes/Review.tsx`, `frontend/src/renderer/src/api/client.ts`
- [x] Move `profile` and `targetDuration` from `Review.tsx:96-98` local state into `ReviewContext` (next to `smoothnessThreshold`, `ReviewContext.tsx:146`); seed from `recommendation` in the context, not a component effect.
- [x] Fix reopen-restore: make `getSavedTimeline` (`client.ts:285-298`) also restore object decisions when the saved timeline carries them (or have the backend always persist object-form entries), so `useProjectHydration` (`ReviewContext.tsx:108-118`) rehydrates included/excluded + order.
- [x] Add an E2E/regression: pick a non-default profile, switch to Timeline and back → selection retained; reopen project → decisions restored.

### Task 1.3 — Show which videos are already analyzed (batched analysis)
**Files:** `frontend/src/renderer/src/routes/Import.tsx`, `frontend/src/renderer/src/state/ReviewContext.tsx` (read `clips`), optionally `backend/src/api.py` (expose analyzed `file_id`s)
- [x] Derive the set of analyzed `file_id`s from the project's `clips` (each clip carries `file_id`); a video is "analyzed" if it has ≥1 clip.
- [x] Add an **Analyzed** indicator column/badge in the Import source table (e.g. ✓ Analyzed / — Not analyzed), sortable alongside Size/Date.
- [x] On load, **default the selection to un-analyzed videos** so re-running analysis on a folder naturally targets the new batch; user can still re-check analyzed ones.
- [x] (Optional) Persist `analyzed_at` per video in the manifest for robustness across reopen; otherwise derive from `results.json` clips.

### Task 1.4 — Fix Timeline left-edge trim visual behavior
**Files:** `frontend/src/renderer/src/components/Timeline.tsx`, `frontend/e2e/timeline-playback.spec.ts`
- **Bug:** Dragging a clip's **left** handle does not move the left edge to the right — the left edge stays put and the right edge contracts instead, so a left-trim looks/behaves identical to a right-trim.
- **Root cause:** The trim math is correct (`Timeline.tsx:470-475` updates `start_sec`), but each block is positioned by a cumulative `offset` (sum of preceding clips' durations) and rendered as `left: offset, width: duration` (`Timeline.tsx:99-109`). The block's left edge is pinned to `offset`, independent of this clip's `trimStart`, so increasing `start_sec` only shrinks `duration` (the width) → the right edge moves in, the left edge never moves.
- [x] Add failing E2E coverage: drag the left handle inward and assert the block's left edge moves right (and the right edge / following clips hold position appropriately), distinct from a right-trim.
- [x] Make the dragged edge track the pointer: render the left edge from `trimStart` (or apply a live left-trim delta to the block's `left` and `width`) so left-trim shortens from the left and right-trim shortens from the right. Reposition subsequent segments consistently after commit.
- [x] Verify trims still round-trip to the backend timeline and survive reopen.

**Phase 1 verification:** backend suite green; frontend typecheck + build; Playwright timeline trim coverage; manual: delete a file + rescan removes it; analyzed badges correct after a partial-batch run; left/right trim each shorten from their own edge.

---

## Phase 2 — Composition quality (reuse scene data, no extra runtime)

**Goal:** Make cuts land on natural scene boundaries, pick the *best* moment in
each scene, and spread selection across scenes — directly addressing "random /
cut from start." All inputs (`scene_id`, per-frame `overall_score`) already
exist, so **no added processing time.**

**Guardrails:** Keep the existing `AssemblyPreferences` thresholds working.
Update `backend/tests/test_clip_assembly.py` for each change. Re-run
`scripts/synthetic_e2e_qa.py`.

### Task 2.1 — Anchor cut points to scene boundaries
**Files:** `backend/src/clip_assembly.py`, `backend/tests/test_clip_assembly.py`
- [x] In `candidate_runs`/`split_by_duration` (`clip_assembly.py:35-70`), split runs wherever `scene_id` changes so no clip straddles a scene boundary.

### Task 2.2 — Pick the highest-scoring window within each scene
**Files:** `backend/src/clip_assembly.py`, tests
- [x] Replace fixed-from-start chunking with a sliding window of target length that maximizes mean `overall_score` within each scene segment (`clip_assembly.py:82-104`). Kills the "cut from start" feel.

### Task 2.3 — Scene diversity / dedupe
**Files:** `backend/src/clip_assembly.py`, `backend/src/assembly_profiles.py`, tests
- [x] Cap clips per `scene_id` (profile-tunable, e.g. 1–2) in selection (`clip_assembly.py:124-131`) so the timeline isn't dominated by one long smooth scene.

### Task 2.4 — Varied clip lengths for rhythm
**Files:** `backend/src/assembly_profiles.py`, tests
- [x] Let profiles emit a length *range* / alternation (punchy vs. breathing) instead of one `preferred_max_sec` (`assembly_profiles.py:35-69`), for smaller cuts and pacing.

**Phase 2 verification:** new assembly tests green; synthetic E2E passes; manual A/B on real footage — cuts land on scene changes, varied lengths, no single-scene domination.

---

## Phase 3 — Stability scoring upgrade (near-zero added runtime)

**Goal:** Replace/blend the `absdiff` smoothness proxy with real camera-motion
data from the already-generated `vidstabdetect` output. Improves the
0.60-weighted metric with ~no extra time.

**Guardrails:** Keep `smoothness_score`/`motion_stability` on the same 0–10
scale so `clip_assembly` thresholds keep working. Calibrate against a few known
smooth vs. shaky clips before committing constants.

### Task 3.1 — Parse vidstab transforms into a jitter-based stability score
**Files:** `backend/src/motion_analysis.py` (parser), `backend/src/quality_scoring.py`, `backend/src/api.py` (wire transforms into scoring), `backend/tests/`
- [x] Add `parse_trf(path) -> List[FrameTransform(t, dx, dy, da, zoom)]`. ffmpeg 8.x writes binary `TRF1` (aggregate local motions via median for dx/dy, fit rotation `da`). Simpler alternative: switch `build_vidstabdetect_command` to emit ASCII transforms (still single pass, still ~zero added runtime) → trivial line parser. Decide and document which.
- [x] Map magnitude → 0–10 stability. Prefer a **jerk/derivative** formula (penalize frame-to-frame *change* in dx/dy/da) so smooth pans stay high and vibration scores low; normalize translation by `VIDSTAB_ANALYSIS_WIDTH` for resolution-independence.
- [x] Align transforms to extracted samples by timestamp and feed into `normalize_frame_metrics` in place of (or blended with) `10 - motion_magnitude`.
- [x] Retire the optical-flow `estimate_rotation_degrees` pass (`quality_scoring.py:82-95`) — vidstab supplies rotation; net time saving.
- [x] Validate ranking on real footage vs. the old score; tune constants.

**Phase 3 verification:** scoring tests green; synthetic E2E passes; manual — shaky clips rank below smooth ones more reliably than before; total analysis time unchanged or lower.

---

## Phase 4 — Editor profiles & dynamic edits (new product contract)

**Goal:** Let the user choose an **editor profile** that produces a genuinely
interesting edit (varied cuts, speed ramps, scene-aware pacing) rather than
plain start-cuts. Builds on Phase 2.

**Guardrails:** New behavior must be opt-in per profile and reversible in
Review. Speed only ships once export actually applies it (otherwise it's a
no-op like today).

### Task 4.1 — Speed variation end-to-end
**Files:** `backend/src/clip_assembly.py`, `backend/src/export_engine.py`, tests
- [x] Set `suggested_speed` by heuristic (e.g. slow-mo for very-smooth/low-turn clips) instead of hardcoded 1.0 (`clip_assembly.py:101-102`).
- [x] Make `export_engine` emit retime so speed is real in DaVinci/FCPXML/EDL (`export_engine.py:70-160`) — currently ignored. This is the bulk of the work.

### Task 4.2 — Richer selectable editor profiles
**Files:** `backend/src/assembly_profiles.py`, `frontend/src/renderer/src/routes/Review.tsx` (or Import), tests
- [x] Define profiles (e.g. Punchy Social, Cinematic, Scenic) parameterizing cut-length range, scene density, speed policy, ordering. Surface selection prominently and re-draft on change. *(Existing three profiles enriched with `max_clips_per_scene`/`speed_policy`/`ordering` in `assembly_profiles.py`; selector + re-draft already in `Review.tsx`. No new profile names added, per decision.)*

### Task 4.3 — Default visual-interest heuristic (non-AI path)
**Files:** `backend/src/quality_scoring.py`, tests
- [x] Add a cheap composition/edge-energy/saliency heuristic so `visual_interest_score` isn't 0 without the AI harness (`clip_assembly.py:98`). **Note: adds a per-frame CV pass — measure the time cost** and gate behind a preference if material.

**Phase 4 verification:** export round-trips speed into Resolve; profile switch produces visibly different edits; visual-interest pass time measured and acceptable.

---

## Phase 5 — Review UX overhaul

**Goal:** Make the Review board legible and the Review↔Timeline flow coherent.

### Task 5.1 — Clip card redesign
**Files:** `frontend/src/renderer/src/components/ClipCard.tsx`, `frontend/src/renderer/src/routes/Review.tsx`, styles
- [x] Replace ambiguous boxes with cards showing a **poster thumbnail** (not a live `<video>` per card — addresses the known N×4K jank deferred from the 2026-06-10 QA), source file, scene #, time range, duration, and legible score chips with the AI reason.

### Task 5.2 — Coherent Review↔Timeline state & flow
**Files:** `frontend/src/renderer/src/state/ReviewContext.tsx`, `Review.tsx`, `Timeline.tsx`
- [x] Ensure included/excluded, order, trims, profile, and target are one shared source of truth across both tabs (completes Phase 1.2). Returning to Review reflects Timeline edits, never resets.

**Phase 5 verification:** Playwright coverage for card content + cross-tab state; manual flow review.

---

## Sequencing & dependencies

- **Phase 1** first — cheap, high-annoyance fixes; unblocks confident testing.
- **Phase 2** next — biggest quality-per-effort, no runtime cost, no new contracts.
- **Phase 3** independent of 2; schedule by appetite (medium parser effort).
- **Phase 4** depends on Phase 2 (profiles/pacing) and is the largest slice.
- **Phase 5** can run in parallel with 2–3 (frontend-only) but 5.2 completes 1.2.

## Out of scope / deferred

- Music beat-sync, multi-track, color grading (PRD Phase-2; revisit after core edit quality lands).
- Full `.app`/DMG packaging with bundled backend (tracked separately: `003-backend-packaging-spike.md`).
