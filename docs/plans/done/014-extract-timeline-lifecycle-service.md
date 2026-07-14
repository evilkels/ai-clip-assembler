# Plan 014: Extract Timeline lifecycle coordination from the API module

> **Executor instructions:** Follow this plan step by step and stop if the API contract differs from the excerpts below.
>
> **Drift check:** `git diff --stat cca2c3b..HEAD -- backend/src/api.py backend/src/timeline_service.py backend/tests/test_api.py backend/tests/test_timeline_service.py`.

## Status

- **Status:** DONE (2026-07-09) — lifecycle coordination extracted to `timeline_service.py` (`1c88a22`, executed by Codex in a delegated worktree). Executor verification: focused tests 94 passed, service tests 6 passed, ruff clean, full suite 355 passed (4 skipped for missing OpenCV). Checkboxes below were not ticked by the executor; the report and diff are the record.
- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** `011-decompose-api-god-module.md` (slice 1 complete)
- **Category:** tech-debt
- **Planned at:** commit `cca2c3b`, 2026-07-09

## Why this matters

`backend/src/api.py` still combines HTTP routing with Timeline Document reconstruction, controller caching, durable write callbacks, snapshot construction, and SSE adaptation. Extracting the lifecycle coordination is the next safe seam after the completed analysis-service extraction: GUI and MCP must continue using one backend-authoritative Timeline Document and one Operations core.

## Current state

- `backend/src/api.py:804-905` contains `_timeline_controllers`, `_initial_timeline_document`, `_make_timeline_on_change`, `invalidate_timeline_controller`, `get_timeline_controller`, and `_timeline_snapshot`.
- `backend/src/api.py:927-961` adapts that lifecycle to HTTP document/op/undo/redo and SSE routes.
- `backend/src/timeline_service.py` currently contains only `TimelineEventBroker`; its tests demonstrate async broker behaviour in `backend/tests/test_timeline_service.py`.
- Existing API tests are the HTTP-contract pattern. Timeline operations remain in `timeline_ops.py`; project persistence remains in `project_store.py` and is out of scope.

## Commands

| Purpose | Command | Expected result |
|---|---|---|
| Focused tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_timeline_service.py tests/test_api.py -q` | all pass |
| Full backend suite | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q` | all pass |
| Lint | `cd backend && .venv/bin/ruff check src tests` | `All checks passed!` |

## Scope

**In scope:** `backend/src/timeline_service.py`, `backend/src/api.py`, `backend/tests/test_timeline_service.py`, and only API tests needing import adjustments.

**Out of scope:** `timeline_ops.py` semantics, MCP tool schemas, review-agent logic, project manifest format, frontend code, or changes to any HTTP response shape.

## Steps

### Step 1: Add lifecycle characterization tests

- [ ] Extend `test_timeline_service.py` with a small fake project mapping and fake persistence writer.
- [ ] Test that a service-created controller persists the changed Timeline Document before publishing `timeline-changed`.
- [ ] Test that invalidating a project removes only that controller and that a subsequent lookup rebuilds it from the persisted/legacy document.
- [ ] Run the new tests while they fail because the lifecycle remains in `api.py`.

**Verify:** `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_timeline_service.py -q` fails on the missing service API, not a fixture error.

### Step 2: Introduce a focused lifecycle owner

- [ ] Add `TimelineLifecycle` to `timeline_service.py`. Its constructor receives explicit callables for project lookup, source construction, document load, document write, and candidate listing; it owns controller cache and `TimelineEventBroker`.
- [ ] Give it these methods:

```python
def get_controller(self, project_id: str) -> TimelineController: ...
def invalidate(self, project_id: str) -> None: ...
def snapshot(self, project_id: str, document: TimelineDocument) -> dict: ...
def subscribe(self, project_id: str) -> asyncio.Queue[dict]: ...
def unsubscribe(self, project_id: str, queue: asyncio.Queue[dict]) -> None: ...
```

- [ ] Keep `TimelineEventBroker` transport-agnostic and keep HTTP/FastAPI imports out of `timeline_service.py`.

**Verify:** the new focused tests pass.

### Step 3: Reduce API code to adapters

- [ ] Construct one `TimelineLifecycle` in `api.py` using existing project-store and fingerprint helpers.
- [ ] Replace controller/snapshot/invalidation helpers with thin delegators so existing routes and MCP wiring retain their names and response JSON.
- [ ] Keep the SSE generator in `api.py`; it calls lifecycle `subscribe`/`unsubscribe` and serializes the same event payload.

**Verify:** `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_timeline_service.py tests/test_api.py -q` exits 0.

### Step 4: Guard the public contract

- [ ] Add/retain API tests proving GET document, operation conflict `409` details, undo/redo snapshots, and SSE event name remain unchanged.
- [ ] Run lint and the full backend suite.
- [ ] Report the green commands and commit SHA to the controller; the controller updates `docs/plans/README.md` after merge so parallel plan branches do not conflict.

## Done criteria

- [ ] `api.py` no longer owns a controller dictionary or on-change persistence closure.
- [ ] `timeline_service.py` has no FastAPI import.
- [ ] Focused and full backend suites pass; ruff passes.
- [ ] HTTP and MCP behaviour remains unchanged.

## STOP conditions

- The service needs direct access to FastAPI `Request`, `HTTPException`, or globals other than injected callables.
- The migration would require changing Timeline Operation semantics or persisted project JSON.
- Characterization tests expose a persistence ordering discrepancy not represented in current API tests.

## Maintenance notes

The next API decomposition slice is review/proposal coordination or the projects repository/write-policy, not another move into this service. Keep the lifecycle limited to Timeline Document ownership and publication.
