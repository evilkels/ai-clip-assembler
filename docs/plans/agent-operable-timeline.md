# Agent-Operable Timeline

Design spec (source of truth for behaviour):
[`docs/specs/2026-06-19-agent-operable-timeline-design.md`](../specs/2026-06-19-agent-operable-timeline-design.md).

## Status

Priority P2, Effort L (phased), planned at `ed891fd` (2026-06-19). Risk LOW
(A1), MEDIUM-HIGH (A2 — `ReviewContext` refactor), MEDIUM (B — MCP transport,
C — agent loop).

**Progress**: Phases A1-C implemented, incl. A2.3's authoritative inversion
(GUI edits run through the operations core, `decisions` map persisted, legacy
PUT autosave retired) and A2.4's `TimelineEditor` (reorder/extend/speed/
transform/split/remove + undo/redo). Backend tests green (248 + synthetic
e2e); frontend build green; docs shipped (README, MCP_SERVER, ARCHITECTURE,
runbook Flow F). **Remaining**: realtime speed/transform preview on the
player, chat token streaming (deferred, SSE still live-updates the timeline),
and several Playwright e2e specs (GUI live-update, speed/zoom, propose→accept)
— all pending visual QA on the Electron stack.

## Why this matters / decisions locked (see spec for rationale)

The timeline was GUI-only and thin (an ordered list of accepted candidate
clips plus per-clip trims, owned by the frontend `ReviewContext`) — not
agent-operable, unable to express real edits (split, extend, speed,
transform, multi-instance). Goal, per Palmier Pro's principle (*the editor is
a tool surface an agent drives on one live timeline*) while staying
**local-first, assist-don't-generate**: GUI, in-app review agent, and
external agents drive one shared, reversible operation set over a local MCP
server. Built in order **A (rich timeline document) → B (operation surface +
embedded MCP, SSE live-sync) → C (in-app chat + proactive review agent, an
MCP client of our own server)** — B and C stand on A. Agent reasons over
**existing local frame JPEGs** (same trust boundary as `pi_agent`), no new
asset pipeline. Editor ceiling: split, extend/retrim, reorder, multi-instance,
speed, transform — no transitions/audio/titles/color (YAGNI). **Backend-
authoritative** timeline; GUI live-updates via SSE; one operation set serves
GUI + chat + MCP, no parallel mutation path. In-app agent **proposes &
confirms**; external agents **apply** directly; **global undo/redo** covers both.

## Gotchas / out of scope

`decisions` map added to the Timeline Document so "rejected" vs "not
reviewed" survives persistence/reload. Two-writer risk (GUI + external agent)
mitigated by per-project operation serialization, not CRDT merge. EDL can't
express speed/transform — flatten + warn, accepted. Flow F real-footage QA
was authored for a human to run, not fabricated. `ReviewContext` refactor
(A2) was highest-risk; review e2e stayed green throughout. Out of scope
(YAGNI): transitions, audio/music, titles, color grading, multi-track,
keyframes, cross-machine collaboration, CRDT merge, on-timeline generation.
