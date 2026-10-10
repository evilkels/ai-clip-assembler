"""tus 1.0 resumable uploads with durable, verified chunks (architecture §5, §6).

Receiving bytes, importing a Source Video and rendering a preview are separate
states with separate guarantees: this module owns the first (and, in
``finalize``, the transition into the second). A chunk is acknowledged only after
it is fsynced and its receipt line is durable.
"""

import base64
import hashlib
import hmac
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Dict, Iterator, Optional

from ..models import VideoMetadata
from ..project_store import ProjectSourceVideo
from ..reservations import ReservationLedger
from ..video_probe import probe_video
from . import store
from .ingest import FinalizeContext, IngestMixin, hash_file  # noqa: F401
from .naming import UploadRejected, storage_error, validate_metadata
from .store import (
    UNFINISHED_STATES,
    ChunkReceipt,
    StagingUnsafe,
    Upload,
    UploadRecord,
)

GIB = 1024**3
MIB = 1024 * 1024
TUS_VERSION = "1.0.0"
TUS_EXTENSIONS = "creation,checksum,expiration,termination"
TUS_ALGORITHMS = "sha1,sha256"
MAX_UPLOAD_BYTES = 50 * GIB
CHUNK_CEILING = 8 * MIB
UPLOAD_TTL_SEC = 7 * 24 * 3600
TOMBSTONE_TTL_SEC = 30 * 24 * 3600
MAX_UNFINISHED_PER_DEVICE = 10
MAX_ACTIVE_PER_DEVICE = 1
MAX_ACTIVE_PER_MAC = 2

_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_HASHERS = {"sha1": hashlib.sha1, "sha256": hashlib.sha256}


class _Folder:
    """Loaded uploads of one Project root."""

    def __init__(self, root: Path, uploads: Dict[str, Upload]) -> None:
        self.root = root
        self.uploads = uploads
        self.lock = threading.RLock()


def parse_checksum_header(raw: Optional[str]) -> tuple:
    """``Upload-Checksum: sha256 <base64>`` -> ``(algorithm, digest bytes)``."""
    if not raw:
        raise UploadRejected(400, "checksum_required", "Upload-Checksum is required")
    algorithm, _, encoded = raw.strip().partition(" ")
    algorithm = algorithm.lower()
    if algorithm not in _HASHERS:
        raise UploadRejected(400, "checksum_algorithm", "Unsupported checksum algorithm")
    try:
        digest = base64.b64decode(encoded.strip(), validate=True)
    except ValueError as exc:
        raise UploadRejected(400, "checksum_invalid", "Malformed Upload-Checksum") from exc
    if len(digest) != _HASHERS[algorithm]().digest_size:
        raise UploadRejected(400, "checksum_invalid", "Malformed Upload-Checksum")
    return algorithm, digest


class ChunkWriter:
    """One PATCH: write, verify, fsync, checkpoint, only then acknowledge."""

    def __init__(
        self,
        service: "UploadService",
        folder: _Folder,
        upload: Upload,
        algorithm: str,
        expected_digest: bytes,
        content_length: int,
    ) -> None:
        self._service = service
        self._folder = folder
        self.upload = upload
        self._algorithm = algorithm
        self._expected = expected_digest
        self._declared = content_length
        self._base = upload.offset
        self._written = 0
        self._chunk_hash = hashlib.sha256()
        self._check = _HASHERS[algorithm]() if algorithm != "sha256" else self._chunk_hash
        self._done = False
        self._checkpointed = False
        self._handle = open(upload.data_path, "r+b")
        self._handle.truncate(self._base)  # drop anything beyond the checkpoint
        self._handle.seek(self._base)

    # -- streaming -----------------------------------------------------------

    def write(self, piece: bytes) -> None:
        if self._done:
            raise UploadRejected(409, "closed", "This transfer already ended")
        self._written += len(piece)
        if self._written > self._declared or self._written > CHUNK_CEILING:
            self.abort()
            raise UploadRejected(413, "chunk_too_large", "The chunk is larger than declared")
        try:
            self._handle.write(piece)
        except OSError as exc:
            self.abort()
            raise storage_error(exc) from exc
        self._chunk_hash.update(piece)
        if self._check is not self._chunk_hash:
            self._check.update(piece)

    def commit(self) -> int:
        """Verify and checkpoint the chunk; returns the new committed offset."""
        if self._done:
            raise UploadRejected(409, "closed", "This transfer already ended")
        upload = self.upload
        try:
            if self._written != self._declared:
                raise UploadRejected(400, "short_body", "The chunk ended early")
            if not hmac.compare_digest(self._check.digest(), self._expected):
                raise UploadRejected(460, "checksum_mismatch", "Chunk checksum mismatch")
            if upload.record.state != "receiving" or upload.cancel_requested:
                raise UploadRejected(410, "gone", "This upload was ended")
            self._service.fault("after_write")
            try:
                self._handle.flush()
                store.fsync_fd(self._handle.fileno())
            except OSError as exc:
                raise storage_error(exc) from exc
            self._service.fault("after_fsync")
            receipt = ChunkReceipt(
                o=self._base,
                n=self._written,
                h=self._chunk_hash.hexdigest(),
                t=self._service.clock(),
            )
            if self._written:
                try:
                    store.append_receipt(upload.directory, receipt)
                except OSError as exc:
                    raise storage_error(exc) from exc
                self._checkpointed = True
                upload.receipts.append(receipt)
                upload.offset = self._base + self._written
            upload.updated_at = receipt.t
            if upload.offset == upload.record.length:
                upload.record = upload.record.model_copy(update={"state": "received"})
                store.write_record(upload.directory, upload.record)
            self._service.ledger.set(upload.upload_id, upload.record.length - upload.offset)
            self._service.fault("after_checkpoint")
        except BaseException:
            self.abort()
            raise
        offset = upload.offset
        self._release()
        return offset

    def abort(self) -> None:
        """Discard this request's bytes: truncate back to the checkpoint."""
        if self._done:
            return
        try:
            if self._handle is not None and not self._checkpointed:
                try:
                    self._handle.truncate(self._base)
                    self._handle.flush()
                    store.fsync_fd(self._handle.fileno())
                except (OSError, ValueError):
                    pass
        finally:
            self._release()

    def _release(self) -> None:
        if self._done:
            return
        self._done = True
        if self._handle is not None:
            try:
                self._handle.close()
            except OSError:
                pass
        self.upload.lock.release()
        self._service._transfer_ended(self.upload.record.device_id)
        self._service._after_transfer(self._folder, self.upload)


