# Connect Your AI MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Editors connect Claude Desktop or Codex to AI Clip Assembler so their own MCP-capable desktop client can inspect Candidate Clips and edit the live Timeline Document through the existing MCP tools.

**Architecture:** Add a runtime descriptor owned by the backend, a packaged-backend `--mcp-stdio` mode that forwards MCP stdio JSON-RPC to the running `/mcp` HTTP endpoint, and Electron IPC that safely merges MCP server entries into supported client configs. The Settings modal exposes a small "Connect your AI" surface; all Timeline edits still flow through the existing operations core, undo history, persistence, and SSE live-sync.

**Tech Stack:** Python 3.9 (project target — `backend/pyproject.toml` sets `target-version = "py39"`, venv is 3.9.6; do NOT use 3.10+ syntax such as `match` or runtime `X | Y` unions), FastAPI, httpx, pytest, Electron main/preload, React 19, TypeScript, Node `fs/promises`, Claude Desktop JSON config, Codex TOML config.

## Global Constraints

- Keep Source Videos and project data local; no footage upload is introduced by this feature.
- v1 is **review and edit only**; connected clients do not score clips during analysis.
- v1 supports locally installed MCP stdio clients: Claude Desktop and Codex.
- Do not build remote Streamable HTTP, public tunneling, hosting, OAuth, or ChatGPT/OpenAI desktop remote connector support in this plan.
- The bridge must be stateless and must forward to the running app's existing `POST /mcp` endpoint.
- `project_id` is injected from the active project when the connected client omits it.
- The app remains the single Timeline Document source of truth; do not add a second mutation path.
- Client config writes must create timestamped backups, merge existing config, and never clobber unrelated MCP servers.
- Plans live in `docs/plans/`; completed plans move to `docs/plans/done/`.

---

## File Structure

- Create `backend/src/runtime_descriptor.py`: shared helper for resolving, reading, and writing `runtime.json`.
- Create `backend/src/mcp_bridge.py`: stdio MCP transport bridge that forwards JSON-RPC to the app's HTTP `/mcp`.
- Modify `backend/packaging/entry.py`: route `--mcp-stdio` to the bridge; otherwise start uvicorn as today.
- Modify `backend/src/api.py`: write the runtime descriptor on startup, expose project activation, and keep active project state current.
- Test `backend/tests/test_runtime_descriptor.py`: runtime path, write/read, active project updates.
- Test `backend/tests/test_mcp_bridge.py`: initialize/list/call forwarding, active project injection, app-unreachable error.
- Modify `backend/tests/test_api.py`: active-project endpoint and runtime descriptor integration.
- Create `frontend/src/main/mcpConnect.ts`: pure client detection and config-merge adapters for Claude Desktop and Codex.
- Modify `frontend/src/main/index.ts`: compute runtime-file path, pass it to packaged backend, and register MCP connect IPC handlers.
- Modify `frontend/src/preload/index.ts`: expose connect/detect IPC methods.
- Modify `frontend/src/renderer/src/api/client.ts`: typed frontend helpers for MCP client detection and connection.
- Modify `frontend/src/renderer/src/components/SettingsModal.tsx`: add "Connect your AI" tab/panel.
- Modify `frontend/src/renderer/src/styles.css`: small styles for client status rows, manual snippets, and connect feedback.
- Modify `docs/VALIDATION_RUNBOOK.md`: add Flow G manual validation for Claude Desktop/Codex connection.
- Modify `docs/MCP_SERVER.md`: document the new stdio bridge and active-project behavior.
- Modify `docs/plans/README.md`: add this plan to Product plans.

## Task 1: Runtime Descriptor And Active Project

**Files:**
- Create: `backend/src/runtime_descriptor.py`
- Modify: `backend/src/api.py`
- Test: `backend/tests/test_runtime_descriptor.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `resolve_runtime_file(explicit: str | None = None) -> Path`
- Produces: `read_runtime_descriptor(path: Path | None = None) -> RuntimeDescriptor | None`
- Produces: `write_runtime_descriptor(*, port: int, pid: int, active_project_id: str | None, path: Path | None = None) -> RuntimeDescriptor`
- Produces: `set_active_project(project_id: str | None) -> RuntimeDescriptor`
- Produces API: `POST /projects/{project_id}/activate -> {"project_id": str, "active": true}`
- Consumes: `CLIP_ASSEMBLER_RUNTIME_FILE`, `CLIP_ASSEMBLER_PORT`, existing `projects` dict.

- [ ] **Step 1: Write failing runtime descriptor tests**

Add `backend/tests/test_runtime_descriptor.py`:

```python
import json
import os

