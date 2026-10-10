"""Finalization, publication, deduplication and crash recovery (architecture §6).

``IngestMixin`` is the second half of ``UploadService``: it turns a fully received
upload into a verified Source Video. The transaction is journalled in the upload
record before anything irreversible happens, so a crash at any step recovers to
exactly one Source Video:

1. reread the staged file from disk and hash it
2. compare with ``Upload-Length`` and the phone's whole-file SHA-256
3. ``probe_video`` must read it
4. under the Project lock: deduplicate by size + SHA-256, reserve a collision-safe
   name, journal the intent
5. publish into the Project root with no-replace semantics (``os.link``)
6. flush the directory, commit the manifest, write the receipt, refresh the
   runtime projection and publish ``sources-changed``
"""

import hashlib
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..durable_io import fsync_directory, write_text_atomic
from ..models import VideoMetadata
from ..project_store import (
    ProjectSourceVideo,
    UploadProvenance,
    file_fingerprint,
    format_timestamp,
    open_project,
)
from ..video_probe import FFprobeError, FFprobeUnavailableError
from . import store
from .naming import UploadRejected, storage_error
from .store import PublishIntent, Upload

logger = logging.getLogger("uvicorn.error")

HASH_BLOCK = 1024 * 1024
VERIFICATION_METHOD = "sha256-disk-reread"
VERIFICATION_FAILED = "The file on the Mac didn't match this phone's copy. Nothing was imported."


def hash_file(path: Path) -> tuple:
    """``(size, sha256 hex)`` of a file, in bounded memory."""
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(HASH_BLOCK)
            if not block:
                break
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def _iso(timestamp: float) -> str:
    return format_timestamp(datetime.fromtimestamp(timestamp, tz=timezone.utc))


class _Failure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FinalizeContext:
    """What one finalization needs to know about its Project."""

    def __init__(self, project_root: Path, project_id: str) -> None:
        self.root = Path(project_root).resolve()
        self.project_id = project_id



