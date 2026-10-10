"""Project-local staging for resumable uploads (architecture §4.1, §5.3, §6).

Layout, inside the Project folder::

    clipassembler/cache/uploads/<upload-id>/
        record.json      immutable metadata plus the state machine (atomic writes)
        receipts.jsonl   one fsynced line per acknowledged chunk: the checkpoint
        data.part        the bytes; only the checkpointed prefix is real
    clipassembler/ingest/receipts/<upload-id>.json   the durable import receipt

The durable offset is the sum of valid receipt lines, never the length of
``data.part``. A torn last line (crash mid-append) is ignored and trimmed; bytes
beyond the checkpoint are truncated. Staging that resolves outside the Project
(a symlink) is refused, and so is a different filesystem (publication needs
``link`` into the Project root).
"""

import json
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ValidationError

from ..durable_io import fsync_directory, fsync_fd, write_text_atomic

UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
RECORD_NAME = "record.json"
RECEIPTS_NAME = "receipts.jsonl"
DATA_NAME = "data.part"

UploadState = Literal[
    "receiving",
    "received",
    "verifying",
    "publishing",
    "imported",
    "failed",
    "cancelled",
    "expired",
]
UNFINISHED_STATES = ("receiving", "received")
ACTIVE_STATES = ("receiving", "received", "verifying", "publishing")


class StagingUnsafe(Exception):
    """Staging would live outside the Project or on another filesystem."""


class PublishIntent(BaseModel):
    """Journalled before publication so recovery is deterministic (§6.1)."""

    dest_name: str
    size: int
    sha256: str
    attempt: int = 1
    duplicate_of: Optional[str] = None


class UploadRecord(BaseModel):
    upload_id: str
    device_id: str
    device_label: str
    owner_login: str
    state: UploadState = "receiving"
    length: int
    filename: str
    original_filename: str
    filetype: Optional[str] = None
    client_last_modified: Optional[int] = None
    idempotency_key: str
    created_at: float
    # finalization
    whole_sha256: Optional[str] = None
    finalize_key: Optional[str] = None
    publish: Optional[PublishIntent] = None
    receipt_name: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    ended_at: Optional[float] = None  # tombstone / imported time


class ChunkReceipt(BaseModel):
    o: int  # offset
    n: int  # length
    h: str  # sha256 hex of this chunk
    t: float  # server time acknowledged


@dataclass
class Upload:
    record: UploadRecord
    directory: Path
    receipts: List[ChunkReceipt] = field(default_factory=list)
    offset: int = 0
    updated_at: float = 0.0
    damaged: bool = False
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def data_path(self) -> Path:
        return self.directory / DATA_NAME

    @property
    def upload_id(self) -> str:
        return self.record.upload_id


def staging_root(project_root: Path) -> Path:
    """``clipassembler/cache/uploads`` for a Project, refusing symlink escapes."""
    root = Path(project_root).resolve()
    expected = root / "clipassembler" / "cache" / "uploads"
    expected.mkdir(parents=True, exist_ok=True)
    if expected.resolve() != expected or not _within(expected.resolve(), root):
        raise StagingUnsafe("Upload staging is not inside the Project folder")
    if os.stat(expected).st_dev != os.stat(root).st_dev:
        raise StagingUnsafe("Upload staging is on a different volume than the Project")
    return expected


def _within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def upload_directory(project_root: Path, upload_id: str) -> Optional[Path]:
    """The directory for a well-formed upload ID that is a real child, else ``None``."""
    if not UPLOAD_ID.match(upload_id or ""):
        return None
    base = staging_root(project_root)
    candidate = base / upload_id
    if candidate.is_symlink() or not candidate.is_dir():
        return None
    return candidate if candidate.resolve().parent == base else None


def new_upload_directory(project_root: Path, upload_id: str) -> Path:
    directory = staging_root(project_root) / upload_id
    directory.mkdir(parents=False, exist_ok=False)
    return directory


def write_record(directory: Path, record: UploadRecord) -> None:
    write_text_atomic(directory / RECORD_NAME, record.model_dump_json(indent=2) + "\n")