from src.runtime_descriptor import (
    RuntimeDescriptor,
    read_runtime_descriptor,
    resolve_runtime_file,
    write_runtime_descriptor,
)


def test_resolve_runtime_file_prefers_explicit_path(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(tmp_path / "env.json"))
    explicit = tmp_path / "explicit.json"

    assert resolve_runtime_file(str(explicit)) == explicit


def test_resolve_runtime_file_uses_environment(tmp_path, monkeypatch):
    runtime_path = tmp_path / "runtime.json"
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(runtime_path))

    assert resolve_runtime_file() == runtime_path


def test_write_and_read_runtime_descriptor(tmp_path):
    runtime_path = tmp_path / "runtime.json"

    written = write_runtime_descriptor(
        port=8123,
        pid=456,
        active_project_id="project-1",
        path=runtime_path,
    )

    assert written.port == 8123
    assert written.pid == 456
    assert written.active_project_id == "project-1"
    payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert payload["port"] == 8123
    assert payload["pid"] == 456
    assert payload["active_project_id"] == "project-1"
    assert isinstance(payload["updated_at"], str)
    assert read_runtime_descriptor(runtime_path) == RuntimeDescriptor(**payload)


def test_read_runtime_descriptor_missing_file_returns_none(tmp_path):
    assert read_runtime_descriptor(tmp_path / "missing.json") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_runtime_descriptor.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'src.runtime_descriptor'`.

- [ ] **Step 3: Implement runtime descriptor helper**

Create `backend/src/runtime_descriptor.py`:

```python
"""Runtime descriptor shared by the app backend and MCP stdio bridge."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel


class RuntimeDescriptor(BaseModel):
    port: int
    pid: int
    active_project_id: str | None = None
    updated_at: str


def resolve_runtime_file(explicit: str | None = None) -> Path:
    configured = explicit or os.environ.get("CLIP_ASSEMBLER_RUNTIME_FILE")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".ai-clip-assembler" / "runtime.json"


def read_runtime_descriptor(path: Path | None = None) -> RuntimeDescriptor | None:
    runtime_path = path or resolve_runtime_file()
    if not runtime_path.exists():
        return None
    return RuntimeDescriptor.model_validate_json(runtime_path.read_text(encoding="utf-8"))


def write_runtime_descriptor(
    *,
    port: int,
    pid: int,
    active_project_id: str | None,
    path: Path | None = None,
) -> RuntimeDescriptor:
    runtime_path = path or resolve_runtime_file()
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = RuntimeDescriptor(
        port=port,
        pid=pid,
        active_project_id=active_project_id,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    runtime_path.write_text(descriptor.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return descriptor
```

- [ ] **Step 4: Run runtime descriptor tests**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_runtime_descriptor.py -v
```

Expected: PASS.

- [ ] **Step 5: Write failing API activation tests**

Append to `backend/tests/test_api.py`:

```python
def test_activate_project_records_runtime_descriptor(monkeypatch, tmp_path):
    api.projects.clear()
    runtime_path = tmp_path / "runtime.json"
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(runtime_path))
    monkeypatch.setenv("CLIP_ASSEMBLER_PORT", "8765")
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]

    response = client.post(f"/projects/{project_id}/activate")

    assert response.status_code == 200
    assert response.json() == {"project_id": project_id, "active": True}
    payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert payload["port"] == 8765
    assert payload["active_project_id"] == project_id


def test_activate_missing_project_returns_404(tmp_path, monkeypatch):
    api.projects.clear()
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(tmp_path / "runtime.json"))
    client = TestClient(api.app)

    response = client.post("/projects/missing/activate")

    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"
```

- [ ] **Step 6: Run activation tests to verify they fail**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py::test_activate_project_records_runtime_descriptor tests/test_api.py::test_activate_missing_project_returns_404 -v
```

Expected: FAIL with `404` for the missing endpoint.

- [ ] **Step 7: Implement backend runtime writes and activation endpoint**

Modify `backend/src/api.py` imports:

```python
from .runtime_descriptor import write_runtime_descriptor
```

Add near global state:

```python
_active_project_id: str | None = None


def _runtime_port() -> int:
    return int(os.environ.get("CLIP_ASSEMBLER_PORT", "8000"))


def _write_runtime(active_project_id: str | None = None) -> None:
    write_runtime_descriptor(
        port=_runtime_port(),
        pid=os.getpid(),
        active_project_id=active_project_id,
    )
```

Add a startup hook after middleware setup:

```python
@app.on_event("startup")
async def write_runtime_on_startup():
    _write_runtime(_active_project_id)
```

Add endpoint after project creation/opening endpoints:

```python
@app.post("/projects/{project_id}/activate")
async def activate_project(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    global _active_project_id
    _active_project_id = project_id
    _write_runtime(project_id)
    return {"project_id": project_id, "active": True}
```

In `delete_project_owned_files`, before deleting `projects[project_id]`, clear active state when needed:

```python
    global _active_project_id
    if _active_project_id == project_id:
        _active_project_id = None
        _write_runtime(None)
```

- [ ] **Step 8: Run API activation tests**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py::test_activate_project_records_runtime_descriptor tests/test_api.py::test_activate_missing_project_returns_404 -v
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add backend/src/runtime_descriptor.py backend/src/api.py backend/tests/test_runtime_descriptor.py backend/tests/test_api.py
git commit -m "feat: track active project runtime descriptor"
```

## Task 2: MCP Stdio Bridge

**Files:**
- Create: `backend/src/mcp_bridge.py`
- Modify: `backend/packaging/entry.py`
- Test: `backend/tests/test_mcp_bridge.py`

**Interfaces:**
- Consumes: `read_runtime_descriptor`, `resolve_runtime_file`
- Produces: `run_mcp_stdio(runtime_file: str | None = None) -> None`
- Produces CLI: `ai-clip-backend --mcp-stdio --runtime-file <abs>`
- Produces bridge behavior: forwards `initialize`, `tools/list`, `tools/call`, `ping`; injects `project_id` on `tools/call` when active.

- [ ] **Step 1: Write failing bridge tests**

Create `backend/tests/test_mcp_bridge.py`:

```python
import json

import pytest

from src.runtime_descriptor import write_runtime_descriptor


@pytest.mark.asyncio
async def test_bridge_forwards_tools_list(monkeypatch, tmp_path):
    from src import mcp_bridge

    runtime_path = tmp_path / "runtime.json"
    write_runtime_descriptor(port=8123, pid=12345, active_project_id="p1", path=runtime_path)
    captured = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "get_timeline"}]}}

    async def fake_post(self, url, json):
        captured["url"] = url
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setattr(mcp_bridge.httpx.AsyncClient, "post", fake_post)

    bridge = mcp_bridge.MCPStdioBridge(str(runtime_path))
    result = await bridge.handle_message({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})

    assert captured["url"] == "http://127.0.0.1:8123/mcp"
    assert captured["json"]["method"] == "tools/list"
    assert result["result"]["tools"][0]["name"] == "get_timeline"


@pytest.mark.asyncio
async def test_bridge_injects_active_project_id(monkeypatch, tmp_path):
    from src import mcp_bridge

    runtime_path = tmp_path / "runtime.json"
    write_runtime_descriptor(port=8123, pid=12345, active_project_id="project-active", path=runtime_path)
    captured = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"jsonrpc": "2.0", "id": 3, "result": {"content": []}}

    async def fake_post(self, url, json):
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setattr(mcp_bridge.httpx.AsyncClient, "post", fake_post)

    bridge = mcp_bridge.MCPStdioBridge(str(runtime_path))
    await bridge.handle_message(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "get_timeline", "arguments": {}},
        }
    )

    assert captured["json"]["params"]["arguments"]["project_id"] == "project-active"


@pytest.mark.asyncio
async def test_bridge_returns_model_friendly_error_when_app_unreachable(monkeypatch, tmp_path):
    from src import mcp_bridge

    runtime_path = tmp_path / "runtime.json"
    write_runtime_descriptor(port=8123, pid=12345, active_project_id="project-active", path=runtime_path)

    async def fake_post(self, url, json):
        raise mcp_bridge.httpx.ConnectError("connection refused")

    monkeypatch.setattr(mcp_bridge.httpx.AsyncClient, "post", fake_post)

    bridge = mcp_bridge.MCPStdioBridge(str(runtime_path))
    result = await bridge.handle_message({"jsonrpc": "2.0", "id": 4, "method": "tools/list"})

    assert result["error"]["code"] == -32000
    assert "Open AI Clip Assembler and a project" in result["error"]["message"]
```

- [ ] **Step 2: Run bridge tests to verify they fail**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_mcp_bridge.py -v
```

Expected: FAIL with `ImportError` for `src.mcp_bridge`.

- [ ] **Step 3: Implement bridge**

Create `backend/src/mcp_bridge.py`:

```python
"""MCP stdio bridge for desktop clients that spawn a local command."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

