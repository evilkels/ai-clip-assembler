"""Packaged FastAPI backend entry point for the Electron app."""

from __future__ import annotations

import asyncio
import os
import sys


def main() -> None:
    if "--script-worker" in sys.argv:
        from src.script_worker import main as run_script_worker

        run_script_worker()
        return

    if "--mcp-stdio" in sys.argv:
        from src.mcp_bridge import parse_args, run_mcp_stdio

        args = parse_args([arg for arg in sys.argv[1:] if arg != "--mcp-stdio"])
        run_mcp_stdio(args.runtime_file)
        return

    import uvicorn

    port = int(os.environ.get("CLIP_ASSEMBLER_PORT", "8000"))
    from src.remote.lifecycle import control_fd_from_env

    control_fd = control_fd_from_env()
    if control_fd is None:
        # No control channel, so Remote View cannot be enabled at all.
        uvicorn.run("src.api:app", host="127.0.0.1", port=port, log_level="info")
        return

    asyncio.run(_serve_with_control_channel(port, control_fd))


async def _serve_with_control_channel(port: int, control_fd: int) -> None:
    """Run the desktop API and the Remote View control channel in one loop."""
    import uvicorn

    from src import api
    from src.remote.lifecycle import build_lifecycle

    server = uvicorn.Server(
        uvicorn.Config(api.app, host="127.0.0.1", port=port, log_level="info")
    )
    lifecycle = build_lifecycle(asyncio.get_running_loop(), control_fd)
    lifecycle.start()
    try:
        await server.serve()
    finally:
        lifecycle.stop()


if __name__ == "__main__":
    main()
