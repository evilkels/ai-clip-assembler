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
