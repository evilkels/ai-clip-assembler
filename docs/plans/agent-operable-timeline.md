# Plan: Agent-Operable Timeline

Status: Draft, awaiting review
Owner: Elvijs
Related: design spec
[`docs/specs/2026-06-19-agent-operable-timeline-design.md`](../specs/2026-06-19-agent-operable-timeline-design.md),
`UBIQUITOUS_LANGUAGE.md`, `docs/ARCHITECTURE.md`, `backend/src/api.py`,
`frontend/src/renderer/src/state/ReviewContext.tsx`

## Problem

The timeline is GUI-only and thin: an ordered list of accepted candidate clips
plus per-clip trims, owned by the frontend (`ReviewContext`). It cannot be
operated by an agent, and it cannot express real edits (split, extend, speed,
transform, multi-instance). We want the editor itself to be a tool surface that
the GUI, an in-app review agent, and external agents (Claude Code/Cursor) all
drive through one shared, reversible operation set — exposed locally over MCP —
while staying local-first and assist-don't-generate.

See the design spec for full rationale and the Palmier comparison that prompted
this.

## Decision

Build the three subsystems in order **A → B → C** on a single
backend-authoritative timeline document with one operations core:

- **A — Rich timeline document** (the editable substrate).
- **B — Operation surface + embedded MCP server** (HTTP + MCP adapters over the
  same core; SSE live-sync to the GUI).
- **C — In-app chat agent** (an MCP client of our own server, propose mode) +
  proactive review turn.

## Phases

### Phase A1 — Backend timeline document + operations core

- New `TimelineDocument` / `TimelineItem` models (`backend/src/models.py`).
- New `backend/src/timeline_ops.py`: the operations core (`add_item`,
  `remove_item`, `split_item`, `set_bounds`, `reorder`, `set_speed`,
  `set_transform`, `include`, `exclude`, `set_profile`, `set_target_duration`)
  with validation/clamping and snapshot-based undo/redo (bounded per-project
  history, per-project async write lock).
- Persistence in the project store + a migration loader for the old
  `{clip_id, start_sec, end_sec}` timeline format.
- Unit tests: split math, speed→effective duration, transform validation,
  extend/clamp, multi-instance identity, undo/redo, migration.

**STOP / review** before A2: confirm the operation set and document shape.

### Phase A2 — HTTP operation endpoints + SSE + GUI rich editing

- Operation endpoints + `undo`/`redo` under
  `/projects/{project_id}/timeline/...` in `backend/src/api.py`.
- SSE `/projects/{project_id}/events` emitting `timeline-changed`.
- Refactor `ReviewContext` from authoritative state to a thin client: fetch
  document, subscribe to SSE, call operation endpoints. **Riskiest step** —
  preserve existing accept/reject/reorder/trim UX behaviour.
- GUI affordances for split, extend, speed, transform (zoom/pan).
- Export: encode speed/transform into FCPXML + Resolve XML; flatten with a
  warning for EDL (`backend/src/export_engine.py`).
- Playwright e2e: live-update, speed/zoom edit, regression on existing review
  flow.

### Phase B — Embedded MCP server

- Mount an MCP server at `/mcp` in the FastAPI process.
- Mutating tools 1:1 with the operations core; read tools `list_candidates`,
  `get_timeline`, `get_project_summary`, `get_frame_paths`.
- Tests: tool handlers called directly; one real Claude Code connection check.
- Docs: new `docs/MCP_SERVER.md` (endpoint, port, tools, connect Claude
  Code/Cursor).

### Phase C — In-app chat + proactive review agent

- Hosted agent loop as an MCP client of our own server (new conversational
  harness, reusing the `pi_cli_harness` env-config pattern).
- Propose mode: capture mutating tool calls as Proposals (staged ops + diff);
  Accept replays through the core, Reject discards.
- Chat panel in the Review route with inline proposal cards; token streaming
  over SSE.
- Proactive: auto-kick one agent turn when analysis completes.

## Documentation (cross-cutting deliverable)

- README sections: "Controlling the app with an agent (MCP)" + "Timeline editing".
- New `docs/MCP_SERVER.md`.
- Update `docs/ARCHITECTURE.md` and `UBIQUITOUS_LANGUAGE.md` with the new model
  and terms.

## Out of scope (YAGNI)

Transitions, audio/music, titles, color, multi-track, keyframes, cross-machine
collaboration, CRDT merge, on-timeline cloud generation.

## Risks

- **ReviewContext refactor** (A2) is the highest-risk change; keep the existing
  review UX behaviour green via the Playwright suite before adding new editing.
- **EDL cannot express speed/transform** — accepted: flatten + warn.
- **Two writers** (GUI + external agent) — mitigated by per-project op
  serialization; no document-level merge.