import httpx

from .runtime_descriptor import read_runtime_descriptor, resolve_runtime_file


class MCPStdioBridge:
    def __init__(self, runtime_file: str | None = None) -> None:
        self.runtime_file = resolve_runtime_file(runtime_file)

    async def handle_message(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        message_id = message.get("id")
        if message_id is None and method != "ping":
            return None

        descriptor = read_runtime_descriptor(self.runtime_file)
        if descriptor is None:
            return self._error(message_id, "Open AI Clip Assembler and a project, then retry.")

        forwarded = json.loads(json.dumps(message))
        if method == "tools/call":
            params = forwarded.setdefault("params", {})
            arguments = params.setdefault("arguments", {})
            if "project_id" not in arguments:
                if descriptor.active_project_id is None:
                    return self._error(message_id, "No project open in the app.")
                arguments["project_id"] = descriptor.active_project_id

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f"http://127.0.0.1:{descriptor.port}/mcp", json=forwarded)
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, OSError, json.JSONDecodeError):
            return self._error(message_id, "Open AI Clip Assembler and a project, then retry.")

    @staticmethod
    def _error(message_id: Any, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": message_id, "error": {"code": -32000, "message": message}}


async def _run_loop(runtime_file: str | None = None) -> None:
    bridge = MCPStdioBridge(runtime_file)
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if line == "":
            return
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            response = await bridge.handle_message(message)
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


def run_mcp_stdio(runtime_file: str | None = None) -> None:
    asyncio.run(_run_loop(runtime_file))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-file")
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    run_mcp_stdio(args.runtime_file)
```

- [ ] **Step 4: Wire packaged entrypoint**

Modify `backend/packaging/entry.py`:

```python
"""Packaged FastAPI backend entry point for the Electron app."""

from __future__ import annotations

import os
import sys

import uvicorn


def main() -> None:
    if "--mcp-stdio" in sys.argv:
        from src.mcp_bridge import parse_args, run_mcp_stdio

        args = parse_args([arg for arg in sys.argv[1:] if arg != "--mcp-stdio"])
        run_mcp_stdio(args.runtime_file)
        return

    port = int(os.environ.get("CLIP_ASSEMBLER_PORT", "8000"))
    uvicorn.run("src.api:app", host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run bridge tests**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_mcp_bridge.py -v
```

Expected: PASS.

- [ ] **Step 6: Run MCP and API regression tests**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest tests/test_mcp_server.py tests/test_mcp_bridge.py tests/test_runtime_descriptor.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/src/mcp_bridge.py backend/packaging/entry.py backend/tests/test_mcp_bridge.py
git commit -m "feat: add mcp stdio bridge"
```

## Task 3: Electron MCP Client Config Adapters

**Files:**
- Create: `frontend/src/main/mcpConnect.ts`
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`

**Interfaces:**
- Produces: `detectMcpClients(command: string, runtimeFile: string): Promise<McpClientStatus[]>`
- Produces: `connectMcpClient(clientId: McpClientId, command: string, runtimeFile: string): Promise<McpConnectResult>`
- Produces IPC: `mcp:detect-clients`, `mcp:connect-client`
- Produces preload methods: `detectMcpClients()`, `connectMcpClient(clientId)`

- [ ] **Step 1: Create adapter module with exported types and pure merge functions**

Create `frontend/src/main/mcpConnect.ts`:

```ts
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type McpClientId = 'claude_desktop' | 'codex';

export interface McpClientStatus {
  id: McpClientId;
  name: string;
  configPath: string;
  installed: boolean;
  connected: boolean;
  needsRestart: boolean;
}

export interface McpConnectResult extends McpClientStatus {
  backupPath?: string;
  snippet: string;
}

const SERVER_NAME = 'ai-clip-assembler';

function serverConfig(command: string, runtimeFile: string) {
  return { command, args: ['--mcp-stdio', '--runtime-file', runtimeFile] };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function claudeConfigPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

export function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

export function mergeClaudeConfig(raw: string, command: string, runtimeFile: string): string {
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  const next = {
    ...parsed,
    mcpServers: {
      ...(parsed.mcpServers ?? {}),
      [SERVER_NAME]: serverConfig(command, runtimeFile),
    },
  };
  return JSON.stringify(next, null, 2) + '\n';
}

export function mergeCodexConfig(raw: string, command: string, runtimeFile: string): string {
  const lines = raw.split(/\r?\n/).filter((line) => !line.startsWith('[mcp_servers.ai-clip-assembler]'));
  const filtered = lines.filter(
    (line, index, all) =>
      !(index > 0 && all[index - 1] === '[mcp_servers.ai-clip-assembler]') &&
      !line.startsWith('command = ') &&
      !line.startsWith('args = '),
  );
  const suffix = [
    '',
    '[mcp_servers.ai-clip-assembler]',
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(['--mcp-stdio', '--runtime-file', runtimeFile])}`,
    '',
  ].join('\n');
  return filtered.join('\n').trimEnd() + suffix;
}

async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function writeWithBackup(path: string, content: string): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (existsSync(path)) {
    backupPath = `${path}.${timestamp()}.bak`;
    await copyFile(path, backupPath);
  }
  await writeFile(path, content, 'utf-8');
  return backupPath;
}

function snippetFor(clientId: McpClientId, command: string, runtimeFile: string): string {
  if (clientId === 'claude_desktop') {
    return JSON.stringify({ mcpServers: { [SERVER_NAME]: serverConfig(command, runtimeFile) } }, null, 2);
  }
  return [
    '[mcp_servers.ai-clip-assembler]',
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(['--mcp-stdio', '--runtime-file', runtimeFile])}`,
  ].join('\n');
}

export async function detectMcpClients(command: string, runtimeFile: string): Promise<McpClientStatus[]> {
  const clients: Array<{ id: McpClientId; name: string; path: string; merge: (raw: string) => string }> = [
    { id: 'claude_desktop', name: 'Claude Desktop', path: claudeConfigPath(), merge: (raw) => mergeClaudeConfig(raw, command, runtimeFile) },
    { id: 'codex', name: 'Codex', path: codexConfigPath(), merge: (raw) => mergeCodexConfig(raw, command, runtimeFile) },
  ];
  return Promise.all(
    clients.map(async (client) => {
      const raw = await readConfig(client.path);
      const connected = raw.includes(SERVER_NAME) && raw.includes(runtimeFile);
      return {
        id: client.id,
        name: client.name,
        configPath: client.path,
        installed: existsSync(dirname(client.path)),
        connected,
        needsRestart: connected,
      };
    }),
  );
}

export async function connectMcpClient(
  clientId: McpClientId,
  command: string,
  runtimeFile: string,
): Promise<McpConnectResult> {
  const configPath = clientId === 'claude_desktop' ? claudeConfigPath() : codexConfigPath();
  const raw = await readConfig(configPath);
  const next = clientId === 'claude_desktop'
    ? mergeClaudeConfig(raw, command, runtimeFile)
    : mergeCodexConfig(raw, command, runtimeFile);
  const backupPath = await writeWithBackup(configPath, next);
  const [status] = (await detectMcpClients(command, runtimeFile)).filter((item) => item.id === clientId);
  return { ...status, backupPath, snippet: snippetFor(clientId, command, runtimeFile) };
}
```

- [ ] **Step 2: Run typecheck to expose any TS errors**

Run:

```bash
cd frontend
npm run typecheck
```

Expected: PASS after this pure module is syntactically valid.

- [ ] **Step 3: Wire runtime file and IPC in Electron main**

Modify imports in `frontend/src/main/index.ts`:

```ts
import { detectMcpClients, connectMcpClient, type McpClientId } from './mcpConnect';
```

Add helper functions near `recentProjectsPath`:

```ts
const runtimeFilePath = () => join(app.getPath('userData'), '.ai-clip-assembler', 'runtime.json');

function packagedBackendExecutablePath(): string {
  return join(process.resourcesPath, 'backend', 'ai-clip-backend');
}
```

In `registerIpcHandlers`, add:

```ts
  ipcMain.handle('mcp:detect-clients', async () => {
    return detectMcpClients(packagedBackendExecutablePath(), runtimeFilePath());
  });

  ipcMain.handle('mcp:connect-client', async (_event, clientId: McpClientId) => {
    return connectMcpClient(clientId, packagedBackendExecutablePath(), runtimeFilePath());
  });
```

In `startPackagedBackend`, replace:

```ts
  const backendExecutable = join(process.resourcesPath, 'backend', 'ai-clip-backend');
```

with:

```ts
  const backendExecutable = packagedBackendExecutablePath();
  const runtimeFile = runtimeFilePath();
```

and add `CLIP_ASSEMBLER_RUNTIME_FILE` to `env`:

```ts
      CLIP_ASSEMBLER_RUNTIME_FILE: runtimeFile,
```

- [ ] **Step 4: Expose IPC through preload and frontend API**

Modify `frontend/src/preload/index.ts` bridge:

```ts
  detectMcpClients: () => ipcRenderer.invoke('mcp:detect-clients') as Promise<
    Array<{ id: 'claude_desktop' | 'codex'; name: string; configPath: string; installed: boolean; connected: boolean; needsRestart: boolean }>
  >,
  connectMcpClient: (clientId: 'claude_desktop' | 'codex') =>
    ipcRenderer.invoke('mcp:connect-client', clientId) as Promise<{
      id: 'claude_desktop' | 'codex';
      name: string;
      configPath: string;
      installed: boolean;
      connected: boolean;
      needsRestart: boolean;
      backupPath?: string;
      snippet: string;
    }>,
```

Modify the `Window.clipAssembler` interface in `frontend/src/renderer/src/api/client.ts`:

```ts
      detectMcpClients?: () => Promise<McpClientStatus[]>;
      connectMcpClient?: (clientId: McpClientId) => Promise<McpConnectResult>;
```

Add exported types and helpers in `frontend/src/renderer/src/api/client.ts`:

```ts
export type McpClientId = 'claude_desktop' | 'codex';

export interface McpClientStatus {
  id: McpClientId;
  name: string;
  configPath: string;
  installed: boolean;
  connected: boolean;
  needsRestart: boolean;
}

export interface McpConnectResult extends McpClientStatus {
  backupPath?: string;
  snippet: string;
}

export async function detectMcpClients(): Promise<McpClientStatus[]> {
  return window.clipAssembler?.detectMcpClients?.() ?? [];
}

export async function connectMcpClient(clientId: McpClientId): Promise<McpConnectResult> {
  if (!window.clipAssembler?.connectMcpClient) {
    throw new Error('MCP client connection is only available in the desktop app');
  }
  return window.clipAssembler.connectMcpClient(clientId);
}
```

- [ ] **Step 5: Run frontend checks**

Run:

```bash
cd frontend
npm run typecheck
npm run lint:frontend
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add frontend/src/main/mcpConnect.ts frontend/src/main/index.ts frontend/src/preload/index.ts frontend/src/renderer/src/api/client.ts
git commit -m "feat: configure desktop mcp clients"
```

## Task 4: Settings UI For Connect Your AI

**Files:**
- Modify: `frontend/src/renderer/src/components/SettingsModal.tsx`
- Modify: `frontend/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `detectMcpClients()`, `connectMcpClient(clientId)`
- Produces: Settings tab `connect-ai`
- Produces user states: installed, connected, needs restart, write failure/manual snippet.

- [ ] **Step 1: Extend Settings tab types and imports**

Modify `frontend/src/renderer/src/components/SettingsModal.tsx` imports:

```ts
import {
  connectMcpClient,
  detectMcpClients,
  getDiagnostics,
  getSettings,
  updateSettings,
  type AppSettings,
  type Diagnostics,
  type McpClientId,
  type McpClientStatus,
  type McpConnectResult,
  type SettingsUpdate,
} from '../api/client';
```

Change:

```ts
export type SettingsTab = 'settings' | 'diagnostics';
```

to:

```ts
export type SettingsTab = 'settings' | 'connect-ai' | 'diagnostics';
```

- [ ] **Step 2: Add the Connect AI panel**

Add this component before `DiagnosticsTabPanel`:

```tsx
function ConnectAiTabPanel() {
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [connecting, setConnecting] = useState<McpClientId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<McpConnectResult | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    detectMcpClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = (clientId: McpClientId) => {
    setConnecting(clientId);
    setError(null);
    connectMcpClient(clientId)
      .then((result) => {
        setLastResult(result);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConnecting(null));
  };

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3 className="settings-group-title">Connect your AI</h3>
        <p className="settings-hint">
          Connect an MCP-capable desktop client so it can inspect candidates and edit the open Timeline.
        </p>

        {error && <p className="settings-error" role="alert">{error}</p>}

        <div className="mcp-client-list">
          {clients.map((client) => (
            <div key={client.id} className="mcp-client-row">
              <div>
                <div className="mcp-client-name">{client.name}</div>
                <div className="settings-muted">{client.configPath}</div>
              </div>
              <div className="mcp-client-actions">
                <span className={client.connected ? 'diagnostics-badge ok' : 'diagnostics-badge'}>
                  {client.connected ? 'Connected' : client.installed ? 'Detected' : 'Config not found'}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => connect(client.id)}
                  disabled={connecting === client.id}
                >
                  {connecting === client.id ? 'Connecting...' : client.connected ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {lastResult && (
          <div className="mcp-connect-result" role="status">
            <p className="settings-saved">
              Connected. Restart {lastResult.name} to finish.
            </p>
            {lastResult.backupPath && (
              <p className="settings-muted">Backup created at {lastResult.backupPath}</p>
            )}
            <pre className="mcp-snippet">{lastResult.snippet}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add tab button and panel routing**

In the settings tab list, insert between Settings and Diagnostics:

```tsx
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'connect-ai'}
            className={tab === 'connect-ai' ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab('connect-ai')}
          >
            Connect your AI
          </button>
```

Replace panel routing:

```tsx
        {tab === 'settings' ? <SettingsTabPanel /> : <DiagnosticsTabPanel />}
```

with:

```tsx
        {tab === 'settings' && <SettingsTabPanel />}
        {tab === 'connect-ai' && <ConnectAiTabPanel />}
        {tab === 'diagnostics' && <DiagnosticsTabPanel />}
```

- [ ] **Step 4: Add styles**

Append to `frontend/src/renderer/src/styles.css`:

```css
.mcp-client-list {
  display: grid;
  gap: 12px;
}

.mcp-client-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-muted);
}