class IngestMixin:
    def finalize(
        self,
        ctx: FinalizeContext,
        upload: Upload,
        *,
        sha256: str,
        idempotency_key: str,
        background: bool = True,
    ) -> str:
        """Start (or replay) finalization; returns the resulting state."""
        record = upload.record
        if record.state in ("expired", "cancelled"):
            raise UploadRejected(410, "gone", "This upload was ended")
        if record.state == "publishing" and not self._worker_alive(upload.upload_id):
            self.recover(ctx.root, ctx.project_id)  # an earlier import stalled: finish it now
            record = upload.record
        if record.state in ("imported", "failed", "verifying", "publishing"):
            if record.whole_sha256 and record.whole_sha256 != sha256 and record.state != "failed":
                raise UploadRejected(409, "sha_mismatch", "A different hash was already submitted")
            return record.state
        if upload.damaged:
            raise UploadRejected(409, "damaged", "This upload is damaged; send the file again")
        if record.state != "received" or upload.offset != record.length:
            raise UploadRejected(409, "incomplete", "Not all bytes have arrived yet")
        if not upload.lock.acquire(blocking=False):
            raise UploadRejected(423, "busy", "A chunk is still in flight")
        try:
            upload.record = record.model_copy(
                update={"state": "verifying", "whole_sha256": sha256, "finalize_key": idempotency_key}
            )
            store.write_record(upload.directory, upload.record)
            if background:
                worker = threading.Thread(
                    target=self._finalize_guarded,
                    args=(ctx, upload),
                    name=f"finalize-{upload.upload_id[:8]}",
                    daemon=True,
                )
                self._workers[upload.upload_id] = worker
                worker.start()
        except OSError as exc:
            upload.record = record
            raise storage_error(exc) from exc
        finally:
            upload.lock.release()
        if not background:
            self._finalize_guarded(ctx, upload)
        return "verifying"

    def _worker_alive(self, upload_id: str) -> bool:
        worker = self._workers.get(upload_id)
        return worker is not None and worker.is_alive()

    def wait(self, upload_id: str, timeout: float = 30.0) -> None:
        worker = self._workers.get(upload_id)
        if worker is not None:
            worker.join(timeout)

    def _finalize_guarded(self, ctx: FinalizeContext, upload: Upload) -> None:
        with upload.lock:
            try:
                self._finalize_sync(ctx, upload)
            except _Failure as failure:
                self._fail(upload, failure.code, failure.message)
            except Exception as exc:  # unexpected: leave a safe, honest outcome
                logger.exception("Finalizing upload %s failed", upload.upload_id)
                if upload.record.state == "publishing":
                    return  # journalled: recovery finishes it, nothing is lost
                self._fail(upload, "import_failed", f"The Mac couldn't finish the import ({type(exc).__name__})")

    def _fail(self, upload: Upload, code: str, message: str) -> None:
        upload.record = upload.record.model_copy(
            update={
                "state": "failed",
                "error_code": code,
                "error_message": message,
                "ended_at": self.clock(),
                "publish": None,
            }
        )
        try:
            store.write_record(upload.directory, upload.record)
        except OSError:
            pass
        store.remove_staging(upload.directory, keep_record=True)
        self.ledger.release(upload.upload_id)

    def _finalize_sync(self, ctx: FinalizeContext, upload: Upload) -> None:
        record = upload.record
        # 1-2. Reread what is on disk and compare it with what the phone sent.
        try:
            size, digest = hash_file(upload.data_path)
        except OSError as exc:
            raise _Failure("read_failed", "The Mac couldn't read the received file") from exc
        self.fault("after_reread")
        if size != record.length or digest != record.whole_sha256:
            raise _Failure("verification_failed", VERIFICATION_FAILED)
        # 3. It must be a video the Mac can read.
        try:
            metadata = self._probe(upload.data_path)
        except FFprobeUnavailableError as exc:
            raise _Failure("tools_missing", "The Mac's video tools aren't available") from exc
        except (FFprobeError, OSError) as exc:
            raise _Failure("not_a_video", "That file isn't a video the Mac can read.") from exc
        # 4. Deduplicate (hashing same-size candidates happens outside the lock).
        self._hash_candidates(ctx, size)
        with self.project_service.lock(ctx.project_id):
            manifest = open_project(ctx.root)
            existing = self._match_duplicate(ctx, manifest, size, digest)
            if existing is not None:
                self._journal_duplicate(upload, existing, digest)
                self._complete_duplicate(ctx, upload, existing, digest)
                return
            dest_name = self._reserve_name(ctx, manifest, upload)
            self._journal_publish(upload, dest_name, size, digest)
            self.fault("after_journal")
            self._publish(ctx, upload)
            source = self._commit_manifest(ctx, upload)
        self._finish_import(ctx, upload, source, metadata)

    def _hash_candidates(self, ctx: FinalizeContext, size: int) -> None:
        """Hash desktop footage of the same size that has no (valid) digest yet."""
        manifest = open_project(ctx.root)
        for video in manifest.source_videos:
            current = file_fingerprint(ctx.root / video.filename)
            if current is None or current.size != size:
                continue
            if video.sha256 and video.fingerprint == current:
                continue
            try:
                _size, digest = hash_file(ctx.root / video.filename)
            except OSError:
                continue

            def record_hash(m, name=video.filename, digest=digest, current=current):
                updated = []
                for entry in m.source_videos:
                    if entry.filename == name and file_fingerprint(ctx.root / name) == current:
                        entry = entry.model_copy(
                            update={"sha256": digest, "fingerprint": current, "size_bytes": current.size}
                        )
                    updated.append(entry)
                return m.model_copy(update={"source_videos": updated})

            self.project_service.update_manifest(ctx.project_id, record_hash)

    def _match_duplicate(self, ctx, manifest, size: int, digest: str):
        for video in manifest.source_videos:
            if video.sha256 != digest or video.size_bytes != size:
                continue
            current = file_fingerprint(ctx.root / video.filename)
            if current is not None and current == video.fingerprint:
                return video
        return None

    def _taken(self, ctx, manifest, upload: Upload, name: str) -> bool:
        if os.path.lexists(ctx.root / name):
            return True
        if any(v.filename.casefold() == name.casefold() for v in manifest.source_videos):
            return True
        folder = self.folder(ctx.root)
        for other in folder.uploads.values():
            intent = other.record.publish
            if other is not upload and intent is not None and intent.dest_name.casefold() == name.casefold():
                if other.record.state in ("publishing", "verifying"):
                    return True
        return False

    def _reserve_name(self, ctx, manifest, upload: Upload) -> str:
        name = upload.record.filename
        if not self._taken(ctx, manifest, upload, name):
            return name
        stem, dot, extension = name.rpartition(".")
        suffix = f".{extension}" if dot else ""
        short = upload.upload_id[:8]
        candidate = f"{stem}-phone-{short}{suffix}"
        counter = 2
        while self._taken(ctx, manifest, upload, candidate):
            candidate = f"{stem}-phone-{short}-{counter}{suffix}"
            counter += 1
        return candidate

    def _journal_publish(self, upload: Upload, dest_name: str, size: int, digest: str):
        attempt = upload.record.publish.attempt + 1 if upload.record.publish else 1
        upload.record = upload.record.model_copy(
            update={
                "state": "publishing",
                "publish": PublishIntent(dest_name=dest_name, size=size, sha256=digest, attempt=attempt),
            }
        )
        store.write_record(upload.directory, upload.record)

    def _journal_duplicate(self, upload: Upload, existing, digest: str) -> None:
        upload.record = upload.record.model_copy(
            update={
                "state": "publishing",
                "publish": PublishIntent(
                    dest_name=existing.filename,
                    size=existing.size_bytes or 0,
                    sha256=digest,
                    duplicate_of=existing.source_uuid,
                ),
            }
        )
        store.write_record(upload.directory, upload.record)
        self.fault("after_journal")

    def _publish(self, ctx: FinalizeContext, upload: Upload) -> None:
        """Link the verified bytes into the Project root without ever replacing a file."""
        manifest = open_project(ctx.root)
        for _ in range(50):
            intent = upload.record.publish
            destination = ctx.root / intent.dest_name
            try:
                os.link(upload.data_path, destination)
            except FileExistsError:
                if self._is_ours(destination, intent):
                    break  # recovery: an earlier attempt already published these bytes
                name = self._reserve_name(ctx, manifest, upload)
                if name == intent.dest_name:
                    name = f"{Path(name).stem}-{uuid.uuid4().hex[:6]}{Path(name).suffix}"
                self._journal_publish(upload, name, intent.size, intent.sha256)
                continue
            except FileNotFoundError:
                if self._is_ours(destination, intent):
                    break
                raise
            break
        else:
            raise _Failure("name_unavailable", "The Mac couldn't find a free file name")
        self.fault("after_link")
        fsync_directory(ctx.root)
        self.fault("after_flush")
        try:
            os.unlink(upload.data_path)
        except FileNotFoundError:
            pass

    def _is_ours(self, destination: Path, intent: PublishIntent) -> bool:
        try:
            if destination.stat().st_size != intent.size:
                return False
            return hash_file(destination)[1] == intent.sha256
        except OSError:
            return False

    def _provenance(self, upload: Upload) -> UploadProvenance:
        record = upload.record
        completed = upload.receipts[-1].t if upload.receipts else record.created_at
        return UploadProvenance(
            upload_id=record.upload_id,
            device_id=record.device_id,
            device_label=record.device_label,
            owner_login=record.owner_login,
            original_filename=record.original_filename,
            created_at=_iso(record.created_at),
            completed_at=_iso(completed),
            verified_at=_iso(self.clock()),
            verification_method=VERIFICATION_METHOD,
            sha256=record.publish.sha256 if record.publish else (record.whole_sha256 or ""),
            client_last_modified=record.client_last_modified,
        )

    def _commit_manifest(self, ctx: FinalizeContext, upload: Upload) -> ProjectSourceVideo:
        intent = upload.record.publish
        destination = ctx.root / intent.dest_name
        fingerprint = file_fingerprint(destination)
        source = ProjectSourceVideo(
            filename=intent.dest_name,
            imported_at=_iso(self.clock()),
            size_bytes=intent.size,
            sha256=intent.sha256,
            fingerprint=fingerprint,
            provenance=self._provenance(upload),
        )
        manifest = self.project_service.upsert_source_video(ctx.project_id, source)
        self.fault("after_manifest")
        for entry in manifest.source_videos:
            if entry.filename == intent.dest_name:
                return entry
        return source

    def _write_receipt(
        self, ctx: FinalizeContext, upload: Upload, source_uuid: str,
        filename: str, size: int, digest: str, duplicate: bool,
    ) -> dict:
        receipt = {
            "upload_id": upload.upload_id,
            "source_uuid": source_uuid,
            "filename": filename,
            "size_bytes": size,
            "sha256": digest,
            "verified_at": _iso(self.clock()),
            "already_in_project": duplicate,
            "device_id": upload.record.device_id,
            "device_label": upload.record.device_label,
            "owner_login": upload.record.owner_login,
            "original_filename": upload.record.original_filename,
            "client_last_modified": upload.record.client_last_modified,
            "verification_method": VERIFICATION_METHOD,
        }
        directory = store.receipts_dir(ctx.root)
        directory.mkdir(parents=True, exist_ok=True)
        write_text_atomic(directory / f"{upload.upload_id}.json", json.dumps(receipt, indent=2) + "\n")
        self.fault("after_receipt")
        return receipt

    def _finish_import(
        self, ctx: FinalizeContext, upload: Upload,
        source: ProjectSourceVideo, metadata: Optional[VideoMetadata],
    ) -> None:
        intent = upload.record.publish
        self._write_receipt(ctx, upload, source.source_uuid, source.filename,
                            intent.size, intent.sha256, duplicate=False)
        self._mark_imported(ctx, upload, source, metadata)

    def _mark_imported(
        self, ctx: FinalizeContext, upload: Upload,
        source: Optional[ProjectSourceVideo], metadata: Optional[VideoMetadata],
    ) -> None:
        if source is not None and self._on_imported is not None:
            try:
                self._on_imported(ctx.project_id, source, metadata)
            except Exception:
                logger.exception("Refreshing the Project after import failed")
        upload.record = upload.record.model_copy(
            update={"state": "imported", "ended_at": self.clock(), "receipt_name": f"{upload.upload_id}.json"}
        )
        store.write_record(upload.directory, upload.record)
        store.remove_staging(upload.directory, keep_record=True)
        self.ledger.release(upload.upload_id)

    def _complete_duplicate(self, ctx, upload: Upload, existing, digest: str) -> None:
        self._write_receipt(ctx, upload, existing.source_uuid, existing.filename,
                            existing.size_bytes or 0, digest, duplicate=True)
        self._mark_imported(ctx, upload, None, None)  # nothing new: no sources-changed

    # -- recovery -----------------------------------------------------------------------

    def ensure_recovered(self, project_root: Path, project_id: str) -> None:
        if Path(project_root).resolve() not in self._recovered:
            self.recover(project_root, project_id)

    def recover(self, project_root: Path, project_id: str) -> None:
        """Finish or roll back journalled publications after a restart (§6.1)."""
        ctx = FinalizeContext(project_root, project_id)
        folder = self.folder(ctx.root)
        with folder.lock:
            for upload in list(folder.uploads.values()):
                if not upload.lock.acquire(blocking=False):
                    continue
                try:
                    if self._worker_alive(upload.upload_id):
                        continue
                    state = upload.record.state
                    try:
                        if state == "verifying":
                            # Verification has no side effects: let the phone ask again.
                            upload.record = upload.record.model_copy(update={"state": "received"})
                            store.write_record(upload.directory, upload.record)
                        elif state == "publishing":
                            self._recover_publication(ctx, upload)
                    except _Failure as failure:
                        self._fail(upload, failure.code, failure.message)
                    except Exception:
                        logger.exception("Recovering upload %s failed", upload.upload_id)
                finally:
                    upload.lock.release()
        self.sweep(ctx.root)
        self._recovered.add(ctx.root)

    def _recover_publication(self, ctx: FinalizeContext, upload: Upload) -> None:
        intent = upload.record.publish
        if intent is None:
            raise _Failure("recovery_failed", "The import was interrupted before it was recorded")
        manifest = open_project(ctx.root)
        if intent.duplicate_of is not None:
            existing = next((v for v in manifest.source_videos if v.source_uuid == intent.duplicate_of), None)
            if existing is None:
                raise _Failure("recovery_failed", "The file this upload matched is gone")
            self._complete_duplicate(ctx, upload, existing, intent.sha256)
            return
        destination = ctx.root / intent.dest_name
        if not self._is_ours(destination, intent):
            staged = upload.data_path
            if not staged.exists() or not self._is_ours(staged, intent):
                raise _Failure("recovery_failed", "The received bytes are no longer available")
            if os.path.lexists(destination):  # a different file took the name meanwhile
                name = self._reserve_name(ctx, manifest, upload)
                self._journal_publish(upload, name, intent.size, intent.sha256)
            self._publish(ctx, upload)
        else:
            try:
                os.unlink(upload.data_path)
            except FileNotFoundError:
                pass
        with self.project_service.lock(ctx.project_id):
            source = self._commit_manifest(ctx, upload)
        try:
            metadata = self._probe(ctx.root / upload.record.publish.dest_name)
        except Exception:
            metadata = None
        self._finish_import(ctx, upload, source, metadata)
