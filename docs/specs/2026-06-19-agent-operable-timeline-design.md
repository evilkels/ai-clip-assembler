# Agent-Operable Timeline Design

Date: 2026-06-19 · Status: Approved · Owner: Elvijs · Implementation plan:
[`agent-operable-timeline.md`](../plans/agent-operable-timeline.md)

## Goal and product stance

One backend-authoritative Timeline Document is edited by the GUI, in-app review
agent, and external MCP clients through one Operations core. Grow the editor to
split, extend/retrim, reorder, multi-instance, speed, and transform while staying
local-first and assist-don't-generate. Palmier Pro inspired the live editor tool
surface; on-timeline cloud generation was deliberately rejected.

## Locked decisions

1. Build A (document) → B (operations/MCP) → C (chat/review agent).
2. Agents reason over existing sampled JPEGs under the same consent boundary as
   Pi; source videos do not leave the machine.
3. Editor ceiling: split, source-clamped extend, reorder, multi-instance, speed,
   zoom/pan/crop. Exclude transitions, audio, titles, color, tracks, keyframes.
4. Backend is authoritative; all clients reconcile via SSE.
5. In-app agent stages Proposals for Accept/Reject; user-driven external MCP
   applies directly. Every mutation enters global bounded undo/redo.

## Domain model

**Candidate Clip** remains analysis output. **TimelineItem** is one placement:
unique `item_id`, referenced `source_clip_id`, source-relative `start_sec` /
`end_sec`, `speed` (effective duration = span/speed), and identity-default
`transform {scale,x,y}`. Reusing a Candidate Clip creates distinct item IDs.
**TimelineDocument** owns ordered items, profile, target duration, and revision.
Accept seeds an item; placements then edit independently.

## Operations and concurrency

Only `backend/src/timeline_ops.py` mutates documents: add/include/exclude,
remove, split, bounds, reorder, speed, transform, profile, and target duration.
Each operation validates/clamps, persists, and pushes a document snapshot onto a
bounded per-project history. Snapshot undo was chosen over command inverses
because documents are small and correctness/testability dominate storage.

Per-project locking serializes complete operations. Concurrency is operation-
granular with revision conflicts/refresh—not CRDT merge. The project store is
the durable owner; no adapter may create a second mutation path.

## Adapters and live sync

- HTTP operation/undo/redo endpoints are the GUI adapter.
- Embedded `/mcp` tools map mutators 1:1 to the core; reads expose Candidate
  Clips, Timeline, project summary, and sampled frame paths.
- `/projects/{id}/events` publishes `timeline-changed`. `ReviewContext` is a
  thin client that fetches, subscribes, invokes operations, and reconciles.

Both adapters must remain thin; they cannot duplicate validation or edits.

## In-app review agent

The agent is an MCP client of the app's own interface and reuses provider/model
configuration. Read tools execute normally. Mutating calls are captured as a
Proposal (operation sequence plus diff), rendered inline, and replayed through
the core only on Accept; Reject discards. Analysis completion may trigger one
opening turn; tokens stream over SSE. External clients apply directly because
the Editor is actively driving them.

## Migration, export, preview

The loader upgrades legacy `{clip_id,start_sec,end_sec}` entries into items with
new identity, speed 1.0, and identity transform. `ReviewContext` inversion is
the highest-risk migration and must preserve current review behavior.

FCPXML and Resolve XML encode supported speed/transform; EDL cannot and must
flatten with an explicit warning. Preview maps speed to `playbackRate` and
transform to CSS/canvas.

## Verification and documentation

Test split math, effective duration, transforms, clamping, multi-instance IDs,
undo/redo, migration, HTTP/SSE, MCP handlers, live GUI updates, edit controls,
and Proposal Accept/Reject; manually validate a real external MCP connection.
Update README, `MCP_SERVER.md`, architecture, QA, and ubiquitous language.

Out of scope: transitions, audio/music, titles, grading, multi-track, keyframes,
cross-machine collaboration, CRDTs, and cloud generation on the Timeline.
