# Design: Bring-Your-Own-Subscription via MCP connect (Claude Desktop / Codex)

- **Date**: 2026-06-28
- **Status**: Approved (brainstorming) — pending implementation plan
- **Author**: architecture session
- **Related**: `docs/MCP_SERVER.md`, `docs/specs/2026-06-19-agent-operable-timeline-design.md`, `backend/src/mcp_server.py`, `docs/HARNESS_SPEC.md`

## Problem

Today the app's AI requires a working `pi` CLI setup (provider + model env config)
to power both clip scoring and the in-app Review agent. Non-technical users
without that setup get only the rule-based ("manual") harness. We want regular
people to use the AI subscriptions they already have — Claude Pro/Max, ChatGPT,
Codex — without API keys or a `pi` install.

Consumer subscriptions do **not** expose a programmatic API, so the app cannot
"log in and call the model." The feasible direction is the inverse: the user's
**own MCP-capable desktop client** (Claude Desktop, Codex, OpenAI desktop)
connects *into* this app's MCP server and drives it. Inference is billed to the
user's subscription inside their client; the app only exposes tools.

## Scope

**In scope (v1):**
- **Review & edit only.** The connected client inspects candidate clips and
  edits the working Timeline (reorder, trim, set bounds, speed, include/exclude,
  set profile, etc.) via the **existing** `/mcp` tool catalogue.
- **One-click connect** for locally-installed clients that speak MCP over
  **stdio**: **Claude Desktop** and **Codex** are the confirmed targets.
- Drift-free: chat edits flow through the same operations core + SSE live-sync
  the GUI uses (no second mutation path).

**Out of scope (v1):**
- Clip scoring via the connected model. Non-`pi` users keep the rule-based
  "manual" harness for analysis. (Batch vision over a chat client is an awkward
  fit; revisit separately.)
- ChatGPT/OpenAI desktop as a **remote** connector (public HTTPS + OAuth). The
  OpenAI desktop app's *local* MCP support is uncertain; treat it as best-effort
  detection in v1 and a fast-follow if its local stdio path is viable. **Do not**
  build tunneling/hosting/OAuth in v1.
- Streamable-HTTP URL transport (Approach B). Architect so it can be added later,
  but ship stdio only.

## Approach (chosen)

**Thin stdio bridge to the running app.** A small, stateless, client-spawnable
command speaks MCP over stdio and forwards `tools/list` / `tools/call` to the
running app's existing `/mcp` JSON-RPC on `127.0.0.1:<port>`. The app remains the
single source of truth; GUI and chat drive the same live Timeline Document.

Rejected alternatives:
- **Streamable-HTTP URL (B):** local-URL MCP support is uneven across the three
  clients today; stdio is the universal local transport. Deferred, not dropped.
- **Embed full server in the stdio process reading project JSON from disk (C):**
  creates a second mutation path → drift and stale state when the app is also
  open. Violates the single-source-of-truth the timeline architecture protects.

## Components

### 1. MCP stdio bridge — `ai-clip-backend --mcp-stdio`
A **mode of the already-bundled backend executable** (not a new binary, so
nothing extra to ship/sign). Behaviour:
- Reads the runtime descriptor path from `--runtime-file <abs>` (and falls back
  to the conventional location, below).
- Speaks MCP JSON-RPC over stdio (newline/Content-Length framing per the MCP
  stdio transport): handles `initialize`, `tools/list`, `tools/call`,
  forwarding each to `POST http://127.0.0.1:<port>/mcp`.
- **Injects `project_id = active_project_id`** into tool-call arguments when the
  caller omits it, so users/models never deal with UUIDs.
- Re-reads `runtime.json` on each call (cheap) so an app restart on a new port
  self-heals without reconfiguring the client.
- On unreachable app / missing-or-stale runtime / no active project: returns a
  model-friendly MCP error result (not a crash).
- Stateless; ~100 lines. Lives at `backend/src/mcp_bridge.py`, invoked via a
  CLI flag wired into the backend entrypoint.

### 2. Runtime descriptor — `runtime.json`
Written by the backend; read by the bridge. Contents:
`{ "port": <int>, "pid": <int>, "active_project_id": <str|null>, "updated_at": <iso> }`
- **Location**: an absolute path chosen by Electron (under
  `app.getPath('userData')/.ai-clip-assembler/runtime.json`), passed to the
  backend on spawn via `CLIP_ASSEMBLER_RUNTIME_FILE` **and** embedded in the
  client config `args`. A conventional fallback (`~/.ai-clip-assembler/runtime.json`)
  is used in dev when the env var is absent. Both backend and bridge resolve it
  through one shared helper so they never disagree.
