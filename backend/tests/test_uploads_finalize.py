import hashlib
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

from remote_support import OWNER, Clock, RemoteHarness, Tus, chunk_checksum, tus_metadata
from src import api
from src.models import VideoMetadata
from src.project_events import SOURCES_CHANGED
from src.project_store import open_project, rescan_project
from src.reservations import ReservationLedger
from src.uploads import store
from src.uploads.service import FinalizeContext, UploadService, hash_file

DEVICE = "device-aaaa"


class SimulatedCrash(BaseException):
    pass


def fake_metadata(path):
    return VideoMetadata(
        file_id="x", file_path=str(path), file_name=Path(path).name, duration_sec=1.0, fps=30.0,
        resolution=[1920, 1080], codec="h264", size_bytes=os.path.getsize(path),
    )


def make_service(project_service=None, probe=fake_metadata, imported=None, clock=None):
    events = imported if imported is not None else []
    service = UploadService(
        ledger=ReservationLedger(lambda _p: (10**15, 0, 10**15)),
        clock=clock or Clock(),
        project_service=project_service or api.project_service,
        probe=probe,
        on_imported=lambda project_id, source, metadata: events.append((project_id, source.filename)),
    )
    service.events = events
    return service


@pytest.fixture
def world(tmp_path):
    harness = RemoteHarness(tmp_path / "state")
    project_uuid, folder, runtime_id = harness.make_project(tmp_path, files=("A.MP4",))
    yield type("World", (), {
        "h": harness, "uuid": project_uuid, "folder": folder, "pid": runtime_id,
        "ctx": FinalizeContext(folder, runtime_id), "tmp": tmp_path,
    })
    harness.close()


def receive(service, world, data, name="IMG_1234.MOV", device=DEVICE, key=None, chunk=4096):
    """Push a whole file through the tus service API; returns the received upload."""
    key = key or ("key-" + hashlib.sha256(name.encode() + data + os.urandom(4)).hexdigest()[:16])
    upload, _ = service.create(
        world.folder, device_id=device, device_label="iPhone", owner_login=OWNER,
        upload_length=str(len(data)), metadata_header=tus_metadata(name), idempotency_key=key,
    )
    offset = 0
    while offset < len(data):
        piece = data[offset : offset + chunk]
        writer = service.begin_chunk(world.folder, upload, offset=offset, content_length=len(piece),
                                     checksum_header=chunk_checksum(piece))
        writer.write(piece)
        offset = writer.commit()
    assert upload.record.state == "received"
    return upload


def finalize(service, world, upload, data=None, sha=None, background=False):
    digest = sha or hashlib.sha256(data).hexdigest()
    return service.finalize(world.ctx, upload, sha256=digest, idempotency_key="fin-key-0001",
                            background=background)


def manifest_of(world):
    return open_project(world.folder)


def files_with_content(world, data):
    return sorted(p.name for p in world.folder.iterdir() if p.is_file() and p.read_bytes() == data)


def entries_for(world, name):
    return [v for v in manifest_of(world).source_videos if v.filename == name]


CONTENT = os.urandom(20_000)


# --- the happy path -----------------------------------------------------------------


def test_finalize_publishes_a_verified_source_video_with_provenance_and_a_receipt(world):
    service = make_service()
    upload = receive(service, world, CONTENT)

    assert finalize(service, world, upload, CONTENT) == "verifying"

    assert upload.record.state == "imported"
    assert (world.folder / "IMG_1234.MOV").read_bytes() == CONTENT
    manifest = manifest_of(world)
    entry = entries_for(world, "IMG_1234.MOV")[0]
    assert [v.filename for v in manifest.source_videos].count("IMG_1234.MOV") == 1
    assert entry.sha256 == hashlib.sha256(CONTENT).hexdigest()
    assert entry.size_bytes == len(CONTENT)
    assert entry.fingerprint.size == len(CONTENT)
    prov = entry.provenance
    assert (prov.upload_id, prov.device_id, prov.device_label, prov.owner_login) == (
        upload.upload_id, DEVICE, "iPhone", OWNER)
    assert prov.original_filename == "IMG_1234.MOV"
    assert prov.verification_method == "sha256-disk-reread" and prov.sha256 == entry.sha256

    receipt = store.read_ingest_receipt(world.folder, upload.upload_id)
    assert receipt["source_uuid"] == entry.source_uuid
    assert receipt["sha256"] == entry.sha256 and receipt["already_in_project"] is False
    assert receipt["filename"] == "IMG_1234.MOV" and receipt["size_bytes"] == len(CONTENT)
    assert "secret" not in json.dumps(receipt).lower()

    # staging is gone, the record remains as the upload's history
    assert not upload.data_path.exists()
    assert (upload.directory / store.RECORD_NAME).exists()
    assert service.ledger.total() == 0
    assert service.events == [(world.pid, "IMG_1234.MOV")]
    assert not list(world.folder.glob(".*tmp"))