.mcp-client-name {
  font-weight: 700;
  color: var(--text-primary);
}

.mcp-client-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mcp-connect-result {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.mcp-snippet {
  overflow: auto;
  max-height: 180px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-deep);
  color: var(--text-primary);
  font-size: 12px;
}
```

- [ ] **Step 5: Run frontend checks**

Run:

```bash
cd frontend
npm run typecheck
npm run lint:frontend
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add frontend/src/renderer/src/components/SettingsModal.tsx frontend/src/renderer/src/styles.css
git commit -m "feat: add connect your ai settings panel"
```

## Task 5: Frontend Active Project Notification

**Files:**
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/state/ReviewContext.tsx`

**Interfaces:**
- Produces: `activateProject(projectId: string): Promise<void>`
- Consumes: existing ReviewContext `projectId` state.

- [ ] **Step 1: Add frontend API helper**

Add to `frontend/src/renderer/src/api/client.ts`:

```ts
export async function activateProject(projectId: string): Promise<void> {
  const res = await fetch(`${backendUrl()}/projects/${encodeURIComponent(projectId)}/activate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Failed to activate project: ${res.status}`);
  }
}
```

- [ ] **Step 2: Call activation when ReviewContext opens a project**

In `frontend/src/renderer/src/state/ReviewContext.tsx`, import:

