# Plan 001: Instrument analysis timing and produce the real-footage validation runbook

**Status**: DONE (2026-06-11). **Planned at:** commit `6a39ed1`, 2026-06-10.

## Why this matters

The app has a written acceptance bar (`docs/plans/drone-workflow-qa-flows.md`) with three pass/fail criteria — speed (folder → Review Board in <15 min for 30 min of 4K/60fps), signal (≥70% recall vs. manual ground truth), DaVinci handoff (zero relink prompts) — none ever measured on real footage. This plan did the two parts a coding agent could do: (a) add per-phase timing telemetry to the analysis pipeline so a QA run captures hard numbers without a stopwatch, and (b) write a self-contained validation runbook so the human session is pure execution. **The actual footage runs, ground-truth judging, and DaVinci import checks were explicitly out of scope** — a human task, not delegable.

## What was decided / built

- Per-phase timings (`motion_analysis_sec`, `frame_extraction_sec`, `scene_detection_sec`, `assembly_sec`, `ai_scoring_sec`, `video_total_sec`) added inside `run_analysis_pipeline`'s per-video loop in `backend/src/api.py`, plus `pipeline_total_sec`. Surfaced both in the `/analyze` response and via the status-polling endpoint (so timings are visible after completion, not just via response body).
- Deliberately **not** persisted to `results.json`/`project_store.py` — timings are per-run diagnostics, not project state.
- Did not duplicate the existing per-clip AI timing already recorded by the pi harness (`pi_cli_harness.py`); this plan covers only the other phases plus totals.
- `docs/VALIDATION_RUNBOOK.md` created: purpose, prerequisites (`~/Footage/QA/{small-set,realistic-set,stress-set}` dataset layout), how to pull timings via `curl .../analyze/status`, condensed Flow A/C/D procedures (adapted from `drone-workflow-qa-flows.md`), and a fill-in report template. Reports are stored under `~/Footage/QA/runs/<date>/REPORT.md`, **never committed to the repo**.

## Gotchas / invariants

- Analysis currently runs synchronously in a worker thread (`api.py:284-287`); if it later becomes async/queued, timing capture must move with it.
- Timing capture must add no behavior change on error paths — exceptions still propagate and set `phase="error"`.
- The runbook's REPORT.md numbers were meant to decide the next roadmap move (speed failure → optimize pipeline; signal failure → harness/scoring work; handoff failure → export bug) — whether that human session ran and what it found is not recorded in this plan.
