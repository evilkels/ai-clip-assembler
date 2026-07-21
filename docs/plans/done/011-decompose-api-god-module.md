# Plan 011: Decompose api.py — extract the analysis pipeline into a service layer (slice 1)

**Status: DONE** — slice 1 scope completed 2026-07-02, re-verified 2026-07-21 at `9a6d56a`. Planned at commit `412ffc3`, 2026-06-28.

## Why this matters

`backend/src/api.py` was 1679 lines: 32 routes, a 250-line analysis pipeline, timeline-controller lifecycle, MCP wiring, review endpoints, and ~34 direct mutations of a module-global `projects` dict. Business logic and HTTP routing were fused, blocking unit-testing of the pipeline in isolation. This plan deliberately extracted **only** the analysis pipeline (largest, most self-contained block) into `analysis_service.py`, behind an unchanged `/analyze` route — with characterization tests written *first* to pin behavior before any code moved.

## What was decided

- New `analysis_service.py`: plain functions, **zero FastAPI imports** (the whole point of the seam) — takes project state + request as arguments, returns results for `api.py` to store, rather than reaching into the `projects` global directly. Cancellation/progress passed in as injected callables (`check_cancelled`, `set_progress`).
- The `projects` global itself was deliberately **not** wrapped in a repository in this slice — kept out of scope to limit risk (api.py is the central coordination point; every route and most tests touch it → HIGH risk).
- Storage/persistence (`persist_project_results`) stays at the route layer, not pushed into the service.

## Status / follow-ups

- Slice 1 (analysis service): done.
- Slice 2 (timeline-controller lifecycle → `timeline_service.py`): completed separately as **Plan 014**.
- Remaining, explicitly NOT bundled into this archived plan: (3) review/proposal routes → `review_service.py`; (4) wrap `projects` global in a typed repository — this is where the previously-found issues ARCH-04/05 (write-policy + crash-safety between mutate and `persist_project_results`, swallowed `OSError` in the timeline on-change callback at `api.py:~850`) belong.

## Gotcha

Characterization tests (`test_analysis_service.py`) were required to pass against the *current* (pre-extraction) code before any code moved — if they couldn't, that would mean the assumed behavior was wrong and the move should stop. Backend suite grew from 321 to 364 passed tests over the slice's lifetime; ruff gate (line length 100, `api.py` exempt from E402 but the new service module is not) also verified clean.
