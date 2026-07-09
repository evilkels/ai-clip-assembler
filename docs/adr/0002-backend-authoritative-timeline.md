# 0002: Backend-authoritative Timeline Document via a shared Operations core

## Status

Accepted.

## Context

The Timeline needs to be editable from more than one place at once: the GUI,
external agents (Claude Code, Cursor, Codex) over MCP, and the in-app Review
Agent. If each client held its own copy of timeline state, concurrent edits
would drift and undo would be inconsistent across surfaces. The app needed one
owner of the truth and one mutation path all clients funnel through.

## Decision

The backend owns the single authoritative **Timeline Document**: ordered
**Timeline Items**, assembly profile, and target duration. The **Operations
core** (`timeline_ops.py`) is the only way the document is mutated — every
edit (split, trim/extend, reorder, speed, transform, include/exclude,
`replace_timeline`) is a validated, reversible **Operation**. The HTTP adapter
(GUI) and the embedded MCP server (external agents) are two thin adapters over
that one core, so they cannot drift. The **In-App Review Agent** never mutates
directly: its suggested edits are captured as a **Proposal** the Editor must
accept before it replays through the Operations core.

## Consequences

- Clients cannot mutate timeline state directly; every change is an
  Operation, so it is recorded in **Undo History** and is reversible.
- The GUI is optimistic-UI-capable but must reconcile from backend snapshots
  and the `timeline-changed` SSE stream rather than trust local state.
- An External Agent's edits appear live in the GUI; the Review Agent's
  proposals require explicit Editor acceptance before they take effect.

## References

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Agent-Operable Timeline
- [UBIQUITOUS_LANGUAGE.md](../../UBIQUITOUS_LANGUAGE.md) — Timeline Document, Timeline Item, Operation, Proposal
- [docs/MCP_SERVER.md](../MCP_SERVER.md)
