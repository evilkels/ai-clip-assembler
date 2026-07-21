# Plan 014: Extract Timeline lifecycle coordination from the API module

Status: DONE (2026-07-09) in `1c88a22`. Executor verification: 94 focused
tests, 6 lifecycle tests, 355 full-suite passes (4 OpenCV skips), and ruff
clean. Priority P1, effort M, risk MED; planned at `cca2c3b`, after plan 011.

## Goal and decision

Move Timeline Document reconstruction, controller caching, durable-write
callbacks, snapshots, and event publication out of `api.py` while keeping GUI
and MCP on one backend-authoritative Timeline Document and Operations core.

`TimelineLifecycle` in `timeline_service.py` owns controller state and the
`TimelineEventBroker`. Its interface covers controller lookup, invalidation,
snapshots, subscribe, and unsubscribe. Dependencies enter as callables; the
module contains no FastAPI imports. `api.py` remains the HTTP/SSE adapter and
preserves response JSON, conflicts, undo/redo, and event names.

## Scope and invariants

- Timeline Operation semantics stay in `timeline_ops.py`; persistence stays in
  `project_store.py`; MCP schemas, review logic, frontend, and project formats
  were not changed.
- A changed Timeline Document is persisted before `timeline-changed` publishes.
- Invalidating one project cannot evict another project's controller; lookup
  rebuilds from the stored or migrated document.
- The next decomposition seam is review/proposal coordination or project
  repository/write policy—not more unrelated ownership in this module.

## Verification

`cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_timeline_service.py tests/test_api.py -q && PYTHONPATH=. .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`
