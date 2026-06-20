# Plan 006: Persist project-scoped review conversations and Proposals

> **Executor instructions**: Follow this plan step by step and run every gate.
> Stop on a listed STOP condition instead of improvising. When complete, update
> `docs/plans/README.md` unless a reviewer maintains it.
>
> **Drift check (run first)**:
> `git diff --stat 6744eaa..HEAD -- backend/src/models.py backend/src/project_store.py backend/src/review_agent.py backend/src/api.py backend/tests/test_project_store.py backend/tests/test_review_agent.py backend/tests/test_api.py frontend/src/renderer/src/api/client.ts frontend/src/renderer/src/components/ReviewChatPanel.tsx`
> Compare live code with the current-state notes if any path changed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (moves proposal/history ownership to persisted backend state)
- **Depends on**: none
- **Category**: bug / architecture
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

`ReviewChatPanel` owns `messages` in component-local state. Navigating away
unmounts it, destroys the conversation, and triggers another kickoff on return.
The backend only keeps Proposals in a process-local dictionary, so a restart
also makes pending Accept/Reject cards unusable. The Timeline Document is
already backend-authoritative and persisted per project; review sessions should
follow the same ownership model.

## Current state

- `frontend/src/renderer/src/components/ReviewChatPanel.tsx:27-52` initializes
  `messages=[]`, clears them on project kickoff, and uses a component-local
  numeric counter for IDs.
- `backend/src/review_agent.py:90-147` stores Proposals in
  `ProposalStore._proposals`, an in-memory dictionary.
- `backend/src/review_agent.py:171-175` sends only the latest user message,
  candidates, and timeline to the agent; no conversation history exists.
- `backend/src/api.py:996-1023` exposes turn, kickoff, and Proposal-list routes,
  but no conversation-history route.
- `backend/src/project_store.py:217-277` is the established JSON persistence
  pattern. Analysis results and Timeline Document live under
  `<project>/clipassembler/analysis/` and tolerate missing/corrupt files.
- Folder projects receive a new runtime `project_id` whenever reopened
  (`backend/src/api.py:216-229`), so persisted review data must be keyed by the
  project folder, not runtime ID. Legacy upload projects have no folder and may
  remain process-local.
- Use domain roles `editor` and `agent`, and the terms Proposal, Timeline
  Document, and In-App Review Agent from `UBIQUITOUS_LANGUAGE.md`.

## Target contract

Persist `<project>/clipassembler/analysis/review-session.json` with:

- `schema_version`
- stable `session_id`
- ordered messages with UUID `message_id`, `role`, `text`, UTC `created_at`
- optional embedded Proposal, including its status
- optional structured agent payload reserved for plan 007
- `updated_at`

The backend is authoritative. `GET /projects/{id}/review/session` hydrates the
panel. `POST .../review/turn` appends the editor message before calling the
model and appends the agent result afterward. Accept/Reject updates the same
stored Proposal. Kickoff is idempotent when a session already has messages.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused backend | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_project_store.py tests/test_review_agent.py tests/test_api.py -q` | exit 0 |
| Backend suite | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` | all pass |
| Frontend typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Build | `cd frontend && npm run build` | exit 0 |
| Lint | `cd frontend && npm run lint` | exit 0 |

## Scope

**In scope**:

- `backend/src/models.py` or a new focused `backend/src/review_models.py`
- `backend/src/project_store.py`
- `backend/src/review_agent.py`
- `backend/src/api.py`
- `backend/tests/test_project_store.py`
- `backend/tests/test_review_agent.py`
- `backend/tests/test_api.py`
- `frontend/src/renderer/src/api/client.ts`
- `frontend/src/renderer/src/components/ReviewChatPanel.tsx`
- `frontend/e2e/compare-versions.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/plans/README.md` status only

**Out of scope**:

- Chat bubble visual redesign (plan 008).
- Creative visual/version generation (plan 007), except reserving an optional
  structured payload field.
- Token streaming.
- Moving unrelated Review state into `ReviewContext`.
- Database introduction; JSON is the documented local-first storage model.

## Git workflow

- Branch: `fix/persist-review-session`
- Conventional commit example: `fix(review-chat): persist project sessions`.
- Do not push/open a PR unless instructed.

## Steps

### Step 1: Specify and test the persisted model

