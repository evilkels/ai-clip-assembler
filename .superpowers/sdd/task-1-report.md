# Task 1 Report: Runtime Descriptor And Active Project

## Status

DONE

## Scope completed

- Added `backend/src/runtime_descriptor.py` with:
  - `RuntimeDescriptor`
  - `resolve_runtime_file`
  - `read_runtime_descriptor`
  - `write_runtime_descriptor`
  - `set_active_project`
- Updated `backend/src/api.py` to:
  - write the runtime descriptor on backend startup
  - track `_active_project_id`
  - expose `POST /projects/{project_id}/activate`
  - clear the active project in the runtime descriptor when deleting the active folder project
- Added focused runtime descriptor tests in `backend/tests/test_runtime_descriptor.py`
- Added focused activation endpoint tests in `backend/tests/test_api.py`
- Checked off Task 1 steps in `docs/plans/connect-your-ai-mcp.md`

## Red/green evidence

### Runtime descriptor tests: red

Command:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_runtime_descriptor.py -v
```

Observed failure:

- `ModuleNotFoundError: No module named 'src.runtime_descriptor'`

### Activation endpoint tests: red

Command:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py::test_activate_project_records_runtime_descriptor tests/test_api.py::test_activate_missing_project_returns_404 -v
```

Observed failures:

- `POST /projects/{project_id}/activate` returned `404`
- missing-project detail was FastAPI's route-level `"Not Found"` because the endpoint did not exist yet

### Runtime descriptor tests: green

Command:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_runtime_descriptor.py -v
```

Result:

- `4 passed`

### Activation endpoint tests: green

Command:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py::test_activate_project_records_runtime_descriptor tests/test_api.py::test_activate_missing_project_returns_404 -v
```

Result:

- `2 passed`
- warnings only:
  - existing `python_multipart` pending deprecation warning from Starlette
  - FastAPI `@app.on_event("startup")` deprecation warning

## Commit

- `248477781a349e2ed23b58720725783a69a5507a` — `feat(api): track runtime descriptor`

Commit body trailer included exactly as required:

```text
Co-Authored-By: Claude Opus 4.8
```

## Notes

- Implementation kept to Python 3.9-compatible typing (`Optional[...]`), with no runtime `X | Y` unions.
- No scoring behavior was added.
- Timeline authority remains in the existing backend/app flow; this task only records runtime state for later MCP bridge consumers.

## Review follow-up fixes

- Added a focused runtime descriptor regression test covering `set_active_project(...)` updating `runtime.json` while preserving the existing `port` and `pid`.
- Added a focused API regression test covering activation of a folder project followed by `DELETE /projects/{project_id}/files`, asserting the runtime descriptor clears `active_project_id`.
- Rewired API active-project mutations to call `set_active_project(...)` instead of duplicating runtime update behavior via `_write_runtime(...)`.

### Follow-up verification

Command:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest \
  tests/test_runtime_descriptor.py \
  tests/test_api.py::test_activate_project_records_runtime_descriptor \
  tests/test_api.py::test_activate_missing_project_returns_404 \
  tests/test_api.py::test_delete_active_folder_project_clears_runtime_descriptor -v
```

Result:

- `8 passed`
- warnings only:
  - existing `python_multipart` pending deprecation warning from Starlette
  - existing FastAPI `@app.on_event("startup")` deprecation warning
