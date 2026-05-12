# Backend Timeline Workflow Design

## Goal

Extend the FastAPI backend so the real app workflow for testing drone videos can run end-to-end with backend support for project creation, multi-video upload, manual analysis, editable timeline replacement, clip retrieval, and export that respects user-trimmed timeline state.

## PRD Alignment

This change directly supports the PRD's MVP timeline and export requirements:

- ingest multiple MP4 files locally
- analyze footage and produce clip suggestions
- present clips in an interactive timeline for review and adjustment
- let the user adjust cuts and reorder in the timeline
- export assembled timelines to FCPXML or EDL

It also strengthens the documentation goal behind issue `#10` by making the backend workflow testable in a way that matches the intended GUI interaction model, while building on the export correctness work mentioned in issue `#19` without claiming that issue fully complete.

## Current Backend Constraints

The backend currently stores project state in an in-memory `projects` dictionary. Analysis writes a ranked `clips` list and a lightweight `timeline` object containing only ordered clip IDs. Export reads the ordered IDs and emits EDL or FCPXML using the original analyzed clip timings.

That shape is sufficient for analysis-only export, but it cannot represent user edits from the timeline UI because it loses per-clip trim changes and exclusion state.

## Chosen Approach

Keep analyzed clips as the canonical suggestion catalog and store the user-edited export timeline separately as ordered timeline entries.

This approach is preferred because it:

- minimizes changes to the existing API and in-memory storage model
- preserves original analysis suggestions for later inspection or re-editing
- allows export to use user order and trims without mutating the source suggestion data
- stays backend-only, avoiding unnecessary frontend file changes

## API Design

Add `PUT /projects/{project_id}/timeline`.

Request body replaces the entire current timeline for the project. Each submitted item includes:

- `clip_id`
- `start_sec`
- `end_sec`
- optional `included`

Semantics:

- the request is a full replacement, not a patch
- omitted clips are treated as excluded
- only included clips are retained in the stored export timeline
- `duration_sec` is recalculated as `end_sec - start_sec`

Response returns the resolved timeline state with ordered clips and `total_duration_sec`.

## Validation Rules

Timeline update must validate:

- project exists
- analyzed clips exist for the project
- every submitted `clip_id` exists in the analyzed clip catalog
- submitted clip IDs are unique within the request
- `start_sec < end_sec`
- submitted trims stay within the original analyzed clip bounds for that clip

Using original analyzed clip bounds is intentional. The workflow here is clip trimming, not arbitrary source re-cutting from the raw file.

## Export Behavior

Export must use the edited timeline entries when present. That means:

- clip order follows the replaced timeline order
- source in/out timings use the trimmed values from the timeline
- clip durations in EDL/FCPXML reflect recalculated durations

If no edited timeline exists, the default analyzed sequence remains exportable.

The export response should expose enough summary data for the app and QA flows:

- `project_id`
- `format`
- `status`
- `file_path`
- `clip_count`
- `total_duration_sec`

## Manual Harness Scope

Manual harness remains the reliable default workflow for this task. No new Qwen functionality will be added. Existing local Qwen behavior should continue to work, but it is not the focus of validation.

## Test Strategy

Add focused API tests in `backend/tests/test_api.py` for:

- successful timeline replacement with reordered and trimmed clips
- rejection for missing project
- rejection for unknown clip IDs
- rejection for duplicate clip IDs
- rejection for invalid trim ranges
- rejection for trims outside original clip bounds
- export using updated timeline order and trimmed timings
- export response including summary fields

Verification also includes the repository commands requested for backend and frontend confidence:

- `cd backend && PYTHONPATH=. .venv/bin/python -m pytest`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run build`

## Files Expected To Change

- `backend/src/api.py`
- `backend/src/models.py` if explicit request/response models improve clarity
- `backend/tests/test_api.py`
- generated API contract docs only if required by existing tooling or checked-in artifacts

## Risks

- the backend currently keeps state only in memory, so timeline edits are not persistent across restarts
- export correctness from issue `#19` is improved only insofar as updated timeline trims and ordering are honored; full issue closure still depends on validating broader acceptance criteria

## Non-Goals

- no frontend implementation changes
- no project persistence system
- no manual clip creation from arbitrary source ranges
- no Resolve XML implementation
- no new AI harness work
