# Plan 001: Instrument analysis timing and produce the real-footage validation runbook

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a39ed1..HEAD -- backend/src/api.py backend/tests/test_api.py docs/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

The app has a written acceptance bar (`plans/product/drone-workflow-qa-flows.md`) with three pass/fail criteria — speed (folder → Review Board in <15 min for 30 min of 4K/60fps), signal (≥70% recall vs. manual ground truth), and DaVinci handoff (zero relink prompts) — and none of them has ever been measured on real footage. Every other roadmap bet (settings, packaging, harness work) is speculative until these numbers exist. This plan does the two parts a coding agent *can* do: (a) add per-phase timing telemetry to the analysis pipeline so a QA run captures hard numbers without a stopwatch, and (b) write a self-contained validation runbook + report template so the human session is pure execution. The actual footage runs are explicitly out of scope for the executor (see STOP conditions).

## Current state

Relevant files:

- `backend/src/api.py` — FastAPI entry point. `run_analysis_pipeline` (line 327) runs, per video: vidstab motion analysis → frame extraction → scene detection → rule-based scoring/assembly → optional pi AI scoring. Progress is tracked via `set_analysis_progress` (line 262) and exposed at `GET /projects/{project_id}/analyze/status` (line 270), which already computes `elapsed_sec` from `started_at`. **No per-phase durations are recorded anywhere** — only log lines mark phase transitions.
- `backend/tests/test_api.py` — API tests using FastAPI's TestClient with monkeypatched ffmpeg-heavy functions. Exemplar: `test_analyze_folder_project_writes_work_files_under_clipassembler` (line 139) — copy its monkeypatch pattern for stubbing `run_vidstabdetect`, `extract_frames`, `detect_scenes`.
- `plans/product/drone-workflow-qa-flows.md` — defines Flows A–E with pass criteria and the Flow D recall/precision formulas. The runbook in step 3 operationalizes this doc; it does not replace it.
- `docs/MANUAL_QA_GUIDE.md` — how to launch the app for manual QA. Reference it from the runbook, don't duplicate it.

Excerpt — progress tracking as it exists today (`backend/src/api.py:262-281`):

```python
def set_analysis_progress(project_id: str, **fields) -> None:
    progress = projects[project_id].setdefault("analysis_progress", {})
    now = time.time()
    progress.setdefault("started_at", now)
    fields.setdefault("updated_at", now)
    progress.update(fields)


@app.get("/projects/{project_id}/analyze/status")
async def get_analysis_status(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    progress = projects[project_id].get("analysis_progress")
    if not progress:
        return {"phase": "idle"}
    status = dict(progress)
    started_at = status.get("started_at")
    if isinstance(started_at, (int, float)):
        status["elapsed_sec"] = round(max(0.0, time.time() - started_at), 2)
    return status
```

Excerpt — the per-video pipeline phases to time (`backend/src/api.py:333-431`, abridged):

```python
for index, video in enumerate(projects[project_id]["videos"], start=1):
    ...
    run_vidstabdetect(...)            # phase: motion_analysis
    samples = extract_frames(...)     # phase: frame_extraction
    scenes = detect_scenes(...)       # phase: scene_detection
    samples = assign_scene_ids(samples, scenes)
    frame_scores = score_samples_rule_based(samples)
    result = assemble_smooth_clips(...)   # phase: assembly
    if request.harness_id == "pi_agent":
        result, used_ai = enhance_clips_with_pi_cli(...)  # phase: ai_scoring
```

Note: the pi harness already records per-clip AI durations into
`result.metadata["scoring_seconds_per_clip"]` (`backend/src/pi_cli_harness.py:443-444`),
and `run_analysis_pipeline` copies that into `video_metadata`. Do not duplicate
that; the new timing report covers the other phases plus totals.