def test_status_of_an_imported_upload_carries_the_receipt(world):
    service = make_service()
    upload = receive(service, world, CONTENT)
    finalize(service, world, upload, CONTENT)
    status = service.status(world.folder, upload)
    assert status["state"] == "imported"
    assert status["receipt"]["sha256"] == hashlib.sha256(CONTENT).hexdigest()
    assert status["receipt"]["already_in_project"] is False


# --- integrity ----------------------------------------------------------------------


def test_a_whole_file_hash_mismatch_never_publishes(world):
    service = make_service()
    upload = receive(service, world, CONTENT)
    before = sorted(os.listdir(world.folder))
    manifest_before = manifest_of(world).model_dump()

    finalize(service, world, upload, sha="0" * 64)

    assert upload.record.state == "failed"
    assert upload.record.error_code == "verification_failed"
    assert upload.record.error_message == (
        "The file on the Mac didn't match this phone's copy. Nothing was imported."
    )
    assert sorted(os.listdir(world.folder)) == before
    assert manifest_of(world).model_dump() == manifest_before
    assert store.read_ingest_receipt(world.folder, upload.upload_id) is None
    assert not upload.data_path.exists()  # the bad bytes are dropped
    assert service.events == []
    assert service.ledger.total() == 0


def test_bytes_altered_on_disk_after_receipt_fail_the_reread_check(world):
    service = make_service()
    upload = receive(service, world, CONTENT)
    with open(upload.data_path, "r+b") as handle:  # bit rot / tampering after the last ack
        handle.seek(10)
        handle.write(b"\xff\xff")

    finalize(service, world, upload, CONTENT)

    assert upload.record.state == "failed" and upload.record.error_code == "verification_failed"
    assert not (world.folder / "IMG_1234.MOV").exists()


def test_something_that_is_not_a_video_is_refused(world):
    from src.video_probe import FFprobeError

    def not_video(_path):
        raise FFprobeError("invalid data")

    service = make_service(probe=not_video)
    upload = receive(service, world, CONTENT)
    finalize(service, world, upload, CONTENT)

    assert upload.record.state == "failed" and upload.record.error_code == "not_a_video"
    assert upload.record.error_message == "That file isn't a video the Mac can read."
    assert not (world.folder / "IMG_1234.MOV").exists()


def test_finalize_needs_every_byte_and_a_live_upload(world):
    from src.uploads.naming import UploadRejected

    service = make_service()
    upload, _ = service.create(
        world.folder, device_id=DEVICE, device_label="iPhone", owner_login=OWNER,
        upload_length="100", metadata_header=tus_metadata("a.mov"), idempotency_key="key-00000001")
    with pytest.raises(UploadRejected) as incomplete:
        service.finalize(world.ctx, upload, sha256="0" * 64, idempotency_key="fin-key-0001")
    assert (incomplete.value.status, incomplete.value.code) == (409, "incomplete")
    service.terminate(world.folder, upload)
    with pytest.raises(UploadRejected) as gone:
        service.finalize(world.ctx, upload, sha256="0" * 64, idempotency_key="fin-key-0001")
    assert gone.value.status == 410


# --- no overwrite ---------------------------------------------------------------------------


