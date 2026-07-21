# Plan 006: Persist project-scoped review conversations and Proposals

## Status

- **Status**: DONE (2026-06-21)
- **Priority**: P1 | **Effort**: M | **Risk**: MED (moves proposal/history ownership to persisted backend state)
- **Depends on**: none
- **Planned at**: commit `6744eaa`, 2026-06-21

## Why this matters

`ReviewChatPanel` owned `messages` in component-local state, so navigating
away destroyed the conversation and re-triggered kickoff on return. The
backend only kept Proposals in a process-local dict, so a restart broke
pending Accept/Reject cards too. The Timeline Document is already
backend-authoritative and persisted per project; review sessions needed the
same ownership model.

## Decisions / target contract

Persist `<project>/clipassembler/analysis/review-session.json` (schema
version, stable `session_id`, ordered messages with UUID IDs/UTC timestamps,
optional embedded Proposal with status, optional structured payload reserved
for plan 007). Backend is authoritative: `GET .../review/session` hydrates the
panel; `POST .../review/turn` appends the editor message, calls the model,
then appends the agent result. Kickoff is idempotent once a session has
messages. Folder projects get a new runtime `project_id` on every reopen, so
persisted data is keyed by project folder, not runtime ID; legacy upload
projects (no folder) remain process-local/memory-only. One writable Proposal
store replaced the previous split (component state + `ProposalStore`); turns
are serialized per-project via an `asyncio.Lock` (not a global lock) to avoid
interleaving. Cross-project Proposal resolution must be rejected explicitly.

## Completion record

- Added backend-authoritative Review Sessions with stable message IDs,
  timestamps, embedded Proposals, and folder-backed JSON persistence.
- Verified idempotent kickoff, blank-message validation, folder reopen under a
  new runtime project ID, Proposal replay, and frontend hydration.
- Full verification: 270 backend tests passed; frontend typecheck, production
  build, ESLint, and Ruff passed.

## Maintenance notes

Plan 007 adds conversational context and optional Version payloads to this
session — keep schema migration explicit when that happens. Review focus:
project isolation, idempotent kickoff, stale frontend requests, and that
accepted edits still pass through Timeline operations/Undo History.
