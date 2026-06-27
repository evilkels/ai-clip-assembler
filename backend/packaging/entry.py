"""Packaged FastAPI backend entry point for the Electron app."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    port = int(os.environ.get("CLIP_ASSEMBLER_PORT", "8000"))
    uvicorn.run("src.api:app", host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
