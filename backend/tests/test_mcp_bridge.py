import io

import pytest

from src.runtime_descriptor import write_runtime_descriptor


def test_read_message_parses_content_length_frame():
    from src import mcp_bridge

    payload = b'{"jsonrpc":"2.0","id":7,"method":"tools/list"}'
    stream = io.BytesIO(
        b"Content-Length: "
        + str(len(payload)).encode("ascii")
        + b"\r\n\r\n"
        + payload
    )

    assert mcp_bridge.read_message(stream) == {
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/list",
    }


def test_write_message_emits_content_length_frame():
    from src import mcp_bridge

    stream = io.BytesIO()
    message = {"jsonrpc": "2.0", "id": 9, "result": {"ok": True}}

    mcp_bridge.write_message(stream, message)

    payload = b'{"jsonrpc":"2.0","id":9,"result":{"ok":true}}'
    assert stream.getvalue() == (
        b"Content-Length: "
        + str(len(payload)).encode("ascii")
        + b"\r\n\r\n"
        + payload
    )


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
async def test_bridge_returns_project_missing_error_when_runtime_has_no_active_project(tmp_path):
    from src import mcp_bridge

    runtime_path = tmp_path / "runtime.json"
    write_runtime_descriptor(port=8123, pid=12345, active_project_id=None, path=runtime_path)

    bridge = mcp_bridge.MCPStdioBridge(str(runtime_path))
    result = await bridge.handle_message(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "get_timeline", "arguments": {}},
        }
    )

    assert result["error"]["code"] == -32000
    assert result["error"]["message"] == "No project open in the app."


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
