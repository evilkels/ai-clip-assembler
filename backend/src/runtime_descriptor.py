"""Runtime descriptor shared by the app backend and MCP stdio bridge."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel


class RuntimeDescriptor(BaseModel):
    port: int
    pid: int
    active_project_id: Optional[str] = None
    updated_at: str


def resolve_runtime_file(explicit: Optional[str] = None) -> Path:
    configured = explicit or os.environ.get("CLIP_ASSEMBLER_RUNTIME_FILE")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".ai-clip-assembler" / "runtime.json"


def read_runtime_descriptor(path: Optional[Path] = None) -> Optional[RuntimeDescriptor]:
    runtime_path = path or resolve_runtime_file()
    if not runtime_path.exists():
        return None
    return RuntimeDescriptor.model_validate_json(runtime_path.read_text(encoding="utf-8"))


def write_runtime_descriptor(
    *,
    port: int,
    pid: int,
    active_project_id: Optional[str],
    path: Optional[Path] = None,
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


def set_active_project(project_id: Optional[str]) -> RuntimeDescriptor:
    descriptor = read_runtime_descriptor()
    port = descriptor.port if descriptor is not None else int(os.environ.get("CLIP_ASSEMBLER_PORT", "8000"))
    pid = descriptor.pid if descriptor is not None else os.getpid()
    return write_runtime_descriptor(port=port, pid=pid, active_project_id=project_id)
