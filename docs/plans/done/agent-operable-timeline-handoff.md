# Executor handoff: Agent-Operable Timeline

Status: EXECUTED 2026-06-19 in `431f51e`…`d012b60`; phases A1→A2→B→C were
built test-first and reached 243 backend tests plus synthetic E2E. The operator
explicitly waived the A1 review gate. Human real-footage Flow F remains.

## Goal and delivered architecture

One backend-authoritative Timeline Document and reversible Operations core now
serve GUI edits, an embedded `/mcp` server, live sync, and a propose-mode in-app
review agent. The implementation follows
`docs/specs/2026-06-19-agent-operable-timeline-design.md`.

- **A1/A2:** Timeline models, persistence/migration, locking, bounded undo/redo,
  HTTP operations, SSE, and GUI split/extend/speed/transform. FCPXML/Resolve XML
  preserve speed/transform; EDL flattens with an explicit warning.
- **B:** MCP tools map mutating calls 1:1 onto the Operations core; read tools
  expose candidates, timeline, project summary, and frame paths.
- **C:** the in-app agent uses the app's own MCP interface. Mutations become
  staged Proposals; Accept replays them through the core and Reject discards.

## Traps and remaining proof

The `ReviewContext` thin-client inversion was the highest blast-radius change;
existing accept/reject/reorder/trim behavior must remain covered. Automated QA
must not fabricate real-footage results. Flow F must still prove GUI and an
external MCP agent can edit the same project live, persistence survives reopen,
proposal→accept works, and Resolve XML opens without relink prompts.

Deferred at delivery: any unshipped GUI affordances, complete context inversion,
token streaming, and Playwright coverage must be judged from current code and
the active parent plan rather than assumed from this historical handoff.