- The backend writes `{port, pid}` on startup (it already receives
  `CLIP_ASSEMBLER_PORT`) and updates `active_project_id` when the active project
  changes.

### 3. Active-project tracking
The open project is currently a frontend notion. Add:
- Backend: `POST /projects/{id}/activate` (or fold into existing open/create
  flow) that records the active project and rewrites `runtime.json`.
- Frontend: notify the backend when the open project changes (the
  `ReviewContext` already tracks `projectId`).

### 4. Auto-configure module (Electron main)
Per-client adapters that detect, back up, and merge an MCP-server entry:
- **Claude Desktop** (JSON): `~/Library/Application Support/Claude/claude_desktop_config.json`
  → merge into `mcpServers["ai-clip-assembler"] = { command, args }`.
- **Codex** (TOML): `~/.codex/config.toml` → merge into
  `[mcp_servers.ai-clip-assembler]` with `command` / `args`.
- **OpenAI desktop**: deferred to a fast-follow (not v1). Wire the same adapter
  once a local stdio config path is confirmed; until then it is not offered.
- `command` = absolute path to the bundled backend executable
  (`process.resourcesPath/backend/ai-clip-backend`, reusing the existing
  resolution in `startPackagedBackend`); `args = ["--mcp-stdio", "--runtime-file", "<abs>"]`.
- Always write a timestamped backup of the target config first. **Merge, never
  clobber** other servers. Abort with guidance on malformed config. On write
  failure, fall back to showing the exact snippet + path.

### 5. "Connect your AI" Settings panel
Extend the existing `SettingsModal`:
- List detected clients with status (installed / connected / needs restart).
- A **Connect** button per client → calls the Electron auto-configure over IPC.
- After success: "Connected — restart <client> to finish." Live status flips
  once a bridge process successfully reaches `/mcp`.
- Manual-snippet fallback shown only when auto-configure can't write.

## Data flow

**Setup (per client):** Settings → Connect → Electron backs up + merges config →
"restart your client."

**Session:** client spawns `ai-clip-backend --mcp-stdio --runtime-file <abs>` →
bridge reads `runtime.json` → `tools/list` and `tools/call` forwarded to
`127.0.0.1:<port>/mcp` → the **same** `TimelineController` + ops core applies
edits → GUI updates live via existing SSE. The bridge injects the active
`project_id` when omitted.

## Error handling

| Condition | Behaviour |
|---|---|
| App not running / stale runtime (dead pid, closed port) | Bridge returns MCP error: "Open AI Clip Assembler and a project, then retry." No crash. |
| No active project | Project-needing tools return "No project open in the app." |
| Concurrent GUI + chat edit | Existing `TimelineRevisionConflict` surfaced as MCP error; model re-reads + retries. |
| Malformed client config | Auto-configure aborts, shows the snippet + path; original untouched. |
| Config write fails (perms) | Graceful degrade to guided copy-paste. |
| Client not installed | Connect button disabled with a hint. |

Security: localhost-only; no new network surface; only the user's own client
configs are modified, with backup.

## Testing

- **Backend**: unit-test the bridge — stdio JSON-RPC framing, runtime discovery,
  active-project injection, unreachable-app error (mock `httpx`); test the
  active-project endpoint + runtime writer. Existing `/mcp` server tests
  unchanged and green.
- **Auto-configure**: unit-test the Claude-JSON and Codex-TOML merge adapters —
  merge-not-clobber, backup created, idempotent re-connect, malformed-abort.
  Pure functions, no real client required.
- **Manual runbook**: new "Flow G" in `docs/VALIDATION_RUNBOOK.md` — connect
  Claude Desktop, restart, issue an edit, watch the GUI update live. (External
  desktop clients can't be driven by Playwright.)

## Open questions / follow-ups

- Confirm the OpenAI desktop app's local MCP stdio config path; if viable, add
  its adapter; else document as unsupported-locally for now.
- Phase 2: Streamable-HTTP URL transport for URL-capable clients (Approach B),
  reusing the same `TimelineMCPServer`.
- Phase 2: clip scoring via a connected model (separate design — batch vision
  ergonomics).
- Verify exact MCP stdio framing expected by Claude Desktop and Codex against
  the current MCP spec revision before implementing the transport.