Repo conventions: Python with type hints where practical, pydantic models in
`backend/src/models.py`, conventional-commit messages (`feat:`, `test:`,
`docs:` — see `git log --oneline`). Docs are plain Markdown under `docs/`.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Backend tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` | all pass, exit 0 |
| Single test file | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -q` | all pass |
| Synthetic e2e | `backend/.venv/bin/python scripts/synthetic_e2e_qa.py` | exits 0, prints pass summary |

## Scope

**In scope** (the only files you should modify or create):
- `backend/src/api.py` — timing capture in `run_analysis_pipeline` / status exposure
- `backend/tests/test_api.py` — new test(s) for the timing report
- `docs/VALIDATION_RUNBOOK.md` (create)
- `plans/README.md` (status row update)

**Out of scope** (do NOT touch, even though they look related):
- `backend/src/pi_cli_harness.py` — per-clip AI timing already exists there; harness changes belong to plan 002.
- `frontend/**` — no UI for timings in this plan; the status endpoint and analyze response are the consumers.
- `backend/src/project_store.py` / `results.json` schema — do not persist timings to disk; they are per-run diagnostics, not project state.
- `plans/product/drone-workflow-qa-flows.md` — the acceptance bar itself stays as-is; the runbook references it.

## Git workflow

- Branch: `feature/validation-instrumentation` (repo convention: `feature/<slug>`, see branch `feature/project-folder-model`)
- Conventional commits, e.g. `feat: record per-phase analysis timings`, `docs: add real-footage validation runbook`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add per-phase timing capture to `run_analysis_pipeline`

In `backend/src/api.py`, inside the per-video loop of `run_analysis_pipeline`
(line 327), wrap each phase with `time.monotonic()` measurements and build a
per-video timing dict. Target shape:

```python
timings: list[dict] = []   # one entry per video, built inside the loop
# per video:
video_timing = {
    "file_name": video["file_name"],
    "motion_analysis_sec": ...,   # around run_vidstabdetect
    "frame_extraction_sec": ...,  # around extract_frames
    "scene_detection_sec": ...,   # around detect_scenes + assign_scene_ids
    "assembly_sec": ...,          # around score_samples_rule_based + assemble_smooth_clips
    "ai_scoring_sec": ...,        # around enhance_clips_with_pi_cli; 0.0 for manual harness
    "video_total_sec": ...,       # sum / wall clock for this video
}
```

Round every value with `round(x, 2)`. After the loop, compute
`pipeline_total_sec` (wall clock for the whole pipeline). Then:

1. Add to the response dict: `response["timings"] = {"per_video": timings, "pipeline_total_sec": pipeline_total_sec}`.
2. Surface the same object via progress so it is visible after completion: in `analyze_videos` (line 284), extend the final `set_analysis_progress(project_id, phase="complete", ...)` call with `timings={...}` — pass the same structure. (`set_analysis_progress` accepts arbitrary `**fields`; no signature change needed.)
3. Log one summary line per run: `logger.info("Analyze timings: total %.1fs, per-video %s", ...)`.

Do not change the existing `set_analysis_progress` phase/step messages, the
response's existing keys, or error handling.

**Verify**: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -q` → all existing tests still pass.

### Step 2: Add a test for the timing report

In `backend/tests/test_api.py`, add
`test_analyze_reports_per_phase_timings(monkeypatch, tmp_path)` modeled
structurally on `test_analyze_folder_project_writes_work_files_under_clipassembler`
(line 139): create a folder project, monkeypatch the ffmpeg-heavy functions,
POST `/projects/{id}/analyze` with `harness_id="manual"`, then assert:

- `response.json()["timings"]["pipeline_total_sec"]` is a number ≥ 0
- `timings["per_video"]` has one entry per source video
- each entry contains all six keys listed in step 1, each a number ≥ 0, and `ai_scoring_sec == 0.0` for the manual harness
- `GET /projects/{id}/analyze/status` after completion contains the same `timings` object

**Verify**: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -q` → all pass including the new test.

### Step 3: Write `docs/VALIDATION_RUNBOOK.md`

Create a self-contained runbook a human can follow in one sitting. It must
contain (inline, not by reference, except where noted):

