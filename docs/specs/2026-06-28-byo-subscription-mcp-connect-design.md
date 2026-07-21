# Design: Bring Your Own Subscription via MCP

Date: 2026-06-28 · Status: Approved, pending implementation plan. Related:
`MCP_SERVER.md`, agent-operable Timeline design, `mcp_server.py`, `HARNESS_SPEC.md`.

## Problem and scope

Consumer Claude/ChatGPT subscriptions provide no programmatic API the app can
call. Instead, the user's MCP-capable desktop client connects into the app and
pays for inference inside that subscription. V1 supports review/edit through
the existing `/mcp` tools and one-click local stdio setup for Claude Desktop and
Codex. Manual Harness still performs clip scoring.

Out of scope: connected-model scoring, public HTTPS/OAuth/tunnels, confirmed
OpenAI desktop support, and streamable HTTP. Those remain separate follow-ups.

## Chosen architecture

A thin stateless stdio bridge forwards MCP JSON-RPC to the running app's local
`/mcp`; the live backend remains the sole Timeline owner. Streamable HTTP was
deferred due to uneven local-client support. A second server reading project
JSON was rejected because it creates stale state and a competing mutation path.

### Bridge

`ai-clip-backend --mcp-stdio --runtime-file <abs>` reuses the signed backend
binary. It handles initialize/tools list/call, rereads runtime state each call,
and injects active `project_id` when omitted. Missing app/runtime/project returns
model-friendly MCP errors, never crashes. Confirm framing against the current
MCP spec for both clients before implementation.

### Runtime and active project

Electron chooses an absolute user-data `runtime.json` and passes it to backend
and client config. It contains port, pid, active project ID, and timestamp;
backend updates it on startup and project activation. One shared resolver also
offers a dev fallback under the user's app data. A project activation endpoint
connects frontend open-project state to the descriptor.

### Client configuration

Electron main owns per-client adapters:

- Claude Desktop JSON: merge `mcpServers.ai-clip-assembler`.
- Codex TOML: merge `[mcp_servers.ai-clip-assembler]`.

Command is the absolute packaged backend; args select stdio and runtime file.
Every write creates a timestamped backup, merges without clobbering other MCP
servers, is idempotent, and aborts on malformed input. Permission/write failure
shows an exact manual snippet and path. OpenAI desktop is offered only after a
real local stdio config path is confirmed.

### Settings UX and flow

“Connect your AI” lists installed/connected/restart-needed clients. Connect
invokes auto-configure; success asks for client restart. Manual snippets appear
only on write failure. Client then spawns bridge → bridge reads runtime → tools
forward to `/mcp` → Operations core edits → existing SSE updates the GUI.

## Errors and security

- Dead app/stale runtime: “Open AI Clip Assembler and a project, then retry.”
- No project: project tools return “No project open in the app.”
- Revision conflict: MCP error; model rereads and retries.
- Malformed config: original untouched; snippet/path shown.
- Missing client: disabled control with hint.

Localhost only; no new public network surface. Client config mutation is the
only external write and is recoverable from its backup.

## Tests and follow-ups

Unit-test bridge framing, runtime discovery, project injection, unreachable app,
activation writer, JSON/TOML merge-not-clobber, backups, idempotency, and
malformed abort. Keep existing MCP tests green. Flow G manually connects Claude
Desktop, restarts it, applies an edit, and observes live GUI update.

Follow-ups: confirm OpenAI desktop stdio, add streamable HTTP if useful, and
separately design batch-vision scoring through a connected client.
