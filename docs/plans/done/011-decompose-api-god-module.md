# Plan 011: Decompose api.py — extract the analysis pipeline into a service layer (first slice)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `docs/plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 412ffc3..HEAD -- backend/src/api.py backend/tests/test_api.py`
> If `api.py` changed, re-read the line ranges below against the live code
> before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Status**: DONE — this plan's slice 1 scope completed 2026-07-02 and was
  re-verified 2026-07-21 at `9a6d56a`. Analysis lives in
  `analysis_service.py`; timeline lifecycle later completed as Plan 014.
  Review/proposal extraction and a projects repository/write-policy remain
  separate future slices, not unfinished work in this archived plan.
- **Priority**: P1
- **Effort**: L (do it in slices; this plan is **slice 1 only**)
- **Risk**: HIGH (api.py is the central coordination point; every route and most tests touch it)
- **Depends on**: none (but do Step 1 — characterization tests — before any move)
- **Category**: tech-debt / architecture
- **Planned at**: commit `412ffc3`, 2026-06-28

## Why this matters

`backend/src/api.py` is 1679 lines: 32 routes, a 250-line analysis pipeline,
the timeline-controller lifecycle, MCP wiring, review endpoints, and ~34 direct
mutations of a module-global `projects` dict. Business logic and HTTP routing
are fused, so the pipeline cannot be reused or unit-tested in isolation, and any
change risks the HTTP contract. This plan extracts the **analysis pipeline**
(the largest, most self-contained block) into a dedicated service module behind
an unchanged route, with characterization tests pinning behaviour first. It is
deliberately **one slice** — timeline, review, and the `projects`-dict
repository are later slices, not this plan.

## Current state

- `backend/src/api.py:375-432` — `@app.post("/projects/{id}/analyze")` route
  (`analyze_videos`) and its request validation; kicks off background analysis.
- `backend/src/api.py:462-712` — `run_analysis_pipeline(project_id, request)`:
  the ~250-line orchestration (frame extraction → scene detection → scoring →
  optional Pi enhancement → ranking → timeline recommendation → persistence).
  It mutates `projects[project_id]["clips"]`, `["timeline"]`, `["harness_id"]`
  (around lines 663-665) and calls `persist_project_results(project_id)`.
- `backend/src/api.py:434-444` — `selected_videos(project_id, request)` helper.
- `backend/src/api.py:759-776` — `enrich_clips_with_source_metadata(project)`.
- Module globals near `api.py:102`: `projects = {}` and the progress/cancel
  helpers `_check_cancelled` (131), `_make_cancellable_runner` (137),
  `set_analysis_progress` (353).
- Tests: `backend/tests/test_api.py` exercises analysis end-to-end via the
  FastAPI `TestClient`, mostly by monkeypatching the expensive leaf functions
  (`run_vidstabdetect`, `detect_scenes`, `extract_frames`). There is **no**
  direct unit test of `run_analysis_pipeline`.

Conventions to match:
- Pydantic models live in `backend/src/models.py`; domain helpers are plain
  modules (e.g. `clip_assembly.py`, `quality_scoring.py`) imported by `api.py`.
  Follow that — a new `analysis_service.py` sibling, plain functions/class, no
  FastAPI imports inside it.
- Use `UBIQUITOUS_LANGUAGE.md` terms in names/comments: Source Video, Scene,
  Frame Sample, Candidate Clip, Timeline Document.
- ruff config: `backend/pyproject.toml` (line length 100; `src/api.py` is
  exempt from E402 — the new module is **not** exempt, keep imports at top).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py -q` | `321 passed` (more after Step 1) |
| One test file | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -q` | all pass |
| Lint | `cd backend && .venv/bin/ruff check src tests` | `All checks passed!` |

## Scope

**In scope**:
- `backend/src/analysis_service.py` (create)
- `backend/src/api.py` (delete the moved code; call the service)
- `backend/tests/test_analysis_service.py` (create — characterization + unit)
- `backend/tests/test_api.py` (only if a test referenced a now-moved private symbol)

**Out of scope** (do NOT touch — these are later slices):
- Timeline controller lifecycle (`api.py:804-967`), MCP wiring (`api.py:967-1028`),
  review/proposal routes (`api.py:1028-1190`).
- The `projects` global itself — keep it where it is; the service receives the
  project state it needs as arguments and returns results for `api.py` to store.
  Do **not** introduce a repository class in this slice.
- Any change to the `/analyze` request/response shape or status-polling contract.
- Frontend.

## Git workflow

- Branch: `advisor/011-extract-analysis-service` (or continue the session branch).
- Conventional commits; one commit for tests (Step 1), one for the extraction.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Characterization tests FIRST (pin current behaviour)

