# Agent-Operable Timeline Design

Date: 2026-06-19
Status: Approved (brainstorm complete); implementation plan in
[`docs/plans/agent-operable-timeline.md`](../plans/agent-operable-timeline.md)
Owner: Elvijs

## Goal

Make the AI Clip Assembler timeline **agent-operable**: a single
backend-authoritative timeline document that the GUI, an in-app review agent,
and external AI agents (Claude Code, Cursor, Codex) can all edit through one
shared set of operations, exposed locally over MCP. Along the way, grow the
timeline from "ordered accepted clips + trims" into a real lightweight editor
(split, extend, reorder, multi-instance, speed, transform).

This borrows the core working principle from
[Palmier Pro](https://github.com/palmier-io/palmier-pro) — *the editor itself
is a tool surface an agent drives, with generation/editing living on one live
timeline* — while keeping our own identity: **local-first, assist-don't-generate.**
We adopt the agent-operability idea; we deliberately do **not** chase
on-timeline cloud generation.

## Why now / what Palmier taught us

Palmier exposes a standing local MCP server (`127.0.0.1:19789/mcp`) while the
app runs, so an agent can `generate`, `trim`, `split`, `reorder`, and `adjust`
clips with full project context, and an in-app chat operates the *same* live
project. Our architecture is already 80% of the way there — FastAPI on
localhost, a "modular AI harness" philosophy, a ubiquitous language — but our
harness is a **one-shot batch scorer** (`pi_cli_harness.py`) and the AI never
*operates* the editor. This design points that latent capability the right way.

## Decisions locked during brainstorm

1. **Scope:** one spec covering the full vision, built in order **A → B → C**.
2. **Privacy:** the agent reasons over the **existing local frame JPEGs**
   (same trust boundary as `pi_agent`, which already sends sampled frames to a
   cloud model via the pi CLI). No new privacy line is crossed; source video
   files still never leave the machine.
3. **Editor ceiling:** split, extend/retrim beyond original candidate bounds,
   reorder, multi-instance (same source used more than once), **speed**, and
   **transform** (digital zoom/pan/crop). Out: transitions, audio, titles,
   color, multi-track, keyframes.
4. **Source of truth:** **backend-authoritative** timeline document; the GUI
   live-updates (SSE). One operation set serves GUI + in-app chat + external MCP.
5. **Autonomy:** the in-app review agent **proposes & confirms** (staged diff
   you accept/reject); external MCP agents **apply directly** (you are driving
   them); every mutation is reversible via a **global undo/redo history**.

## Subsystems

- **A — Rich timeline document.** The editable substrate.
- **B — Operation surface + MCP server.** One named operation set, two thin
  adapters (HTTP for the GUI, MCP tools for agents).
- **C — In-app chat + proactive review agent.** A chat panel whose agent is an
  MCP client of our own server, running in propose mode.

B and C both stand on A; C's chat reuses B's tools. Hence build order A → B → C.

## Section 1 — Domain model

Today the "timeline" is three loose frontend structures in
`frontend/src/renderer/src/state/ReviewContext.tsx`: `acceptedOrder: string[]`,
`trims: {clipId → {start_sec,end_sec}}`, plus `decisions` / `profile` /
`targetDuration`. Replace with a backend-owned **TimelineDocument**.

- **Candidate Clip** (unchanged): analysis output in the Review Board pool —
  source video + original bounds + scores + reason.
- **TimelineItem** (new): one placement on the timeline.
  - `item_id` — unique; the *same* candidate may appear more than once
    (multi-instance) as distinct items.
  - `source_clip_id` — references the Candidate Clip (hence source video +
    original bounds + scores).
  - `start_sec` / `end_sec` — in/out **within the source video**; may extend
    past the original candidate bounds, clamped to `[0, source_duration]`.
  - `speed` — playback rate multiplier, default `1.0`. Effective timeline
    duration of an item is `(end_sec - start_sec) / speed`.
  - `transform` — `{scale, x, y}`, identity default; digital zoom/pan/crop.
- **TimelineDocument**: ordered `items[]` + `profile` + `target_duration_sec`
  + `version`.

The Review Board still seeds the timeline (accepting a candidate adds an item),
but timeline items are independently editable objects from then on.

New ubiquitous-language terms: **TimelineItem**, **Speed**, **Transform**,
**Operation**, **Proposal**, **Undo History**, **MCP Server**.

## Section 2 — Operations core + undo/redo

A single backend module (proposed `backend/src/timeline_ops.py`) is the **only**
way to mutate a `TimelineDocument`. Operations:

| Operation | Effect |
| --- | --- |
| `add_item(source_clip_id, at_index?)` | Place a candidate on the timeline |
| `remove_item(item_id)` | Remove a placement |
| `split_item(item_id, at_sec)` | Split one item into two at a source timestamp |
| `set_bounds(item_id, start_sec, end_sec)` | Trim **and** extend (clamped) |
| `reorder(item_id, to_index)` | Move an item in the order |
| `set_speed(item_id, speed)` | Set playback rate |
| `set_transform(item_id, transform)` | Set digital zoom/pan/crop |
| `include(clip_id)` / `exclude(clip_id)` | Review-board accept/reject |
| `set_profile` / `set_target_duration` | Assembly knobs (existing) |

Each operation validates and clamps, then pushes a **snapshot** of the document
onto a bounded per-project history ring. `undo` / `redo` are snapshot pop/push.

**Snapshot-based, not command-inverse**, chosen deliberately: the document is
small, so snapshotting is far simpler to get right than maintaining an inverse
for every operation, and it makes undo correctness trivial to test.

Writes are serialized by a **per-project async lock** so a GUI edit and an
external-agent edit cannot interleave mid-operation. Concurrency is
op-granular last-writer-wins — **not** character-level CRDT merge (out of
scope). After each op the document is persisted to the project store (debounced),
reusing the existing save path.

## Section 3 — Operation surface, MCP server, GUI sync

### HTTP adapter (GUI)

Operation endpoints under `/projects/{project_id}/timeline/...` (one per
operation, or a single `POST .../op` taking an operation name + args). Each call
runs an operation through the core and returns the resolved document. Plus
`POST .../undo` and `POST .../redo`.

### MCP adapter (agents)

An MCP server **embedded in the existing FastAPI process**, mounted at `/mcp`
on the backend port (Palmier uses a fixed `127.0.0.1:19789`; we reuse our
backend port, documented in `docs/MCP_SERVER.md`). Tools:

- **Mutating tools** — 1:1 with the operations core (`split_item`,
  `set_speed`, `set_transform`, `add_item`, `reorder`, …).
- **Read tools** — `list_candidates` (scores + reasons), `get_timeline`,
  `get_project_summary`, and `get_frame_paths(clip_id)` which returns the local
  frame JPEG paths so an external agent (e.g. Claude Code) reads the images
  directly, exactly as `pi_cli_harness.py` does with `@path` attachments.

Both adapters call the **same** operations core — they cannot drift.

### Sync (live GUI updates)

An SSE endpoint `/projects/{project_id}/events` emits `timeline-changed`.
`ReviewContext` stops being authoritative: it fetches the document, subscribes
to SSE, and calls operation endpoints. The initiating client and all others
reconcile from the authoritative document. This is what makes an agent's edit
appear live in the GUI.

## Section 4 — In-app chat + proactive review agent

The in-app agent is **an MCP client of our own server**, so in-app and external
agents share the identical tool surface — the central reuse win. It runs as a
hosted agent loop (new conversational harness, reusing the provider/model
env-config pattern from `pi_cli_harness.py`).

- **Propose mode.** The in-app agent's *mutating* tool calls are captured as a
  **Proposal** — a staged operation sequence plus the resulting diff — instead
  of being applied. The GUI renders proposals as inline cards in the chat panel
  (e.g. "Add 12s from DJI_002 @1:40, speed 0.5×") with Accept / Reject. Accept
  replays the operations through the core (so they land in undo history); Reject
  discards. Read tool calls run normally.
- **Proactive.** When analysis completes, the backend auto-kicks one agent turn
  that posts an opening message and initial proposals.
- **Streaming.** Agent tokens stream to the chat panel over SSE.

External agents (Claude Code/Cursor) use the same MCP tools but **apply
directly** — the user is driving them from the CLI.

## Section 5 — Migration, export, preview, risks

- **Migration.** Bump the saved-timeline schema; a loader upgrades the old
  `{clip_id, start_sec, end_sec}` list into `TimelineItem`s (`item_id`
  generated, `speed = 1.0`, identity transform). Old projects open cleanly.
- **ReviewContext refactor** (authoritative → thin client of the backend
  document) is the riskiest piece; phased in A2.
- **Export reality check.** FCPXML can express speed (retime) and transform
  (`adjust-transform`); **EDL cannot** represent speed or transform, so EDL
  export flattens them and surfaces a warning. Touches
  `backend/src/export_engine.py`. (Resolve XML can express both.)
- **Preview.** Speed via `video.playbackRate`, transform via CSS/canvas
  transform — feasible with the existing preview player.

## Section 6 — Testing

- **Backend unit** (following `backend/tests/test_*.py` patterns): split math,
  speed → effective duration, transform validation, extend/clamp, multi-instance
  identity, undo/redo correctness, migration loader.
- **API**: operation endpoints + SSE event emission.
- **MCP**: call tool handlers directly (thin wrappers over the core); one
  end-to-end check with a real Claude Code connection.
- **Frontend e2e** (Playwright, per `frontend/e2e/`): live-update on agent edit,
  speed/zoom editing UI, proposal accept/reject.
- **Manual QA**: extend `docs/MANUAL_QA_GUIDE.md` with an agent-control flow.

## Documentation deliverables

- **README**: "Controlling the app with an agent (MCP)" + "Timeline editing".
- **New `docs/MCP_SERVER.md`**: endpoint, port, tool list, how to connect
  Claude Code / Cursor (mirrors Palmier's docs page).
- **Update `docs/ARCHITECTURE.md`**: backend-authoritative timeline, operations
  core, MCP, SSE.
- **Update `UBIQUITOUS_LANGUAGE.md`**: TimelineItem, Speed, Transform,
  Operation, Proposal, Undo History, MCP Server.

## Out of scope (YAGNI)

Transitions, audio/music, titles, color grading, multi-track, keyframes,
cross-machine collaboration, CRDT merge, on-timeline cloud generation.