class UploadService(IngestMixin):
    def __init__(
        self,
        *,
        ledger: Optional[ReservationLedger] = None,
        clock: Callable[[], float] = time.time,
        project_service=None,
        probe: Callable[[Path], VideoMetadata] = probe_video,
        on_imported: Optional[Callable[[str, ProjectSourceVideo, Optional[VideoMetadata]], None]] = None,
    ) -> None:
        self.ledger = ledger or ReservationLedger()
        self.clock = clock
        self.project_service = project_service
        self._probe = probe
        self._on_imported = on_imported
        self.fault: Callable[[str], None] = lambda step: None
        self._workers: Dict[str, threading.Thread] = {}
        self._recovered: set = set()
        self._lock = threading.RLock()
        self._folders: Dict[Path, _Folder] = {}
        self._active: Dict[str, int] = {}
        self._active_total = 0

    # -- project registry -----------------------------------------------------

    def folder(self, project_root: Path) -> _Folder:
        root = Path(project_root).resolve()
        with self._lock:
            folder = self._folders.get(root)
            if folder is None:
                try:
                    uploads = store.load_project_uploads(root)
                except StagingUnsafe as exc:
                    raise UploadRejected(500, "staging_unsafe", str(exc)) from exc
                folder = self._folders[root] = _Folder(root, uploads)
                for upload in uploads.values():
                    self._sync_ledger(upload)
            return folder

    def forget(self, project_root: Path) -> None:
        """Drop the cached view of a Project (tests simulate a restart with this)."""
        with self._lock:
            folder = self._folders.pop(Path(project_root).resolve(), None)
        if folder:
            for upload in folder.uploads.values():
                self.ledger.release(upload.upload_id)

    def _sync_ledger(self, upload: Upload) -> None:
        if upload.record.state in UNFINISHED_STATES and not upload.damaged:
            self.ledger.set(upload.upload_id, upload.record.length - upload.offset)
        else:
            self.ledger.release(upload.upload_id)

    # -- creation -----------------------------------------------------------------

    def create(
        self,
        project_root: Path,
        *,
        device_id: str,
        device_label: str,
        owner_login: str,
        upload_length: Optional[str],
        metadata_header: Optional[str],
        idempotency_key: Optional[str],
    ) -> tuple:
        """``(Upload, replayed)``; a retried creation returns the same upload."""
        if not idempotency_key or not _IDEMPOTENCY_KEY.match(idempotency_key):
            raise UploadRejected(400, "idempotency_key_required", "Idempotency-Key is required")
        if upload_length is None or not upload_length.isdigit() or int(upload_length) < 1:
            raise UploadRejected(400, "length_required", "Upload-Length is required")
        length = int(upload_length)
        if length > MAX_UPLOAD_BYTES:
            raise UploadRejected(413, "too_large", "That file is larger than 50 GB")
        metadata = validate_metadata(metadata_header)
        folder = self.folder(project_root)
        with folder.lock:
            for existing in folder.uploads.values():
                if (
                    existing.record.device_id == device_id
                    and existing.record.idempotency_key == idempotency_key
                ):
                    if (
                        existing.record.length != length
                        or existing.record.original_filename != metadata.original_filename
                    ):
                        raise UploadRejected(
                            409, "idempotency_conflict", "That key was used for a different file"
                        )
                    return existing, True
            unfinished = [
                u
                for u in folder.uploads.values()
                if u.record.device_id == device_id and u.record.state in UNFINISHED_STATES
            ]
            if len(unfinished) >= MAX_UNFINISHED_PER_DEVICE:
                raise UploadRejected(
                    429, "too_many_uploads", "Too many unfinished uploads from this phone"
                )
            if not self.ledger.can_fit(folder.root, length):
                raise UploadRejected(
                    507, "insufficient_storage", "The Mac is low on space for this file."
                )
            upload_id = uuid.uuid4().hex
            try:
                directory = store.new_upload_directory(folder.root, upload_id)
            except StagingUnsafe as exc:
                raise UploadRejected(500, "staging_unsafe", str(exc)) from exc
            record = UploadRecord(
                upload_id=upload_id,
                device_id=device_id,
                device_label=device_label,
                owner_login=owner_login,
                length=length,
                filename=metadata.filename,
                original_filename=metadata.original_filename,
                filetype=metadata.filetype,
                client_last_modified=metadata.client_last_modified,
                idempotency_key=idempotency_key,
                created_at=self.clock(),
            )
            try:
                (directory / store.DATA_NAME).touch()
                store.write_record(directory, record)
            except OSError as exc:
                store.remove_staging(directory)
                raise storage_error(exc) from exc
            upload = Upload(record=record, directory=directory, updated_at=record.created_at)
            folder.uploads[upload_id] = upload
            self.ledger.set(upload_id, length)
            return upload, False

    # -- lookup ------------------------------------------------------------------------

    def lookup(self, project_root: Path, upload_id: str, device_id: str) -> Upload:
        """The caller's own upload, even a tombstone; anyone else's is just missing."""
        upload = self.folder(project_root).uploads.get(upload_id)
        if upload is None or upload.record.device_id != device_id:
            raise UploadRejected(404, "not_found", "No such upload")
        return upload

    def get(self, project_root: Path, upload_id: str, device_id: str) -> Upload:
        """A live upload of the caller's (410 once it ended)."""
        upload = self.lookup(project_root, upload_id, device_id)
        if upload.record.state in ("expired", "cancelled"):
            raise UploadRejected(410, "gone", "This upload ended")
        return upload

    def expires_at(self, upload: Upload) -> Optional[float]:
        if upload.record.state in ("receiving", "received"):
            return upload.updated_at + UPLOAD_TTL_SEC
        return None

    # -- transfers ------------------------------------------------------------------------

    def begin_chunk(
        self,
        project_root: Path,
        upload: Upload,
        *,
        offset: int,
        content_length: int,
        checksum_header: Optional[str],
    ) -> ChunkWriter:
        """Validate a PATCH and take the upload lock; the caller must finish the writer."""
        algorithm, digest = parse_checksum_header(checksum_header)
        folder = self.folder(project_root)
        record = upload.record
        if record.state in ("expired", "cancelled"):
            raise UploadRejected(410, "gone", "This upload was ended")
        if record.state != "receiving":
            raise UploadRejected(409, "not_receiving", "This upload is not receiving bytes")
        if upload.damaged:
            raise UploadRejected(409, "damaged", "This upload is damaged; send the file again")
        if content_length > CHUNK_CEILING:
            raise UploadRejected(413, "chunk_too_large", "Chunks are at most 8 MiB")
        if not upload.lock.acquire(blocking=False):
            raise UploadRejected(423, "busy", "Another chunk for this upload is in flight")
        started = False
        try:
            if offset != upload.offset:
                raise UploadRejected(409, "offset_mismatch", "Upload-Offset does not match")
            if upload.offset + content_length > record.length:
                raise UploadRejected(413, "exceeds_length", "The chunk goes past the file length")
            self._transfer_started(record.device_id)
            started = True
            return ChunkWriter(self, folder, upload, algorithm, digest, content_length)
        except BaseException:
            if started:
                self._transfer_ended(record.device_id)
            upload.lock.release()
            raise

    def _transfer_started(self, device_id: str) -> None:
        with self._lock:
            if self._active.get(device_id, 0) >= MAX_ACTIVE_PER_DEVICE:
                raise UploadRejected(423, "busy", "Only one transfer at a time per phone")
            if self._active_total >= MAX_ACTIVE_PER_MAC:
                raise UploadRejected(423, "busy", "The Mac is receiving other transfers")
            self._active[device_id] = self._active.get(device_id, 0) + 1
            self._active_total += 1

    def _transfer_ended(self, device_id: str) -> None:
        with self._lock:
            if self._active.get(device_id, 0) > 0:
                self._active[device_id] -= 1
                self._active_total -= 1

    def _after_transfer(self, folder: _Folder, upload: Upload) -> None:
        if upload.cancel_requested:
            self._cancel_now(folder, upload)

    # -- ending uploads ------------------------------------------------------------------

    def _cancel_now(self, folder: _Folder, upload: Upload) -> None:
        if upload.record.state not in UNFINISHED_STATES:
            return
        record = upload.record.model_copy(update={"state": "cancelled", "ended_at": self.clock()})
        upload.record = record
        try:
            store.write_record(upload.directory, record)
        except OSError:
            pass
        store.remove_staging(upload.directory, keep_record=True)
        self.ledger.release(upload.upload_id)

    def terminate(self, project_root: Path, upload: Upload) -> None:
        """DELETE: end the transfer resource. Imported footage is never touched."""
        state = upload.record.state
        if state in ("cancelled", "expired", "imported", "failed"):
            return
        if state in ("verifying", "publishing"):
            raise UploadRejected(409, "busy", "This upload is being imported")
        self._request_cancel(self.folder(project_root), upload)

    def _request_cancel(self, folder: _Folder, upload: Upload) -> None:
        upload.cancel_requested = True
        if upload.lock.acquire(blocking=False):
            try:
                self._cancel_now(folder, upload)
            finally:
                upload.lock.release()
        # else: the in-flight writer cancels when it finishes (see _after_transfer)

    def on_device_ended(self, device_id: str) -> None:
        """Revoke or Disconnect: stop the device's unfinished uploads and free their space.

        Uploads already ``verifying`` or ``publishing`` are not interrupted: the
        import completes, because the bytes are verified and belong to the Project.
        """
        with self._lock:
            folders = list(self._folders.values())
        for folder in folders:
            for upload in list(folder.uploads.values()):
                if upload.record.device_id == device_id and upload.record.state in UNFINISHED_STATES:
                    self._request_cancel(folder, upload)

    # -- expiry ----------------------------------------------------------------------------

    def sweep(self, project_root: Path) -> None:
        """Expire stale uploads. Removes only app-owned staging; leaves tombstones."""
        folder = self.folder(project_root)
        now = self.clock()
        with folder.lock:
            for upload in list(folder.uploads.values()):
                state = upload.record.state
                if state in ("verifying", "publishing"):
                    continue
                if state in UNFINISHED_STATES and now - upload.updated_at > UPLOAD_TTL_SEC:
                    if not upload.lock.acquire(blocking=False):
                        continue
                    try:
                        record = upload.record.model_copy(
                            update={"state": "expired", "ended_at": now}
                        )
                        upload.record = record
                        store.write_record(upload.directory, record)
                        store.remove_staging(upload.directory, keep_record=True)
                        self.ledger.release(upload.upload_id)
                    finally:
                        upload.lock.release()
                elif state in ("expired", "cancelled", "failed") and (
                    now - (upload.record.ended_at or upload.updated_at) > TOMBSTONE_TTL_SEC
                ):
                    store.remove_staging(upload.directory)
                    del folder.uploads[upload.upload_id]
                elif state == "imported" and now - (upload.record.ended_at or 0) > UPLOAD_TTL_SEC:
                    store.remove_staging(upload.directory)
                    del folder.uploads[upload.upload_id]

    def sweep_all(self) -> None:
        """Expire stale uploads in every Project this process has loaded."""
        with self._lock:
            roots = list(self._folders)
        for root in roots:
            try:
                self.sweep(root)
            except Exception:
                pass

    # -- views --------------------------------------------------------------------------

    def status(self, project_root: Path, upload: Upload, *, include_chunks: bool = False) -> dict:
        record = upload.record
        receipt = store.read_ingest_receipt(Path(project_root), upload.upload_id) if (
            record.state == "imported"
        ) else None
        state = "failed" if upload.damaged else record.state
        if state == "publishing" and not self._worker_alive(upload.upload_id):
            # Nobody is finishing this import: recovery will (or already tried to).
            state = "recovery_pending"
        result = {
            "upload_id": upload.upload_id,
            "state": state,
            "offset": upload.offset,
            "length": record.length,
            "filename": record.filename,
            "expires_at": self.expires_at(upload),
            "error_code": "damaged" if upload.damaged else record.error_code,
            "error_message": record.error_message,
            "receipt": receipt,
        }
        if include_chunks:
            result["chunks"] = [
                {"offset": r.o, "length": r.n, "sha256": r.h} for r in upload.receipts
            ]
        return result


def iter_pieces(data: bytes, size: int) -> Iterator[bytes]:
    for index in range(0, len(data), size):
        yield data[index : index + size]


