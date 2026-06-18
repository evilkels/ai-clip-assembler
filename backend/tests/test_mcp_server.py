"""Tests for the embedded MCP server (Phase B).

The MCP tools are thin wrappers over the *same* operations core the HTTP adapter
uses, so the two cannot drift. Tests call the tool handlers directly and assert
they mutate through the core and emit `timeline-changed`.
"""

import json

import pytest

from src.models import TimelineDocument
from src.timeline_ops import SourceClip, TimelineController
from src.timeline_service import TimelineEventBroker
from src.mcp_server import TimelineMCPServer


def _sources():
    return {
        "clip-a": SourceClip(clip_id="clip-a", start_sec=1.0, end_sec=4.0, source_duration_sec=30.0),
        "clip-b": SourceClip(clip_id="clip-b", start_sec=5.0, end_sec=9.0, source_duration_sec=30.0),
    }


def _project():
    return {
        "project_id": "p1",
        "project": {"name": "Sunset Drone"},
        "videos": [{"file_id": "file-1", "file_name": "DJI_0001.MP4"}],
        "clips": [
            {
                "clip_id": "clip-a", "file_id": "file-1", "file_name": "DJI_0001.MP4",
                "start_sec": 1.0, "end_sec": 4.0, "duration_sec": 3.0,
                "overall_score": 8.2, "smoothness_score": 9.0, "ai_reason": "Smooth orbit",
            },
        ],
    }


def make_server(broker=None):
    controller = TimelineController(
        TimelineDocument(),
        _sources(),
        on_change=broker.publisher("p1") if broker else None,
    )
    project = _project()
    server = TimelineMCPServer(
        get_controller=lambda pid: controller,
        get_project=lambda pid: project,
        list_frame_paths=lambda pid, clip_id: [f"/frames/{clip_id}_000000.jpg"],
    )
    return server, controller


def test_list_tools_exposes_mutating_and_read_tools():
    server, _ = make_server()
    names = {tool["name"] for tool in server.list_tools()}
    # Mutating tools 1:1 with the operations core
    assert {"add_item", "split_item", "set_speed", "set_transform", "include", "exclude"} <= names
    # Read tools
    assert {"list_candidates", "get_timeline", "get_project_summary", "get_frame_paths"} <= names


@pytest.mark.asyncio
async def test_call_mutating_tool_drives_the_core_and_emits_event():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    server, controller = make_server(broker)

    result = await server.call_tool("include", {"project_id": "p1", "clip_id": "clip-a"})

    assert result.get("isError") is not True
    assert len(controller.document.items) == 1
    assert queue.get_nowait()["type"] == "timeline-changed"


@pytest.mark.asyncio
async def test_call_split_item_through_mcp():
    server, controller = make_server()
    await server.call_tool("add_item", {"project_id": "p1", "source_clip_id": "clip-a"})
    item_id = controller.document.items[0].item_id
    await server.call_tool("split_item", {"project_id": "p1", "item_id": item_id, "at_sec": 2.5})
    assert len(controller.document.items) == 2


@pytest.mark.asyncio
async def test_call_invalid_operation_returns_tool_error_not_exception():
    server, _ = make_server()
    result = await server.call_tool("remove_item", {"project_id": "p1", "item_id": "missing"})
    assert result["isError"] is True
    assert "missing" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_read_tool_list_candidates_returns_scores_and_reasons():
    server, _ = make_server()
    result = await server.call_tool("list_candidates", {"project_id": "p1"})
    payload = json.loads(result["content"][0]["text"])
    assert payload[0]["clip_id"] == "clip-a"
    assert payload[0]["overall_score"] == 8.2
    assert payload[0]["ai_reason"] == "Smooth orbit"


@pytest.mark.asyncio
async def test_read_tool_get_frame_paths_returns_local_jpegs():
    server, _ = make_server()
    result = await server.call_tool("get_frame_paths", {"project_id": "p1", "clip_id": "clip-a"})
    payload = json.loads(result["content"][0]["text"])
    assert payload == ["/frames/clip-a_000000.jpg"]


@pytest.mark.asyncio
async def test_read_tool_get_project_summary():
    server, _ = make_server()
    result = await server.call_tool("get_project_summary", {"project_id": "p1"})
    payload = json.loads(result["content"][0]["text"])
    assert payload["name"] == "Sunset Drone"
    assert payload["candidate_count"] == 1


@pytest.mark.asyncio
async def test_jsonrpc_initialize_and_tools_list():
    server, _ = make_server()
    init = await server.handle_jsonrpc(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
    )
    assert init["result"]["serverInfo"]["name"]
    assert "tools" in init["result"]["capabilities"]

    listed = await server.handle_jsonrpc(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
    )
    assert any(t["name"] == "split_item" for t in listed["result"]["tools"])


@pytest.mark.asyncio
async def test_jsonrpc_tools_call_dispatches_to_core():
    server, controller = make_server()
    response = await server.handle_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "include", "arguments": {"project_id": "p1", "clip_id": "clip-a"}},
        }
    )
    assert response["result"].get("isError") is not True
    assert len(controller.document.items) == 1


@pytest.mark.asyncio
async def test_jsonrpc_notification_returns_none():
    server, _ = make_server()
    assert await server.handle_jsonrpc({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


@pytest.mark.asyncio
async def test_jsonrpc_unknown_method_returns_error():
    server, _ = make_server()
    response = await server.handle_jsonrpc({"jsonrpc": "2.0", "id": 9, "method": "bogus"})
    assert response["error"]["code"] == -32601