Add typed Pydantic models for Review Message and Review Session. Move Proposal
to the focused review model module if necessary to avoid circular imports; do
not duplicate Proposal shapes.

Add `review_session_path`, `read_review_session`, and
`write_review_session` beside existing project-store helpers. Follow existing
behavior for missing, corrupt, or unsupported JSON: return a clean empty
session without overwriting the corrupt file until a successful mutation.

Tests must cover round-trip, stable IDs/timestamps, Proposal status, missing
file, corrupt JSON, unsupported schema, and project-folder isolation.

**Verify**: project-store focused tests pass.

### Step 2: Make one backend store authoritative

Replace the split between component messages and `ProposalStore` with a
project-scoped Review Session service. It must support folder-backed persistence
and memory-only legacy upload projects through one interface.

Required operations:

- load/get session
- append editor message
- append agent message with optional Proposal
- find Proposal by ID and project
- update Proposal status
- idempotent kickoff test (`has_messages`)

Prevent cross-project Proposal access: Accept/Reject must verify both
`project_id` and `proposal_id`. Preserve proposal simulation and replay through
`TimelineController`; accepting remains undoable.

Do not leave two writable Proposal registries. One source of truth must supply
both list and resolution endpoints.

**Verify**: review-agent tests pass, including accept after reconstructing the
service from a persisted folder session.

### Step 3: Add session API and make turn persistence transactional enough

Add `GET /projects/{project_id}/review/session`. Update turn and kickoff routes
to return the stored agent message/session shape.

For a turn:

1. Validate non-empty input.
2. Append/persist the editor message.
3. Call the agent.
4. Append/persist either the agent result or the existing graceful fallback.

Serialize turns per project so two callers cannot interleave messages or stage
Proposals against inconsistent Timeline Documents. Reuse an `asyncio.Lock`
pattern consistent with `TimelineController`; do not use a global lock across
all projects.

Opening a folder project must make its saved session immediately available.
Kickoff must return the existing opening state without invoking Pi when history
already exists.

**Verify**: API tests cover page-return hydration, folder reopen with a new
runtime project ID, backend service reconstruction, duplicate kickoff, invalid
cross-project Proposal ID, and corrupt saved session.

### Step 4: Hydrate the frontend from backend history

Add typed client functions for session GET and updated turn/kickoff responses.
Remove local numeric ID generation. On `projectId` change, load the backend
session; call kickoff only when it is empty. Render server-provided stable IDs
and update from the returned session/message after send or Proposal resolution.

Handle stale async responses: if the user changes project while a load/turn is
in flight, do not apply the old project's messages. Preserve input and busy
state behavior.

**Verify**: typecheck and build pass.

### Step 5: Add navigation regression coverage and document ownership

Extend the existing compare-versions Playwright flow: send a message using a
stubbed/deterministic review response, navigate to another route, return to
Review, and assert the same message IDs/text and Proposal status remain without
a second kickoff.

Document the Review Session as backend-authoritative JSON state and state that
legacy upload projects persist only for the backend process lifetime.

Run all gates.

## Test plan

Backend tests are primary and must not call a real model. Use injected agents
from `test_review_agent.py`. Persistence tests follow `test_project_store.py`.
The single E2E regression covers route switching; folder reopen and service
restart are cheaper and more deterministic in API tests.

## Done criteria

- [ ] Page switching restores the same ordered messages without another kickoff.
- [ ] Reopening a folder project under a new runtime ID restores history.
- [ ] Pending Proposal cards still Accept/Reject after service reconstruction.
- [ ] Cross-project Proposal resolution returns an error.
- [ ] Corrupt/missing history degrades to an empty session without crashing.
- [ ] Stable UUID message IDs and UTC timestamps come from the backend.
- [ ] Backend suite, frontend typecheck/build, and lint pass.
- [ ] Only in-scope files plus this status row are modified.

## STOP conditions

- Persistence would require putting absolute frame paths or image data in chat
  history; store references/IDs only.
- Proposal replay cannot be reconstructed safely from persisted operations.
- The implementation needs a second writable Proposal store.
- Session writes can race within one project and no per-project serialization
  point is available.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

Plan 007 will add conversational context and optional Version payloads to this
session. Keep schema migration explicit when that happens. Reviewers should
check project isolation, idempotent kickoff, stale frontend requests, and that
all accepted edits still pass through Timeline operations/Undo History.