def test_an_existing_same_name_file_is_never_overwritten(world):
    original = b"the editor's own IMG_1234 from the desktop"
    (world.folder / "IMG_1234.MOV").write_bytes(original)
    service = make_service()
    upload = receive(service, world, CONTENT)

    finalize(service, world, upload, CONTENT)

    short = upload.upload_id[:8]
    assert (world.folder / "IMG_1234.MOV").read_bytes() == original
    assert (world.folder / f"IMG_1234-phone-{short}.MOV").read_bytes() == CONTENT
    entry = entries_for(world, f"IMG_1234-phone-{short}.MOV")[0]
    assert entry.provenance.original_filename == "IMG_1234.MOV"
    assert store.read_ingest_receipt(world.folder, upload.upload_id)["filename"] == (
        f"IMG_1234-phone-{short}.MOV")


def test_a_file_that_appears_between_reserving_the_name_and_publishing_is_not_replaced(world):
    foreign = b"someone dropped this in Finder at the wrong moment"
    service = make_service()
    upload = receive(service, world, CONTENT)

    def finder_wins(step):
        if step == "after_journal":
            (world.folder / "IMG_1234.MOV").write_bytes(foreign)

    service.fault = finder_wins
    finalize(service, world, upload, CONTENT)

    assert upload.record.state == "imported"
    assert (world.folder / "IMG_1234.MOV").read_bytes() == foreign
    published = upload.record.publish.dest_name
    assert published != "IMG_1234.MOV" and (world.folder / published).read_bytes() == CONTENT
    assert len(files_with_content(world, CONTENT)) == 1


def test_concurrent_uploads_with_the_same_name_get_distinct_files(world):
    service = make_service()
    one, two = os.urandom(5000), os.urandom(5000)
    a = receive(service, world, one, "IMG_7.MOV", device="devA")
    b = receive(service, world, two, "IMG_7.MOV", device="devB")
    errors = []

    def run(upload, data):
        try:
            finalize(service, world, upload, data)
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(a, one)), threading.Thread(target=run, args=(b, two))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert files_with_content(world, one) and files_with_content(world, two)
    names = {a.record.publish.dest_name, b.record.publish.dest_name}
    assert len(names) == 2 and "IMG_7.MOV" in names
    assert len([v for v in manifest_of(world).source_videos if "IMG_7" in v.filename]) == 2


# --- deduplication ------------------------------------------------------------------------------


def test_duplicate_content_returns_the_existing_source_with_an_extra_receipt(world):
    service = make_service()
    first = receive(service, world, CONTENT, "IMG_1.MOV")
    finalize(service, world, first, CONTENT)
    entry = entries_for(world, "IMG_1.MOV")[0]
    second = receive(service, world, CONTENT, "IMG_1_copy.MOV", device="devB")

    finalize(service, world, second, CONTENT)

    assert second.record.state == "imported"
    receipt = store.read_ingest_receipt(world.folder, second.upload_id)
    assert receipt["source_uuid"] == entry.source_uuid
    assert receipt["filename"] == "IMG_1.MOV" and receipt["already_in_project"] is True
    assert receipt["device_id"] == "devB"  # extra provenance lives in the receipt
    assert [v.filename for v in manifest_of(world).source_videos if v.size_bytes == len(CONTENT)] == [
        "IMG_1.MOV"]
    assert files_with_content(world, CONTENT) == ["IMG_1.MOV"]
    assert not second.data_path.exists()  # redundant staged bytes are deleted
    assert service.events == [(world.pid, "IMG_1.MOV")]  # nothing new for the Project
    status = service.status(world.folder, second)
    assert status["receipt"]["already_in_project"] is True


def test_footage_already_on_the_desktop_without_a_hash_is_recognised_and_hashed(world):
    desktop = b"video A.MP4"  # what make_project wrote for A.MP4
    service = make_service()
    upload = receive(service, world, desktop, "FROM_PHONE.MOV")

    finalize(service, world, upload, desktop)

    receipt = store.read_ingest_receipt(world.folder, upload.upload_id)
    assert receipt["already_in_project"] is True and receipt["filename"] == "A.MP4"
    assert not (world.folder / "FROM_PHONE.MOV").exists()
    entry = entries_for(world, "A.MP4")[0]
    assert entry.sha256 == hashlib.sha256(desktop).hexdigest()  # stored for next time