```ts
import { activateProject } from '../api/client';
```

Add an effect near the existing `projectId` effects:

```tsx
  useEffect(() => {
    if (!projectId) return;
    activateProject(projectId).catch((err) => {
      console.warn('Failed to activate project for MCP clients', err);
    });
  }, [projectId]);
```

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd frontend
npm run typecheck
npm run lint:frontend
```

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

```bash
git add frontend/src/renderer/src/api/client.ts frontend/src/renderer/src/state/ReviewContext.tsx
git commit -m "feat: notify backend of active project"
```

## Task 6: Docs And Manual Validation

**Files:**
- Modify: `docs/MCP_SERVER.md`
- Modify: `docs/VALIDATION_RUNBOOK.md`

**Interfaces:**
- Consumes: bridge CLI `ai-clip-backend --mcp-stdio --runtime-file <abs>`
- Produces: Flow G manual validation steps.

- [ ] **Step 1: Document stdio bridge in MCP docs**

Add to `docs/MCP_SERVER.md`:

```markdown
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
```

- [ ] **Step 2: Add Flow G to validation runbook**

Add to `docs/VALIDATION_RUNBOOK.md`:

```markdown
## Flow G: Connect Your AI Via MCP Desktop Client

1. Launch the packaged app and open a folder project with analyzed Candidate Clips.
2. Open Settings -> Connect your AI.
3. Click Connect for Claude Desktop or Codex.
4. Confirm the app reports "Connected. Restart <client> to finish."
5. Restart the selected client.
6. Ask the client to list available AI Clip Assembler tools.
7. Ask it to summarize the open project.
8. Ask it to add the top Candidate Clip to the Timeline.
9. Confirm the Timeline updates live in the app and undo works.
10. Close the app and ask the client to summarize the project again.
11. Confirm it returns "Open AI Clip Assembler and a project, then retry."
```

- [ ] **Step 3: Run docs grep checks**

Run:

```bash
rg "Desktop Client Stdio Bridge|Flow G" docs/MCP_SERVER.md docs/VALIDATION_RUNBOOK.md
```

Expected: both headings are found.

- [ ] **Step 4: Commit Task 6**

```bash
git add docs/MCP_SERVER.md docs/VALIDATION_RUNBOOK.md
git commit -m "docs: add mcp desktop client validation"
```

## Task 7: Final Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes all previous task outputs.
- Produces confidence that backend, frontend, package entrypoint, and docs are coherent.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
```