Before moving anything, write `backend/tests/test_analysis_service.py` that
drives `run_analysis_pipeline` (import it from `src.api` for now) with the
expensive leaves monkeypatched, modelled on the existing patterns in
`test_api.py` (find a test that monkeypatches `extract_frames` / `detect_scenes`
and reuse its fixtures). Assert the observable outputs:
- the returned dict's keys and a stable clip count for a fixed fake input,
- that `projects[project_id]["clips"]` and `["timeline"]` are populated,
- that `harness_id` is recorded,
- the recommended profile for a known total duration.

**Verify**: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_analysis_service.py -q` → new tests pass. Commit here.

### Step 2: Create `analysis_service.py` with the pipeline as a pure-ish function

Move the body of `run_analysis_pipeline` (and its private helpers
`selected_videos`, `enrich_clips_with_source_metadata`, and any analysis-only
helpers it calls that `api.py` does not otherwise need) into
`analysis_service.py`. The service function should **take the project state and
request as arguments and return the result + the clips/timeline to store**,
rather than reaching into the `projects` global. Keep cancellation/progress as
injected callables (pass `check_cancelled` and `set_progress` functions in) so
the service has no FastAPI dependency.

Target signature (adapt to what the body actually needs):
```python
def run_analysis_pipeline(
    project: dict,
    request: AnalysisRequest,
    *,
    check_cancelled: Callable[[], None],
    set_progress: Callable[..., None],
) -> AnalysisResult:  # a small dataclass/dict: clips, timeline, harness_id, per_video, timings
    ...
```

**Verify**: `cd backend && .venv/bin/ruff check src` → passes (no E402 in the new module).

### Step 3: Make `api.py` call the service

In `api.py`, replace the moved body with a thin call: build the
`check_cancelled` / `set_progress` closures (they already exist as
`_check_cancelled` / `set_analysis_progress`), call
`analysis_service.run_analysis_pipeline(...)`, then perform the
`projects[project_id][...] = ...` assignments and `persist_project_results`
in `api.py` (storage stays at the route layer in this slice). Keep the
`/analyze` route signature and background-task wiring identical.

**Verify**: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py tests/test_analysis_service.py -q` → all pass.

### Step 4: Repoint the characterization tests at the new home

Update `test_analysis_service.py` to import from `src.analysis_service`. If any
test in `test_api.py` imported a now-moved private helper, repoint it.

**Verify**: full suite (Done criteria).

## Test plan

- `test_analysis_service.py`: the Step 1 characterization tests, now importing
  the service directly; add unit cases that were awkward end-to-end — empty
  video list, all-frames-below-threshold, a cancellation raised mid-pipeline
  (assert it propagates), profile recommendation boundaries.
- Pattern to follow: the monkeypatch + fixture style already in `test_api.py`.
- `api.py` behaviour is covered by the unchanged `test_api.py` end-to-end tests
  — they are the contract guard that the extraction changed nothing observable.

## Done criteria

ALL must hold:
- [x] `backend/src/analysis_service.py` exists and has no FastAPI route coupling.
- [x] `api.py` delegates analysis orchestration to the service.
- [x] Backend tests pass (364 passed on 2026-07-21).
- [x] Backend ruff gate passes.
- [x] `/analyze` retained its HTTP contract at delivery.
- [x] Delivery stayed within the planned source scope plus plan bookkeeping.
- [x] `docs/plans/README.md` records the completed slice and later follow-ups.

## STOP conditions

Stop and report (do not improvise) if:
- The pipeline body has hidden reads of module globals other than `projects`
  and the progress/cancel helpers (e.g. it mutates timeline-controller state) —
  that means the seam is not clean; report what it touches rather than dragging
  out-of-scope code along.
- Extracting `selected_videos` / `enrich_clips_with_source_metadata` reveals
  they're shared with non-analysis routes — leave them in `api.py` and import
  back, and note it.
- The characterization tests can't be made to pass against the *current* code
  (Step 1) — the behaviour isn't what this plan assumes; report before moving code.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This plan was **slice 1**. Slice 2, timeline-controller lifecycle →
  `timeline_service.py`, completed as Plan 014. Remaining work must use
  separate future plans (do NOT bundle it back into this archive):
  (3) review/proposal routes → `review_service.py`;
  (4) wrap the `projects` global in a repository with typed accessors once the
  services exist (the find ARCH-04/05 — write-policy + crash-safety between
  mutate and `persist_project_results`, and the swallowed `OSError` in the
  timeline on-change callback at `api.py:~850`, belong to that slice).
- **Reviewer focus**: confirm the `/analyze` end-to-end tests are unchanged and
  green (they prove no behaviour drift); confirm the service has zero FastAPI
  imports (the whole point of the seam).