def test_same_size_but_different_content_is_not_a_duplicate(world):
    service = make_service()
    a = os.urandom(4000)
    b = os.urandom(4000)
    one = receive(service, world, a, "ONE.MOV")
    finalize(service, world, one, a)
    two = receive(service, world, b, "TWO.MOV")
    finalize(service, world, two, b)
    assert {v.filename for v in manifest_of(world).source_videos} == {"A.MP4", "ONE.MOV", "TWO.MOV"}


def test_a_changed_file_is_not_used_for_deduplication(world):
    service = make_service()
    first = receive(service, world, CONTENT, "IMG_1.MOV")
    finalize(service, world, first, CONTENT)
    (world.folder / "IMG_1.MOV").write_bytes(b"x" * len(CONTENT))  # edited on disk afterwards
    again = receive(service, world, CONTENT, "IMG_2.MOV", device="devB")
    finalize(service, world, again, CONTENT)
    receipt = store.read_ingest_receipt(world.folder, again.upload_id)
    assert receipt["already_in_project"] is False and receipt["filename"] == "IMG_2.MOV"


def test_two_simultaneous_identical_uploads_import_exactly_once(world):
    service = make_service()
    a = receive(service, world, CONTENT, "IMG_1.MOV", device="devA")
    b = receive(service, world, CONTENT, "IMG_1.MOV", device="devB")
    threads = [threading.Thread(target=finalize, args=(service, world, u, CONTENT)) for u in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert {a.record.state, b.record.state} == {"imported"}
    receipts = [store.read_ingest_receipt(world.folder, u.upload_id) for u in (a, b)]
    assert sorted(r["already_in_project"] for r in receipts) == [False, True]
    assert len({r["source_uuid"] for r in receipts}) == 1
    assert len(files_with_content(world, CONTENT)) == 1


# --- replay -------------------------------------------------------------------------------------------


def test_a_lost_finalize_response_replays_the_receipt_without_importing_twice(world):
    service = make_service()
    upload = receive(service, world, CONTENT)
    assert finalize(service, world, upload, CONTENT) == "verifying"
    again = finalize(service, world, upload, CONTENT)

    assert again == "imported"
    assert service.status(world.folder, upload)["receipt"]["sha256"] == hashlib.sha256(CONTENT).hexdigest()
    assert files_with_content(world, CONTENT) == ["IMG_1234.MOV"]
    assert len(service.events) == 1
    from src.uploads.naming import UploadRejected

    with pytest.raises(UploadRejected) as conflict:
        finalize(service, world, upload, sha="1" * 64)
    assert conflict.value.status == 409


# --- crash injection ------------------------------------------------------------------------------------


STEPS = ["after_reread", "after_journal", "after_link", "after_flush", "after_manifest", "after_receipt"]


@pytest.mark.parametrize("step", STEPS)
def test_a_crash_after_each_step_recovers_to_exactly_one_source_video(world, step):
    service = make_service()
    upload = receive(service, world, CONTENT)

    def crash(at):
        if at == step:
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        finalize(service, world, upload, CONTENT)

    # -- restart: a new service over the same files; the old process is gone --
    service.forget(world.folder)
    reborn = make_service()
    pending = reborn.folder(world.folder).uploads[upload.upload_id]
    if step != "after_reread":
        assert reborn.status(world.folder, pending)["state"] == "recovery_pending"

    reborn.recover(world.folder, world.pid)

    again = reborn.folder(world.folder).uploads[upload.upload_id]
    if step == "after_reread":
        # verification had no side effects: back to `received`, and the phone can finalize again
        assert again.record.state == "received"
        assert finalize(reborn, world, again, CONTENT) == "verifying"
        assert again.record.state == "imported"
    assert again.record.state == "imported"
    assert files_with_content(world, CONTENT) == ["IMG_1234.MOV"]
    entries = entries_for(world, "IMG_1234.MOV")
    assert len(entries) == 1
    assert entries[0].provenance.upload_id == upload.upload_id
    assert entries[0].sha256 == hashlib.sha256(CONTENT).hexdigest()
    assert len([v for v in manifest_of(world).source_videos if v.size_bytes == len(CONTENT)]) == 1
    receipt = store.read_ingest_receipt(world.folder, upload.upload_id)
    assert receipt["source_uuid"] == entries[0].source_uuid
    assert not again.data_path.exists()
    assert reborn.ledger.total() == 0
    assert reborn.status(world.folder, again)["state"] == "imported"
    # and a replayed finalize is a no-op
    assert finalize(reborn, world, again, CONTENT) == "imported"
    assert len(files_with_content(world, CONTENT)) == 1


@pytest.mark.parametrize("step", ["after_journal", "after_manifest"])
def test_recovery_survives_a_foreign_file_taking_the_name_during_the_outage(world, step):
    service = make_service()
    upload = receive(service, world, CONTENT)

    def crash(at):
        if at == step:
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        finalize(service, world, upload, CONTENT)
    if step == "after_journal":
        (world.folder / "IMG_1234.MOV").write_bytes(b"foreign file")
    service.forget(world.folder)
    reborn = make_service()

    reborn.recover(world.folder, world.pid)

    again = reborn.folder(world.folder).uploads[upload.upload_id]
    assert again.record.state == "imported"
    published = again.record.publish.dest_name
    assert (world.folder / published).read_bytes() == CONTENT
    if step == "after_journal":
        assert (world.folder / "IMG_1234.MOV").read_bytes() == b"foreign file"
        assert published != "IMG_1234.MOV"
    assert len(files_with_content(world, CONTENT)) == 1
    assert len(entries_for(world, published)) == 1


def test_a_crash_during_a_duplicate_import_recovers_with_its_receipt(world):
    service = make_service()
    first = receive(service, world, CONTENT, "IMG_1.MOV")
    finalize(service, world, first, CONTENT)
    second = receive(service, world, CONTENT, "IMG_1b.MOV", device="devB")

    def crash(at):
        if at == "after_journal":
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        finalize(service, world, second, CONTENT)
    service.forget(world.folder)
    reborn = make_service()
    reborn.recover(world.folder, world.pid)

    again = reborn.folder(world.folder).uploads[second.upload_id]
    assert again.record.state == "imported"
    assert store.read_ingest_receipt(world.folder, second.upload_id)["already_in_project"] is True
    assert files_with_content(world, CONTENT) == ["IMG_1.MOV"]


def test_recovery_that_cannot_find_the_bytes_fails_honestly_without_inventing_a_file(world):
    service = make_service()
    upload = receive(service, world, CONTENT)

    def crash(at):
        if at == "after_journal":
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        finalize(service, world, upload, CONTENT)
    os.unlink(upload.data_path)  # the staging bytes were lost with the crash
    service.forget(world.folder)
    reborn = make_service()
    reborn.recover(world.folder, world.pid)

    again = reborn.folder(world.folder).uploads[upload.upload_id]
    assert again.record.state == "failed" and again.record.error_code == "recovery_failed"
    assert not (world.folder / "IMG_1234.MOV").exists()


def test_opening_the_project_on_the_desktop_finishes_an_interrupted_import(world, tmp_path):
    """No remote listener involved: the desktop's own open recovers the journal."""
    service = make_service(project_service=api.project_service)
    upload = receive(service, world, CONTENT)

    def crash(at):
        if at == "after_link":
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        finalize(service, world, upload, CONTENT)
    api.projects.clear()  # the app was quit

    from fastapi.testclient import TestClient

    opened = TestClient(api.app).post("/projects/from-folder", json={"folder_path": str(world.folder)})
    assert opened.status_code == 200
    body = opened.json()
    assert "IMG_1234.MOV" in [v["file_name"] for v in body["videos"]]
    assert "IMG_1234.MOV" in [v["filename"] for v in body["project"]["source_videos"]]
    receipt = store.read_ingest_receipt(world.folder, upload.upload_id)
    assert receipt is not None and receipt["filename"] == "IMG_1234.MOV"
    assert len(files_with_content(world, CONTENT)) == 1


# --- racing the desktop ---------------------------------------------------------------------------------


@pytest.mark.parametrize("step", ["after_flush", "after_manifest"])
def test_a_desktop_rescan_racing_a_publish_keeps_both(world, step):
    """A rescan interleaved at either side of the manifest commit loses nothing."""
    service = make_service()
    upload = receive(service, world, CONTENT)
    seen = {}

    def rescan_now(at):
        if at == step:
            seen["manifest"] = api.project_service.rescan(world.pid)

    service.fault = rescan_now
    finalize(service, world, upload, CONTENT)

    entries = entries_for(world, "IMG_1234.MOV")
    assert len(entries) == 1 and entries[0].provenance is not None
    assert entries[0].sha256 == hashlib.sha256(CONTENT).hexdigest()
    assert "A.MP4" in {v.filename for v in manifest_of(world).source_videos}
    after = rescan_project(world.folder)
    kept = {v.filename: v for v in after.source_videos}["IMG_1234.MOV"]
    assert kept.source_uuid == entries[0].source_uuid and kept.provenance is not None


def test_a_rescan_from_another_thread_waits_for_the_publish_and_keeps_it(world):
    service = make_service()
    upload = receive(service, world, CONTENT)
    started = threading.Event()
    release = threading.Event()

    def hold(at):
        if at == "after_link":
            started.set()
            assert release.wait(10)

    service.fault = hold
    worker = threading.Thread(target=finalize, args=(service, world, upload, CONTENT))
    worker.start()
    assert started.wait(10)
    scanned = []
    scanner = threading.Thread(target=lambda: scanned.append(api.project_service.rescan(world.pid)))
    scanner.start()
    scanner.join(0.3)
    assert scanner.is_alive()  # serialized behind the publish, not interleaved with it
    release.set()
    worker.join(10)
    scanner.join(10)

    entry = {v.filename: v for v in scanned[0].source_videos}["IMG_1234.MOV"]
    assert entry.provenance is not None


def test_revoke_during_publishing_does_not_interrupt_the_publication(world):
    service = make_service()
    upload = receive(service, world, CONTENT, device=DEVICE)
    started, release = threading.Event(), threading.Event()

    def hold(at):
        if at == "after_journal":
            started.set()
            assert release.wait(10)

    service.fault = hold
    worker = threading.Thread(target=finalize, args=(service, world, upload, CONTENT))
    worker.start()
    assert started.wait(10)
    assert upload.record.state == "publishing"

    service.on_device_ended(DEVICE)  # the phone was revoked right now
    release.set()
    worker.join(10)

    assert upload.record.state == "imported"
    assert (world.folder / "IMG_1234.MOV").read_bytes() == CONTENT
    assert len(entries_for(world, "IMG_1234.MOV")) == 1
    assert service.ledger.total() == 0


# --- HTTP, with a real video -----------------------------------------------------------------------------


@pytest.fixture(scope="module")
def tiny_video(tmp_path_factory):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is required to synthesise a video")
    path = tmp_path_factory.mktemp("synthetic") / "tiny.mov"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc=duration=1:size=160x120:rate=10", "-c:v", "mpeg4", str(path)],
        check=True,
    )
    return path.read_bytes()


