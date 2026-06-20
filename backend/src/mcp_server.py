"""Embedded MCP server for the agent-operable timeline (Phase B).

A self-contained Model Context Protocol adapter mounted in the FastAPI process.
It speaks MCP's JSON-RPC method set (``initialize`` / ``tools/list`` /
``tools/call``) over a single HTTP endpoint, so an external agent (Claude Code,
Cursor) drives the *same* live Timeline Document the GUI sees.

Crucially, the mutating tools are thin wrappers over the **same operations core**
(`apply_operation` via the per-project `TimelineController`) the HTTP adapter
uses — there is no parallel mutation path, so the two adapters cannot drift.

We hand-roll the protocol rather than depend on the MCP SDK so the transport
stays inside the existing FastAPI process with no new server/loop. Every tool
takes a ``project_id`` argument (MCP calls are stateless).
"""

from __future__ import annotations

import json
from typing import Callable, List, Optional

from .timeline_ops import OPERATIONS, TimelineController, TimelineOpError


SERVER_NAME = "ai-clip-assembler"
SERVER_VERSION = "0.1.0"
PROTOCOL_VERSION = "2024-11-05"

GetController = Callable[[str], TimelineController]
GetProject = Callable[[str], dict]
ListFramePaths = Callable[[str, str], List[str]]


# Input schemas for the mutating tools, mirroring the operations core signatures.
_OP_ARG_SCHEMA = {
    "add_item": {"source_clip_id": "string", "at_index": "integer?"},
    "remove_item": {"item_id": "string"},
    "split_item": {"item_id": "string", "at_sec": "number"},
    "set_bounds": {"item_id": "string", "start_sec": "number", "end_sec": "number"},
    "reorder": {"item_id": "string", "to_index": "integer"},
    "set_speed": {"item_id": "string", "speed": "number"},
    "set_transform": {"item_id": "string", "transform": "object"},
    "include": {"clip_id": "string"},
    "exclude": {"clip_id": "string"},
    "reset_decision": {"clip_id": "string"},
    "set_profile": {"profile": "string?"},
    "set_target_duration": {"target_duration_sec": "number?"},
}

_READ_TOOLS = {
    "list_candidates": "List candidate clips with scores and reasons.",
    "get_timeline": "Return the current Timeline Document.",
    "get_project_summary": "Summarize the open project (name, counts).",
    "get_frame_paths": "Return local frame JPEG paths for a candidate clip.",
}


def _text_result(payload, is_error: bool = False) -> dict:
    text = payload if isinstance(payload, str) else json.dumps(payload, default=str)
    result = {"content": [{"type": "text", "text": text}]}
    if is_error:
        result["isError"] = True
    return result


class TimelineMCPServer:
    def __init__(
        self,
        *,
        get_controller: GetController,
        get_project: GetProject,
        list_frame_paths: ListFramePaths,
    ) -> None:
        self._get_controller = get_controller
        self._get_project = get_project
        self._list_frame_paths = list_frame_paths

    # --- tool catalogue ----------------------------------------------------

    def list_tools(self) -> List[dict]:
        tools: List[dict] = []
        for operation in OPERATIONS:
            properties = {"project_id": {"type": "string"}}
            required = ["project_id"]
            for arg, type_hint in _OP_ARG_SCHEMA.get(operation, {}).items():
                optional = type_hint.endswith("?")
                base = type_hint[:-1] if optional else type_hint
                properties[arg] = {"type": base}
                if not optional:
                    required.append(arg)
            tools.append(
                {
                    "name": operation,
                    "description": f"Timeline operation: {operation}.",
                    "inputSchema": {"type": "object", "properties": properties, "required": required},
                }
            )
        for op in ("undo", "redo"):
            tools.append(
                {
                    "name": op,
                    "description": f"{op.capitalize()} the last timeline change.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"project_id": {"type": "string"}},
                        "required": ["project_id"],
                    },
                }
            )
        for name, description in _READ_TOOLS.items():
            properties = {"project_id": {"type": "string"}}
            required = ["project_id"]
            if name == "get_frame_paths":
                properties["clip_id"] = {"type": "string"}
                required.append("clip_id")
            tools.append(
                {
                    "name": name,
                    "description": description,
                    "inputSchema": {"type": "object", "properties": properties, "required": required},
                }
            )
        return tools

    # --- tool dispatch -----------------------------------------------------

    async def call_tool(self, name: str, arguments: dict) -> dict:
        args = dict(arguments or {})
        project_id = args.pop("project_id", None)
        if project_id is None:
            return _text_result("missing required argument: project_id", is_error=True)
        try:
            if name in OPERATIONS:
                controller = self._get_controller(project_id)
                document = await controller.apply(name, **args)
                return _text_result(document.model_dump())
            if name in ("undo", "redo"):
                controller = self._get_controller(project_id)
                document = await (controller.undo() if name == "undo" else controller.redo())
                return _text_result(document.model_dump())
            if name == "get_timeline":
                return _text_result(self._get_controller(project_id).document.model_dump())
            if name == "list_candidates":
                return _text_result(self._list_candidates(project_id))
            if name == "get_project_summary":
                return _text_result(self._project_summary(project_id))
            if name == "get_frame_paths":
                clip_id = args.get("clip_id")
                return _text_result(self._list_frame_paths(project_id, clip_id))
            return _text_result(f"unknown tool: {name}", is_error=True)
        except TimelineOpError as exc:
            return _text_result(str(exc), is_error=True)
        except KeyError as exc:
            return _text_result(f"not found: {exc}", is_error=True)
        except TypeError as exc:
            return _text_result(f"invalid arguments: {exc}", is_error=True)

    def _list_candidates(self, project_id: str) -> list:
        project = self._get_project(project_id)
        candidates = []
        for clip in project.get("clips", []):
            candidates.append(
                {
                    "clip_id": clip.get("clip_id"),
                    "file_id": clip.get("file_id"),
                    "file_name": clip.get("file_name"),
                    "start_sec": clip.get("start_sec"),
                    "end_sec": clip.get("end_sec"),
                    "overall_score": clip.get("overall_score"),
                    "smoothness_score": clip.get("smoothness_score"),
                    "visual_interest_score": clip.get("visual_interest_score"),
                    "ai_reason": clip.get("ai_reason"),
                }
            )
        return candidates

    def _project_summary(self, project_id: str) -> dict:
        project = self._get_project(project_id)
        document = self._get_controller(project_id).document
        return {
            "project_id": project_id,
            "name": (project.get("project") or {}).get("name"),
            "video_count": len(project.get("videos", [])),
            "candidate_count": len(project.get("clips", [])),
            "timeline_item_count": len(document.items),
            "profile": document.profile,
            "target_duration_sec": document.target_duration_sec,
        }

    # --- JSON-RPC ----------------------------------------------------------

    async def handle_jsonrpc(self, message: dict) -> Optional[dict]:
        method = message.get("method")
        message_id = message.get("id")
        params = message.get("params") or {}

        # Notifications (no id) get no response.
        if message_id is None and method != "ping":
            return None

        if method == "initialize":
            return self._ok(
                message_id,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                },
            )
        if method == "ping":
            return self._ok(message_id, {})
        if method == "tools/list":
            return self._ok(message_id, {"tools": self.list_tools()})
        if method == "tools/call":
            result = await self.call_tool(params.get("name"), params.get("arguments") or {})
            return self._ok(message_id, result)
        return {
            "jsonrpc": "2.0",
            "id": message_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

    @staticmethod
    def _ok(message_id, result) -> dict:
        return {"jsonrpc": "2.0", "id": message_id, "result": result}