Expected: PASS.

- [ ] **Step 2: Run backend lint**

Run:

```bash
cd backend
.venv/bin/ruff check src tests
```

Expected: PASS.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd frontend
npm run typecheck
npm run lint:frontend
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run a bridge smoke check**

With the app backend running and a project activated, run:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | backend/dist/ai-clip-backend --mcp-stdio --runtime-file "$HOME/Library/Application Support/AI Clip Assembler/.ai-clip-assembler/runtime.json"
```

Expected: JSON-RPC response with `result.tools` and no `error`.

- [ ] **Step 5: Commit verification fixes only if needed**

If any command fails, fix the failing code in the smallest relevant file set, rerun the failing command, then commit:

```bash
git add <changed-files>
git commit -m "fix: stabilize connect your ai mcp"
```

## Self-Review

- Spec coverage: covered runtime descriptor, active-project tracking, stdio bridge, project-id injection, Electron auto-configure for Claude Desktop/Codex, Settings UI, model-friendly errors, docs, and manual validation. OpenAI desktop and Streamable HTTP remain explicitly out of scope as required by the spec.
- Placeholder scan: no `TBD`, generic "handle edge cases", or "write tests" placeholders remain.
- Type consistency: `McpClientId`, `McpClientStatus`, `McpConnectResult`, `activateProject`, `run_mcp_stdio`, and runtime descriptor function names are defined before later tasks consume them.