def wait_for(predicate, timeout=20):
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out")


def test_full_upload_over_http_ends_in_a_verified_import_with_a_receipt(world, tiny_video, monkeypatch):
    service = UploadService(
        ledger=ReservationLedger(lambda _p: (10**15, 0, 10**15)),
        project_service=api.project_service,
        on_imported=api.on_source_imported,
    )
    world.h.runtime.uploads = service
    world.h.app = __import__("src.remote.app", fromlist=["create_remote_app"]).create_remote_app(world.h.runtime)
    phone = world.h.paired_phone()
    tus = Tus(phone, world.uuid)
    published = []
    monkeypatch.setattr(api, "publish_project_event", lambda pid, payload: published.append((pid, payload)))

    created = tus.create(len(tiny_video), filename="IMG_4513.MOV", key="http-key-0001")
    upload_id = tus.upload_id(created)
    size = 16 * 1024
    for offset in range(0, len(tiny_video), size):
        piece = tiny_video[offset : offset + size]
        assert tus.patch(upload_id, offset, piece).status_code == 204
    digest = hashlib.sha256(tiny_video).hexdigest()

    wrong = phone.post(f"{tus.base}/uploads/{upload_id}/finalize",
                       {"sha256": "A" * 64, "idempotency_key": "fin-key-0001"})
    assert wrong.status_code == 422  # not a lower-case hex digest

    first = phone.post(f"{tus.base}/uploads/{upload_id}/finalize",
                       {"sha256": digest, "idempotency_key": "fin-key-0001"})
    assert first.status_code in (200, 202)
    status = wait_for(lambda: (lambda s: s if s["state"] == "imported" else None)(tus.status(upload_id).json()))
    assert status["receipt"]["sha256"] == digest
    assert status["receipt"]["filename"] == "IMG_4513.MOV"
    assert status["receipt"]["size_bytes"] == len(tiny_video)
    assert status["receipt"]["already_in_project"] is False

    replay = phone.post(f"{tus.base}/uploads/{upload_id}/finalize",
                        {"sha256": digest, "idempotency_key": "fin-key-0001"})
    assert replay.status_code == 200 and replay.json()["state"] == "imported"
    assert replay.json()["receipt"] == status["receipt"]

    manifest = open_project(world.folder)
    assert [v.filename for v in manifest.source_videos].count("IMG_4513.MOV") == 1
    detail = phone.get(f"/api/projects/{world.uuid}").json()
    names = {s["name"]: s for s in detail["sources"]}
    assert names["IMG_4513.MOV"]["from_phone"] is True
    assert names["IMG_4513.MOV"]["duration_sec"] == pytest.approx(1.0, abs=0.2)
    assert detail["source_count"] == 2
    # the desktop sees the real probed metadata immediately, and was told
    video = {v["file_name"]: v for v in api.projects[world.pid]["videos"]}["IMG_4513.MOV"]
    assert video["metadata"]["resolution"] == [160, 120]
    assert published == [(world.pid, {"type": SOURCES_CHANGED})]


