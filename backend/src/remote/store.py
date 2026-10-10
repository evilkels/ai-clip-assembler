"""Durable Remote View records: Paired Devices, Project exposure, owner policy.

Everything lives under ``.ai-clip-assembler/remote/`` (relative to the backend
working directory, which is Electron's ``userData`` when packaged), never inside
a Project folder: moving or sharing a Project must not transfer remote access.
The directory is mode 0700 and every file 0600, written atomically.

Only SHA-256 hashes of credentials are persisted. Pairing tokens, pending
approvals, active sessions and rate-limit counters are memory-only and end with
the process.
"""

import base64
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from ..durable_io import write_text_atomic

DEFAULT_REMOTE_DIR = Path(".ai-clip-assembler/remote")
STORE_VERSION = 1
AUDIT_MAX_BYTES = 1024 * 1024

DeviceStatus = Literal["active", "disconnected", "revoked", "expired"]


class DeviceRecord(BaseModel):
    """One Paired Device: a browser the owner approved on the Mac."""

    device_id: str
    label: str
    owner_login: str
    user_agent: str = ""
    status: DeviceStatus = "active"
    status_at: Optional[float] = None
    approved_at: float
    last_seen: float
    cred_hash: str
    # The credential rotates on renewal; the previous one stays valid briefly so
    # a lost renewal response does not strand the phone.
    prev_cred_hash: Optional[str] = None
    prev_valid_until: float = 0.0
    rotation: int = 0


class ExposureEntry(BaseModel):
    folder_path: str
    shown: bool = False


class Policy(BaseModel):
    owner_login: Optional[str] = None
    csrf_key: str = Field(default_factory=lambda: base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())


class RemoteStore:
    def __init__(self, directory: Optional[Path] = None) -> None:
        self.directory = Path(directory) if directory is not None else DEFAULT_REMOTE_DIR
        self._lock = threading.RLock()
        self._ensure_directory()
        self.policy = self._load_policy()
        self.devices: Dict[str, DeviceRecord] = self._load_devices()
        self.exposure: Dict[str, ExposureEntry] = self._load_exposure()

    # --- files --------------------------------------------------------------

    def _ensure_directory(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)

    def _path(self, name: str) -> Path:
        return self.directory / name

    def _read(self, name: str) -> Optional[dict]:
        try:
            payload = json.loads(self._path(name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    def _write(self, name: str, payload: dict) -> None:
        self._ensure_directory()
        write_text_atomic(self._path(name), json.dumps(payload, indent=2) + "\n", mode=0o600)

    # --- policy -------------------------------------------------------------

    def _load_policy(self) -> Policy:
        payload = self._read("policy.json")
        if payload is not None:
            try:
                return Policy.model_validate(payload.get("policy", payload))
            except ValidationError:
                pass
        policy = Policy()
        self._write("policy.json", {"version": STORE_VERSION, "policy": policy.model_dump()})
        return policy

    def save_policy(self) -> None:
        with self._lock:
            self._write("policy.json", {"version": STORE_VERSION, "policy": self.policy.model_dump()})

    # --- devices ------------------------------------------------------------

    def _load_devices(self) -> Dict[str, DeviceRecord]:
        payload = self._read("devices.json") or {}
        devices: Dict[str, DeviceRecord] = {}
        for raw in payload.get("devices", []):
            try:
                record = DeviceRecord.model_validate(raw)
            except ValidationError:
                continue
            devices[record.device_id] = record
        return devices

    def save_devices(self) -> None:
        with self._lock:
            self._write(
                "devices.json",
                {
                    "version": STORE_VERSION,
                    "devices": [d.model_dump() for d in self.devices.values()],
                },
            )

    # --- exposure -----------------------------------------------------------

    def _load_exposure(self) -> Dict[str, ExposureEntry]:
        payload = self._read("exposure.json") or {}
        exposure: Dict[str, ExposureEntry] = {}
        for project_uuid, raw in (payload.get("projects") or {}).items():
            try:
                exposure[project_uuid] = ExposureEntry.model_validate(raw)
            except ValidationError:
                continue
        return exposure

    def save_exposure(self) -> None:
        with self._lock:
            self._write(
                "exposure.json",
                {
                    "version": STORE_VERSION,
                    "projects": {k: v.model_dump() for k, v in self.exposure.items()},
                },
            )

    def set_exposure(self, project_uuid: str, folder_path: str, shown: bool) -> None:
        with self._lock:
            self.exposure[project_uuid] = ExposureEntry(folder_path=folder_path, shown=shown)
            self.save_exposure()

    def exposed(self, project_uuid: str) -> Optional[ExposureEntry]:
        """The exposure entry only when the Editor ticked *Show on phone*."""
        entry = self.exposure.get(project_uuid)
        return entry if entry is not None and entry.shown else None

    def shown_projects(self) -> List[tuple]:
        return [(uuid_, entry) for uuid_, entry in self.exposure.items() if entry.shown]

    # --- audit --------------------------------------------------------------

    def audit(self, event: str, **fields: object) -> None:
        """Append one bounded JSONL line. Callers never pass secrets."""
        import time as _time

        line = json.dumps({"t": round(_time.time(), 3), "event": event, **fields}, default=str)
        path = self._path("audit.jsonl")
        with self._lock:
            try:
                self._ensure_directory()
                if path.exists() and path.stat().st_size > AUDIT_MAX_BYTES:
                    os.replace(path, self._path("audit.jsonl.1"))
                fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                try:
                    os.write(fd, (line + "\n").encode("utf-8"))
                finally:
                    os.close(fd)
            except OSError:
                pass  # auditing is best effort and must never break a request
