# Connect Your AI MCP Implementation Plan

**Status:** DONE (2026-07-02) — Tasks 1-6 implemented, automated verification green. Task 7's live-client smoke test was intentionally not run (requires a human with Claude Desktop/Codex).

**Goal:** Let Editors connect Claude Desktop or Codex to AI Clip Assembler so their own MCP-capable desktop client can inspect Candidate Clips and edit the live Timeline Document through the existing MCP tools.

**Architecture:** A runtime descriptor (`runtime.json`, port/pid/active project) is written by the backend on startup and on project activation. A packaged-backend `--mcp-stdio` mode bridges stdio JSON-RPC to the running app's `POST /mcp` endpoint, injecting `project_id` when the client omits it. Electron IPC merges MCP server entries into Claude Desktop / Codex config files, always with a timestamped backup. All Timeline edits still flow through the existing operations core, undo history, persistence, and SSE live-sync — no second mutation path was added.

**Key decisions / constraints:**
- v1 is review-and-edit only; connected clients do not score clips during analysis.
- Only locally installed MCP stdio clients (Claude Desktop, Codex) are supported — no remote Streamable HTTP, tunneling, hosting, OAuth, or ChatGPT/OpenAI desktop connector.
- The bridge is stateless: it re-reads `runtime.json` on every call rather than caching state.
- Config writes must merge with existing file content and never clobber unrelated MCP servers.
- Footage and project data stay local; no upload path introduced.

**Surprises / gotchas:**
- The bridge returns a model-friendly MCP error (code -32000, "Open AI Clip Assembler and a project, then retry.") instead of crashing when the app is closed or no project is active — this was necessary for a decent UX from the connected client's perspective.
- Backend target is Python 3.9 (`backend/pyproject.toml` pins `py39`) — no `match` statements or runtime `X | Y` unions.

**Status of components (all done unless noted):**
- `backend/src/runtime_descriptor.py` — resolve/read/write runtime descriptor; `POST /projects/{id}/activate` endpoint.
- `backend/src/mcp_bridge.py` — stdio bridge (`ai-clip-backend --mcp-stdio --runtime-file <path>`), forwards `initialize`/`tools/list`/`tools/call`/`ping`.
- `frontend/src/main/mcpConnect.ts` — pure detect/merge adapters for Claude Desktop (JSON) and Codex (TOML) configs.
- Electron main/preload/client wiring for `mcp:detect-clients` / `mcp:connect-client` IPC.
- Settings modal "Connect your AI" tab showing per-client install/connect/needs-restart status plus a manual config snippet fallback.
- `frontend/src/renderer/src/state/ReviewContext.tsx` calls `activateProject` when a project opens.
- Docs: `docs/MCP_SERVER.md` (stdio bridge section), `docs/VALIDATION_RUNBOOK.md` (Flow G manual validation, 11 steps covering connect → tool calls → Timeline live update → app-closed error).

Final verification: backend pytest suite, `ruff check`, frontend typecheck/lint/build all passed. The only unchecked item is the live Claude Desktop/Codex smoke test (Task 7 Step 4), left for a human.
