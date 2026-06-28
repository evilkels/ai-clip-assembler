"""MCP stdio bridge for desktop clients that spawn a local command."""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
from typing import Any, Dict, List, Optional

import httpx

from .runtime_descriptor import read_runtime_descriptor, resolve_runtime_file


class MCPStdioBridge:
    def __init__(self, runtime_file: Optional[str] = None) -> None:
        self.runtime_file = resolve_runtime_file(runtime_file)

    async def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        method = message.get("method")
        message_id = message.get("id")
        if message_id is None and method != "ping":
            return None

        descriptor = read_runtime_descriptor(self.runtime_file)
        if descriptor is None:
            return self._error(message_id, "Open AI Clip Assembler and a project, then retry.")

        forwarded = copy.deepcopy(message)
        if method == "tools/call":
            params = forwarded.setdefault("params", {})
            arguments = params.setdefault("arguments", {})
            if "project_id" not in arguments:
                if descriptor.active_project_id is None:
                    return self._error(message_id, "Open AI Clip Assembler and a project, then retry.")
                arguments["project_id"] = descriptor.active_project_id

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "http://127.0.0.1:{port}/mcp".format(port=descriptor.port),
                    json=forwarded,
                )
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, OSError, ValueError):
            return self._error(message_id, "Open AI Clip Assembler and a project, then retry.")

    @staticmethod
    def _error(message_id: Any, message: str) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": message_id, "error": {"code": -32000, "message": message}}


async def _run_loop(runtime_file: Optional[str] = None) -> None:
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
        except ValueError:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }

        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


def run_mcp_stdio(runtime_file: Optional[str] = None) -> None:
    asyncio.run(_run_loop(runtime_file))


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-file")
    return parser.parse_args(argv)


if __name__ == "__main__":
    run_mcp_stdio(parse_args().runtime_file)