def test_finalize_over_http_checks_ownership_and_completeness(world):
    service = UploadService(
        ledger=ReservationLedger(lambda _p: (10**15, 0, 10**15)),
        project_service=api.project_service,
        probe=fake_metadata,
    )
    world.h.runtime.uploads = service
    world.h.app = __import__("src.remote.app", fromlist=["create_remote_app"]).create_remote_app(world.h.runtime)
    phone = world.h.paired_phone()
    tus = Tus(phone, world.uuid)
    upload_id = tus.upload_id(tus.create(2000))
    body = {"sha256": "0" * 64, "idempotency_key": "fin-key-0001"}
    incomplete = phone.post(f"{tus.base}/uploads/{upload_id}/finalize", body)
    assert incomplete.status_code == 409 and incomplete.json()["reason"] == "incomplete"

    intruder = world.h.paired_phone("iPad")
    assert intruder.post(f"{tus.base}/uploads/{upload_id}/finalize", body).status_code == 404
    assert phone.post(f"{tus.base}/uploads/{'f' * 32}/finalize", body).status_code == 404
    no_csrf = phone.post(f"{tus.base}/uploads/{upload_id}/finalize", body, extra={"X-CSRF-Token": "x"})
    assert no_csrf.status_code == 403


def test_hash_file_reads_in_bounded_blocks(tmp_path):
    path = tmp_path / "big.bin"
    path.write_bytes(os.urandom(3 * 1024 * 1024 + 17))
    size, digest = hash_file(path)
    assert size == path.stat().st_size and digest == hashlib.sha256(path.read_bytes()).hexdigest()
