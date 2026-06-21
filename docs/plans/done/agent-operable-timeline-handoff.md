# Executor Handoff: Agent-Operable Timeline

> **EXECUTED (2026-06-19, commits `431f51e`..`d012b60`).** A1→A2→B→C built
> test-first; backend complete and test-green (243 backend tests + synthetic
> e2e). The A1 review gate was waived by the operator ("don't stop until the
> plan is fully implemented"). Remaining work and deferred items are tracked in
> the plan's QA/Documentation sections and the `docs/plans/README.md` row —
> chiefly GUI editing affordances, full ReviewContext inversion, chat token
> streaming, Playwright e2e, and the human real-footage **Flow F** session.

> **Executor instructions**: Implement the plan in
> [`agent-operable-timeline.md`](../agent-operable-timeline.md) **fully**, in the
> phase order A1 → A2 → B → C. Work test-first. Run every verification command
> and confirm the expected result before moving on. Honor the **review gate**
> after A1 and every **STOP condition** below — do not improvise past them.
> When a phase lands, update the `agent-operable-timeline` row in
> [`README.md`](../README.md). Keep commits scoped per phase.
>
> **Drift check (run first)**:
> `git diff --stat c81e7dd..HEAD -- backend/src/ frontend/src/renderer/src/state/ReviewContext.tsx docs/`
> If any in-scope file changed since this handoff was written (commit
> `c81e7dd`), reconcile against the live code before proceeding; on a
> structural mismatch with the spec, treat it as a STOP condition.

## Mission

1. Make the timeline **agent-operable** exactly as specified in
   [`docs/specs/2026-06-19-agent-operable-timeline-design.md`](../../specs/2026-06-19-agent-operable-timeline-design.md):
   one backend-authoritative Timeline Document, one reversible operations core,
   an embedded local MCP server, GUI live-sync, and an in-app review agent in
   propose mode. Build A → B → C.
2. **Author the QA testing**, including a real-footage QA flow (see "QA
   deliverable"). Running real 4K footage is a **human** step — you write the
   automated tests, the harness, and the runbook; you do not fabricate footage
   results.

Read the spec and the plan in full before writing code. The spec is the source
of truth for behaviour; this file is the execution order and the QA bar.

## Authoritative references

- Spec: `docs/specs/2026-06-19-agent-operable-timeline-design.md`
- Plan: `docs/plans/agent-operable-timeline.md`
- Vocabulary (use these exact terms): `UBIQUITOUS_LANGUAGE.md`
- Existing QA conventions to extend, not duplicate:
  `docs/VALIDATION_RUNBOOK.md`, `docs/MANUAL_QA_GUIDE.md`,
  `scripts/synthetic_e2e_qa.py`, `backend/tests/test_*.py`, `frontend/e2e/`.

## Current state (in-scope anchors)

- `backend/src/api.py` — FastAPI entry; in-memory `projects` dict, analysis
  pipeline, existing `PUT /projects/{id}/timeline` full-replacement endpoint.
  The operations core and MCP mount attach here.
- `backend/src/models.py` — Pydantic models; add `TimelineDocument` /
  `TimelineItem`.
- `backend/src/project_store.py` — persistence; add document save/load + the
  migration loader for the old `{clip_id, start_sec, end_sec}` timeline shape.
- `backend/src/export_engine.py` — FCPXML/EDL/Resolve XML; encode speed +
  transform (FCPXML/Resolve); flatten + warn for EDL.
- `backend/src/pi_cli_harness.py` — env-config + frame-attachment pattern to
  reuse for the in-app agent (Phase C).
- `frontend/src/renderer/src/state/ReviewContext.tsx` — today authoritative;
  Phase A2 turns it into a thin client of the backend document over SSE.

## Phase tasks and verification

### A1 — Timeline document + operations core (test-first)

- Add `TimelineDocument` / `TimelineItem` models and `backend/src/timeline_ops.py`
  (operations from the spec's Section 2 table), with validation/clamping,
  snapshot undo/redo (bounded per-project history), and a per-project async
  write lock.
- Persistence + migration loader in `project_store.py`.
- Write unit tests **first** (`backend/tests/test_timeline_ops.py`): split math,
  `speed → effective duration`, transform validation, extend/clamp,
  multi-instance identity, undo/redo correctness, migration round-trip.
- **Verify**: `cd frontend && npm run test:backend` (or
  `backend/.venv/bin/pytest backend/tests/test_timeline_ops.py -q`) is green.

> **REVIEW GATE — STOP after A1.** Post a summary of the operation set and
> document shape and wait for human review before starting A2. (The plan calls
> this out explicitly.)

### A2 — HTTP endpoints + SSE + GUI rich editing

- Operation endpoints + `undo`/`redo` under
  `/projects/{id}/timeline/...`; SSE `/projects/{id}/events` emitting
  `timeline-changed`.
- Refactor `ReviewContext` to a thin client (fetch + SSE + operation calls).
  **Highest-risk step** — keep existing accept/reject/reorder/trim behaviour.
- GUI affordances for split, extend, speed, transform.
- Export: speed/transform in FCPXML + Resolve XML; EDL flatten + warning.
- **Verify**: backend API tests green; existing `frontend/e2e/` review specs
  still pass; new e2e covers live-update on an agent edit + speed/zoom editing.

### B — Embedded MCP server

- Mount MCP at `/mcp` in FastAPI. Mutating tools 1:1 with the operations core;
  read tools `list_candidates`, `get_timeline`, `get_project_summary`,
  `get_frame_paths`.
- **Verify**: tool-handler unit tests green; document one real Claude Code
  connection check in `docs/MCP_SERVER.md` (new).

### C — In-app chat + proactive review agent

- Hosted agent loop as an MCP client of our own server (reuse
  `pi_cli_harness` env-config). Propose mode: capture mutating tool calls as
  Proposals (staged ops + diff); Accept replays through the core, Reject
  discards. Chat panel in the Review route; token streaming over SSE;
  auto-kick one agent turn when analysis completes.
- **Verify**: backend tests for proposal capture/apply/reject; e2e for the
  propose → accept flow updating the timeline.

## QA deliverable (author these — do not run real footage yourself)

1. **Automated tests** for every phase as listed above (pytest + Playwright).
2. **Synthetic e2e**: extend `scripts/synthetic_e2e_qa.py` to exercise the new
   operations core and an MCP round-trip end to end on generated/sample media
   (no real footage needed).
3. **Real-footage QA flow**: add a new flow to `docs/VALIDATION_RUNBOOK.md` (and
   a launch note in `docs/MANUAL_QA_GUIDE.md`) that a human runs on actual
   footage from `~/Footage/QA/` — following the runbook's existing manifest +
   report-template conventions. The flow must cover, on real footage:
   - GUI + **External Agent** (Claude Code over `/mcp`) editing the *same* open
     project, with edits appearing live in the GUI;
   - split / extend / speed / transform applied and surviving save/reload;
   - **In-App Review Agent** proposal → accept producing a correct edit;
   - export of a speed/transform timeline to Resolve XML with **zero relink
     prompts** (reuse the runbook's DaVinci handoff criterion), and the EDL
     flatten-warning verified.
   Add a report template section mirroring the existing one. **Never commit
   footage or footage reports.**

## STOP conditions

Stop and report instead of improvising if: the A1 review gate is not yet
cleared; the `ReviewContext` refactor would break existing review e2e and you
cannot keep them green; the MCP SDK/transport choice conflicts with the FastAPI
process model; export cannot represent speed/transform in FCPXML/Resolve;
or any drift-check mismatch with the spec.

## Definition of done

- A1–C implemented per spec; all backend + e2e tests green.
- Docs shipped: README sections (agent/MCP + timeline editing), new
  `docs/MCP_SERVER.md`, updated `docs/ARCHITECTURE.md`; `UBIQUITOUS_LANGUAGE.md`
  already updated (commit `c81e7dd`).
- QA authored: automated tests, extended synthetic e2e, and the real-footage QA
  flow + report template in the runbook (human execution pending).
- `README.md` plans table row for `agent-operable-timeline` updated to reflect
  shipped phases.
