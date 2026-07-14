# MCP Server — controlling the timeline with an external agent

The AI Clip Assembler backend embeds a local **MCP Server** (Model Context
Protocol) while it runs, so an **External Agent** — Claude Code, Cursor, Codex —
can drive the *same* live **Timeline Document** the GUI is editing. Every edit
goes through the one reversible [operations core](../UBIQUITOUS_LANGUAGE.md), so
the GUI and an agent never drift, and every change lands in the **Undo History**.

> External agents **apply Operations directly** (you are driving them from the
> CLI). The in-app review agent instead **proposes** edits you accept or reject.

This page is the technical reference. If you just want to connect Claude
Desktop or Codex from inside the app, see the
[User Guide's "Connect your AI" section](USER_GUIDE.md#connect-your-ai-optional).

## Endpoint & port

- **URL:** `http://127.0.0.1:8000/mcp` (the backend's own port — no separate
  server or process; reuses the FastAPI app the GUI already talks to).
- **Transport:** JSON-RPC 2.0 over HTTP `POST`. One request per call.
- **Methods:** `initialize`, `tools/list`, `tools/call`, `ping`.

The backend must be running (launch the app, or `cd backend && PYTHONPATH=.
.venv/bin/uvicorn src.api:app`). If you run the backend on a non-default port,
use that port in the URL.

## Desktop Client Stdio Bridge

Packaged builds include a stdio MCP bridge:

```bash
ai-clip-backend --mcp-stdio --runtime-file /absolute/path/runtime.json
```

Claude Desktop and Codex spawn this command from their MCP config. The bridge is
stateless: on every tool call it re-reads `runtime.json`, forwards JSON-RPC to
`POST http://127.0.0.1:<port>/mcp`, and injects the active `project_id` when the
client omits it. If the app is closed, the runtime file is stale, or no project
is open, the bridge returns a model-readable MCP error instead of crashing.

## Tools

Every tool takes a `project_id` argument (MCP calls are stateless). Open the
project in the app first; the `project_id` is in the app/devtools or from
`get_project_summary`.

### Mutating tools (1:1 with the operations core)

| Tool | Arguments (besides `project_id`) |
| --- | --- |
| `add_item` | `source_clip_id`, `at_index?` |
| `remove_item` | `item_id` |
| `split_item` | `item_id`, `at_sec` |
| `set_bounds` | `item_id`, `start_sec`, `end_sec` (trim **and** extend; clamped to source) |
| `reorder` | `item_id`, `to_index` |
| `set_speed` | `item_id`, `speed` |
| `set_transform` | `item_id`, `transform` `{scale, x, y}` |
| `include` / `exclude` | `clip_id` (review-board accept/reject) |
| `set_profile` / `set_target_duration` | `profile?` / `target_duration_sec?` |
| `undo` / `redo` | — |

Each mutating call returns the resolved Timeline Document and emits a
`timeline-changed` event, so the GUI updates live.

### Read tools

| Tool | Returns |
| --- | --- |
| `list_candidates` | Candidate clips with scores + **Clip Reason** |
| `get_timeline` | The current Timeline Document |
| `get_project_summary` | Name + video/candidate/timeline-item counts |
| `get_frame_paths` | Local frame JPEG paths for a candidate clip (`clip_id`) |

`get_frame_paths` returns the **existing local frame JPEGs** so the agent reads
the images directly — exactly the same trust boundary as
[`pi_cli_harness.py`](../backend/src/pi_cli_harness.py) (which attaches frames as
`@path`). Source video files never leave the machine.

## Connecting Claude Code / Cursor

Add the backend as an MCP server over HTTP. For Claude Code:

```bash
claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp
```

For Cursor, add to `~/.cursor/mcp.json` (or the project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "clip-assembler": { "url": "http://127.0.0.1:8000/mcp" }
  }
}
```

Then ask the agent to `list_candidates` for your open `project_id`, read frames
with `get_frame_paths`, and apply edits (`include`, `set_speed`, `split_item`,
…). Watch them appear live in the app.

## Quick smoke test (no agent)

```bash
curl -s http://127.0.0.1:8000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool
```

## Verified real-agent round-trip (human step)

Automated tests cover the tool handlers and the HTTP `/mcp` dispatch
(`backend/tests/test_mcp_server.py`, `backend/tests/test_api.py`). The
**real Claude Code connection** check is a manual step — run it during the
real-footage validation session and record the result here:

```
- [ ] Date / Claude Code version:
- [ ] `tools/list` returned the tool set:
- [ ] `list_candidates` returned candidates for the open project:
- [ ] Applied one operation (e.g. `include`) and saw it live in the GUI:
- [ ] Notes:
```

> Never commit footage or footage-derived reports.
