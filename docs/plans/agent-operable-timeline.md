# Agent-Operable Timeline

> **For agentic workers:** Use the executing-plans / subagent-driven-development
> workflow to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`)
> syntax for tracking. Read the whole phase before starting it; honor the
> **Guardrails** in each phase and the **review gate** after Phase A1. Update the
> status row in `docs/plans/README.md` when a phase lands. The design spec is the
> source of truth for behaviour:
> [`docs/specs/2026-06-19-agent-operable-timeline-design.md`](../specs/2026-06-19-agent-operable-timeline-design.md).
>
> **Drift check (run first):**
> `git diff --stat ed891fd..HEAD -- backend/src frontend/src/renderer/src/state/ReviewContext.tsx docs/`
> If any in-scope file changed since this plan was written, re-verify the cited
> files against live code before editing; on a structural mismatch with the
> spec, treat it as a STOP condition.

## Status

- **Priority**: P2 (after the current clip-quality-review-ux work lands)
- **Effort**: L overall (phased; A1 and B independently shippable; A2 is the heavy one)
- **Risk**: LOW (A1), MEDIUM-HIGH (A2 — `ReviewContext` source-of-truth refactor),
  MEDIUM (B — MCP transport in FastAPI), MEDIUM (C — agent loop + propose UX)
- **Depends on**: none to start; B and C build on A
- **Category**: architecture + product
- **Planned at**: commit `ed891fd`, 2026-06-19
- **Progress**: Phase A1 complete (operations core, undo/redo, persistence/migration; 56 tests). At the A1 review gate — A2/B/C not started.

## Why this matters

The timeline is GUI-only and thin: an ordered list of accepted candidate clips
plus per-clip trims, owned by the frontend (`ReviewContext`). It cannot be
operated by an agent, and it cannot express real edits (split, extend, speed,
transform, multi-instance). Borrowing Palmier Pro's working principle — *the
editor itself is a tool surface an agent drives on one live timeline* — we make
the editor agent-operable while keeping our identity: **local-first,
assist-don't-generate** (we adopt agent-operability; we do **not** chase
on-timeline cloud generation). The payoff: GUI, an in-app review agent, and
external agents (Claude Code/Cursor) all drive one shared, reversible operation
set over a local MCP server.

## Subsystems & build order

- **A — Rich timeline document** (the editable substrate). Built first.
- **B — Operation surface + embedded MCP server** (HTTP + MCP adapters over one core; SSE live-sync).
- **C — In-app chat + proactive review agent** (an MCP client of our own server, propose mode).

B and C both stand on A; C reuses B's tools. Hence **A → B → C**.

## Decisions locked (see spec for rationale)

1. One spec/plan, full vision, built A → B → C.
2. Agent reasons over the **existing local frame JPEGs** (same trust boundary as `pi_agent`).
3. Editor ceiling: split, extend/retrim, reorder, multi-instance, **speed**, **transform**. No transitions/audio/titles/color.
4. **Backend-authoritative** timeline; GUI live-updates via SSE; one operation set for GUI + chat + MCP.
5. In-app agent **proposes & confirms**; external agents **apply**; **global undo/redo**.

---

## Phase A1 — Timeline document + operations core

**Goal:** A backend-authoritative `TimelineDocument` with a single reversible
operations core. Backend-only; no API or frontend changes yet.

**Guardrails:** Test-first — write `backend/tests/test_timeline_ops.py` before
the implementation. Do not touch `ReviewContext` or the export engine in this
phase. Keep the existing `PUT /projects/{id}/timeline` working until A2 replaces it.

### Task A1.1 — Document & item models
**Files:** `backend/src/models.py`, `backend/tests/test_timeline_ops.py`
- [x] Add `TimelineItem` (`item_id`, `source_clip_id`, `start_sec`, `end_sec`, `speed=1.0`, `transform`) and `TimelineDocument` (`items[]`, `profile`, `target_duration_sec`, `version`).
- [x] Add a `Transform` model (`scale`, `x`, `y`) with identity default and validation.

### Task A1.2 — Operations core
**Files:** `backend/src/timeline_ops.py` (new), `backend/tests/test_timeline_ops.py`
- [x] Implement operations from the spec's Section 2 table: `add_item`, `remove_item`, `split_item`, `set_bounds`, `reorder`, `set_speed`, `set_transform`, `include`, `exclude`, `set_profile`, `set_target_duration`.
- [x] Validation/clamping: bounds clamped to `[0, source_duration]`; `split_item` splits within bounds; `speed > 0`; transform validated.
- [x] Failing-then-passing tests: split math, `speed → effective duration` (`(end-start)/speed`), transform validation, extend/clamp, multi-instance identity (same candidate → distinct `item_id`s).

### Task A1.3 — Undo/redo history
**Files:** `backend/src/timeline_ops.py`, tests
- [x] Snapshot-based bounded per-project history; `undo`/`redo` as snapshot pop/push.
- [x] Per-project async write lock so GUI + agent operations cannot interleave mid-op.
- [x] Tests: undo/redo correctness across each operation; lock serialization.

### Task A1.4 — Persistence + migration
**Files:** `backend/src/project_store.py`, `backend/tests/test_project_store.py`
- [x] Persist/load `TimelineDocument`; debounced save after each op (reuse existing save path).
- [x] Migration loader: upgrade old `{clip_id, start_sec, end_sec}` timelines into `TimelineItem`s (`item_id` generated, `speed=1.0`, identity transform).
- [x] Test: old-format round-trip opens cleanly as a `TimelineDocument`.

**Phase A1 verification:** `cd frontend && npm run test:backend` green (or
`backend/.venv/bin/pytest backend/tests/test_timeline_ops.py backend/tests/test_project_store.py -q`).

> **REVIEW GATE — STOP after A1.** Post a summary of the operation set and
> document shape; wait for human review before starting A2.

---

## Phase A2 — HTTP endpoints + SSE + GUI rich editing

**Goal:** Expose the operations core over HTTP, make the GUI a thin live-updating
client of the backend document, and add split/extend/speed/transform editing.

**Guardrails:** Keep existing accept/reject/reorder/trim behaviour green via the
`frontend/e2e/` review specs at every step. This is the highest-risk phase —
land the refactor before adding new editing affordances.

### Task A2.1 — Operation endpoints + undo/redo
**Files:** `backend/src/api.py`, `backend/tests/test_api.py`
- [x] Add operation endpoints under `/projects/{id}/timeline/...` (per-op or one `POST .../op` with name+args) returning the resolved document, plus `POST .../undo` and `POST .../redo`.
- [x] API tests for each endpoint + undo/redo.

### Task A2.2 — SSE live-sync
**Files:** `backend/src/api.py`, `backend/tests/test_api.py`
- [x] Add SSE `/projects/{id}/events` emitting `timeline-changed` after each op.
- [x] Test: an operation emits the event.

### Task A2.3 — ReviewContext → thin client (highest risk)
**Files:** `frontend/src/renderer/src/state/ReviewContext.tsx`, `frontend/src/renderer/src/api/client.ts`
- [x] Client API for the operations core (`getTimelineDocument`, `applyTimelineOp`, `undo`/`redo`, `subscribeTimelineEvents`).
- [x] Preserve existing review UX (accept/reject/reorder/trim) behaviour.
- [~] Subscribe to SSE and reconcile from the document. **Partial:** additive
  live-sync surfaces agent edits without clobbering editor state; full
  authoritative inversion (GUI edits routed through the operations core) is
  deferred to keep the review UX green. Typecheck green.
- [ ] E2E: an agent/external edit appears live in the GUI (needs the Electron+backend stack; pending visual QA).

### Task A2.4 — GUI editing affordances
**Files:** `frontend/src/renderer/src/components/`, `frontend/e2e/`
- [ ] UI for split, extend, speed, transform (zoom/pan). Preview: speed via `video.playbackRate`, transform via CSS/canvas transform. **Not started** (visual UI work; the operations are reachable from the client API above).
- [ ] E2E for speed/zoom editing.

### Task A2.5 — Export speed/transform
**Files:** `backend/src/export_engine.py`, `backend/tests/test_export_engine.py`
- [x] Encode speed (retime) + transform (`adjust-transform`) into FCPXML and Resolve XML.
- [x] EDL: flatten speed/transform and surface a warning.
- [x] Tests for each format.

**Phase A2 verification:** backend API tests green; existing review e2e still
pass; new e2e for live-update + speed/zoom; export tests green.

---

## Phase B — Embedded MCP server

**Goal:** An MCP server in the FastAPI process exposing the operations core plus
read tools, so external agents drive the same live timeline.

**Guardrails:** MCP tools must call the **same** operations core as the HTTP
adapter — no parallel mutation path.

### Task B.1 — Mount MCP + mutating tools
**Files:** `backend/src/api.py` (or a new `backend/src/mcp_server.py`), tests
- [x] Mount MCP at `/mcp` on the backend port. Mutating tools 1:1 with the operations core.
- [x] Tests: call tool handlers directly; assert they mutate via the core + emit `timeline-changed`.

### Task B.2 — Read tools
**Files:** same, tests
- [x] `list_candidates` (scores + reasons), `get_timeline`, `get_project_summary`, `get_frame_paths(clip_id)` (returns local frame JPEG paths, as `pi_cli_harness` uses `@path`).
- [x] Tests for each read tool.

### Task B.3 — Docs + real-agent check
**Files:** `docs/MCP_SERVER.md` (new)
- [x] Document endpoint, port, tool list, and how to connect Claude Code / Cursor.
- [x] Record one verified real Claude Code connection that lists candidates and applies one operation.

**Phase B verification:** MCP tool-handler tests green; documented Claude Code
round-trip succeeds.

---

## Phase C — In-app chat + proactive review agent

**Goal:** A chat panel whose agent is an MCP client of our own server, running in
propose mode, that proactively suggests edits the Editor accepts or rejects.

**Guardrails:** In-app agent edits go through Proposals (never applied silently);
accepted proposals replay through the operations core so they land in undo history.

### Task C.1 — Hosted agent loop (MCP client, propose mode)
**Files:** `backend/src/review_agent.py` (new), `backend/tests/test_review_agent.py`
- [x] Agent loop (`run_review_turn`) with the model call injected; `default_review_agent` reuses `pi_cli_harness` env-config (provider/model) and degrades to chat-only on failure.
- [x] Capture mutating tool calls as a **Proposal** (staged ops + diff via `_simulate`) instead of applying; read access provided as context.
- [x] Tests: proposal capture; accept replays ops through the core (undoable, emits event); reject discards. API endpoints `review/turn`, `proposals/{id}/accept|reject` tested.

### Task C.2 — Chat panel + proposal cards
**Files:** `frontend/src/renderer/src/components/ReviewChatPanel.tsx`, `frontend/src/renderer/src/routes/Review.tsx`, `client.ts`
- [x] Chat panel in the Review route; inline proposal cards with Accept/Reject; client API (`reviewTurn`, `acceptProposal`, `rejectProposal`). Typecheck green.
- [~] Token streaming over SSE deferred — turns return the full message; the timeline updates live via the existing SSE reconcile on accept.
- [ ] E2E: propose → accept updates the timeline; reject leaves it unchanged (needs the Electron+backend stack with a stubbed agent; pending visual QA).

### Task C.3 — Proactive turn
**Files:** `backend/src/api.py`, `ReviewChatPanel.tsx`
- [x] `POST /projects/{id}/review/kickoff` runs one proactive opening turn; the chat panel auto-kicks it on mount for a project (after analysis lands on the Review route). Tested.

**Phase C verification:** backend proposal tests green; e2e propose→accept and
proactive opening turn.

---

## Documentation (cross-cutting)

- [ ] README: "Controlling the app with an agent (MCP)" + "Timeline editing" sections.
- [ ] New `docs/MCP_SERVER.md` (Phase B).
- [ ] Update `docs/ARCHITECTURE.md` (backend-authoritative timeline, operations core, MCP, SSE).
- [x] `UBIQUITOUS_LANGUAGE.md` updated (commit `c81e7dd`).

## QA & real-footage validation

> **Author these; do not fabricate real-footage results.** Per repo convention
> (`001-real-footage-validation.md`), the coding agent writes the harness/tests
> and the runbook flow; a human runs actual footage.

- [ ] Per-phase automated tests above (pytest + Playwright) all green.
- [ ] Extend `scripts/synthetic_e2e_qa.py` to exercise the operations core and an MCP round-trip on generated/sample media.
- [ ] Add a real-footage QA flow to `docs/VALIDATION_RUNBOOK.md` (+ launch note in `docs/MANUAL_QA_GUIDE.md`) covering, on footage from `~/Footage/QA/`:
  - [ ] GUI + External Agent (Claude Code over `/mcp`) editing the same open project, edits live in the GUI;
  - [ ] split / extend / speed / transform applied and surviving save/reload;
  - [ ] In-App Review Agent proposal → accept producing a correct edit;
  - [ ] export of a speed/transform timeline to Resolve XML with **zero relink prompts**; EDL flatten-warning verified.
  - [ ] Report-template section mirroring the existing one. **Never commit footage or footage reports.**

## Out of scope (YAGNI)

Transitions, audio/music, titles, color grading, multi-track, keyframes,
cross-machine collaboration, CRDT merge, on-timeline cloud generation.

## Risks

- **ReviewContext refactor** (A2) is highest-risk; keep existing review e2e green before adding new editing.
- **EDL cannot express speed/transform** — accepted: flatten + warn.
- **Two writers** (GUI + external agent) — mitigated by per-project op serialization; no document-level merge.
