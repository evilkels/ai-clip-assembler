"""MCP stdio bridge for desktop clients that spawn a local command."""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
from typing import Any, BinaryIO, Dict, List, Optional

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
                    return self._error(message_id, "No project open in the app.")
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


def read_message(stream: BinaryIO) -> Optional[Dict[str, Any]]:
    content_length = None

    while True:
        line = stream.readline()
        if line == b"":
            if content_length is None:
                return None
            raise ValueError("Unexpected EOF while reading MCP headers")
        if line in (b"\r\n", b"\n"):
            break

        try:
            header_name, header_value = line.decode("ascii").split(":", 1)
        except ValueError as exc:
            raise ValueError("Malformed MCP header") from exc

        if header_name.strip().lower() == "content-length":
            try:
                content_length = int(header_value.strip())
            except ValueError as exc:
                raise ValueError("Invalid Content-Length header") from exc

    if content_length is None:
        raise ValueError("Missing Content-Length header")

    payload = stream.read(content_length)
    if len(payload) != content_length:
        raise ValueError("Unexpected EOF while reading MCP payload")

    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError("Invalid MCP payload") from exc


def write_message(stream: BinaryIO, message: Dict[str, Any]) -> None:
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    header = "Content-Length: {length}\r\n\r\n".format(length=len(payload)).encode("ascii")
    stream.write(header)
    stream.write(payload)
    stream.flush()


async def _run_loop(runtime_file: Optional[str] = None) -> None:
    bridge = MCPStdioBridge(runtime_file)
    while True:
        try:
            message = await asyncio.to_thread(read_message, sys.stdin.buffer)
        except ValueError:
            response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }
            await asyncio.to_thread(write_message, sys.stdout.buffer, response)
            continue

        if message is None:
            return

        response = await bridge.handle_message(message)

        if response is not None:
            await asyncio.to_thread(write_message, sys.stdout.buffer, response)


def run_mcp_stdio(runtime_file: Optional[str] = None) -> None:
    asyncio.run(_run_loop(runtime_file))


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-file")
    return parser.parse_args(argv)


if __name__ == "__main__":
    run_mcp_stdio(parse_args().runtime_file)