1. **Purpose**: one paragraph — measure the three success criteria from `plans/product/drone-workflow-qa-flows.md` (quote them: speed <15 min for 30 min of 4K/60fps; recall ≥0.70 vs. manual ground truth; zero DaVinci relink prompts).
2. **Prerequisites**: the `~/Footage/QA/{small-set,realistic-set,stress-set}` dataset layout with `MANIFEST.md` per set (copy the layout block from the qa-flows doc); app launch per `docs/MANUAL_QA_GUIDE.md`; DaVinci Resolve installed; named test machine recorded in the report (hardware baseline is an open question in the qa-flows doc — the runbook makes the machine name a required report field).
3. **How to capture timings**: after an analysis run, `curl -s http://127.0.0.1:8000/projects/<id>/analyze/status | python3 -m json.tool` — the `timings` object added in step 1. State that this replaces stopwatch timing for the speed criterion.
4. **Procedure**: condensed numbered steps for Flow A (cold start), Flow C (portability/relink), and Flow D (signal test) — adapted from the qa-flows doc, including Flow D's ground-truth file (`MANUAL_GROUND_TRUTH.md`), the both-harness run (manual, then `pi_agent`), and the overlap rule ("two clips overlap if their time ranges intersect by ≥50% of either's duration").
5. **Report template**: a fill-in Markdown block with fields: date, git SHA, machine, dataset, per-criterion PASS/FAIL, the `timings` JSON, Flow D recall/precision/surprise-wins/false-positive numbers per harness, and a findings list. Storage location: `~/Footage/QA/runs/<YYYY-MM-DD>/REPORT.md` (never committed to the repo).

**Verify**: file exists and `grep -c '## ' docs/VALIDATION_RUNBOOK.md` → ≥ 5 (one heading per section above).

### Step 4: Full verification pass

**Verify**:
- `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` → all pass
- `backend/.venv/bin/python scripts/synthetic_e2e_qa.py` → exits 0 (confirms the timing changes didn't break the real pipeline path)

## Test plan

- New test in `backend/tests/test_api.py`: `test_analyze_reports_per_phase_timings` (cases listed in step 2: response shape, per-video count, six keys, manual-harness `ai_scoring_sec == 0.0`, status-endpoint exposure).
- Pattern: `test_analyze_folder_project_writes_work_files_under_clipassembler` (`backend/tests/test_api.py:139`).
- Verification: backend pytest command above → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` exits 0; `test_analyze_reports_per_phase_timings` exists and passes
- [ ] `backend/.venv/bin/python scripts/synthetic_e2e_qa.py` exits 0
- [ ] `grep -n '"timings"' backend/src/api.py` returns at least one match in `run_analysis_pipeline`/`analyze_videos`
- [ ] `docs/VALIDATION_RUNBOOK.md` exists with ≥5 `## ` sections
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `run_analysis_pipeline` / `set_analysis_progress` code does not match the excerpts above (drift since `6a39ed1`).
- Backend tests fail before you make any change (broken baseline is not yours to fix here).
- You are tempted to run the actual real-footage flows — **the footage runs, DaVinci import checks, and Flow D judgments are a human task**. This plan ends at instrumentation + runbook. Report the runbook as ready for a human session instead.
- Adding timings appears to require changing the `results.json` schema or `project_store.py` — that's out of scope; surface it as a finding.

## Maintenance notes

- When the human validation session runs, its REPORT.md numbers decide the next roadmap move: speed failure → optimize pipeline (frame extraction and vidstab are the likely hotspots); signal failure → harness/scoring work (see plan 002); handoff failure → export path bug.
- If analysis later becomes async/queued (currently a sync endpoint in a worker thread, `backend/src/api.py:284-287`), the timing capture must move with it.
- Reviewer should check that timing capture adds no behavior change on the error paths (exceptions must still propagate and set `phase="error"`).
- Deferred deliberately: persisting timings into `results.json`, and any UI display of timings.