def read_record(directory: Path) -> Optional[UploadRecord]:
    try:
        return UploadRecord.model_validate_json((directory / RECORD_NAME).read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        return None


def _load_receipts(directory: Path) -> List[ChunkReceipt]:
    """Valid, contiguous receipts; the file is trimmed to that prefix."""
    path = directory / RECEIPTS_NAME
    receipts: List[ChunkReceipt] = []
    good_bytes = 0
    try:
        with open(path, "rb") as handle:
            for raw in handle:
                try:
                    receipt = ChunkReceipt.model_validate_json(raw)
                except (ValidationError, ValueError):
                    break
                if not raw.endswith(b"\n") or receipt.o != sum(r.n for r in receipts):
                    break
                receipts.append(receipt)
                good_bytes += len(raw)
        size = path.stat().st_size
    except FileNotFoundError:
        return []
    if size > good_bytes:
        with open(path, "r+b") as handle:
            handle.truncate(good_bytes)
            handle.flush()
            fsync_fd(handle.fileno())
    return receipts


def load_upload(directory: Path) -> Optional[Upload]:
    """Read one staging directory back, enforcing the checkpoint on ``data.part``."""
    record = read_record(directory)
    if record is None:
        return None
    upload = Upload(record=record, directory=directory)
    if record.state in ("receiving", "received", "verifying", "publishing"):
        upload.receipts = _load_receipts(directory)
        upload.offset = sum(r.n for r in upload.receipts)
        upload.updated_at = upload.receipts[-1].t if upload.receipts else record.created_at
        data = upload.data_path
        if record.state in ("receiving", "received"):
            if not data.exists():
                if upload.offset > 0:
                    upload.damaged = True
            else:
                size = data.stat().st_size
                if size < upload.offset:
                    upload.damaged = True
                elif size > upload.offset:
                    with open(data, "r+b") as handle:
                        handle.truncate(upload.offset)
                        handle.flush()
                        fsync_fd(handle.fileno())
    else:
        upload.updated_at = record.ended_at or record.created_at
        upload.offset = record.length if record.state == "imported" else 0
    return upload


def append_receipt(directory: Path, receipt: ChunkReceipt) -> None:
    """Durably append one receipt line (the checkpoint)."""
    path = directory / RECEIPTS_NAME
    created = not path.exists()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        before = os.fstat(fd).st_size
        try:
            os.write(fd, (receipt.model_dump_json() + "\n").encode("utf-8"))
            fsync_fd(fd)
        except OSError:
            try:
                os.ftruncate(fd, before)
            except OSError:
                pass
            raise
    finally:
        os.close(fd)
    if created:
        fsync_directory(directory)


def remove_staging(directory: Path, keep_record: bool = False) -> None:
    """Delete app-owned staging files only; never follows or removes foreign paths."""
    for name in (DATA_NAME, RECEIPTS_NAME):
        try:
            os.unlink(directory / name)
        except FileNotFoundError:
            pass
    if not keep_record:
        try:
            os.unlink(directory / RECORD_NAME)
        except FileNotFoundError:
            pass
        try:
            os.rmdir(directory)
        except OSError:
            pass  # unexpected extras stay: we only remove what we created


def load_project_uploads(project_root: Path) -> Dict[str, Upload]:
    base = staging_root(project_root)
    uploads: Dict[str, Upload] = {}
    for child in sorted(base.iterdir()):
        if not UPLOAD_ID.match(child.name) or child.is_symlink() or not child.is_dir():
            continue
        upload = load_upload(child)
        if upload is not None:
            uploads[upload.upload_id] = upload
    return uploads


def receipts_dir(project_root: Path) -> Path:
    return Path(project_root) / "clipassembler" / "ingest" / "receipts"


def read_ingest_receipt(project_root: Path, upload_id: str) -> Optional[dict]:
    if not UPLOAD_ID.match(upload_id or ""):
        return None
    try:
        data = json.loads((receipts_dir(project_root) / f"{upload_id}.json").read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
