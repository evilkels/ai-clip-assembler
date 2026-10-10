import errno
import hashlib
import os
import threading
from pathlib import Path

import pytest

from remote_support import OWNER, Clock, RemoteHarness, Tus, chunk_checksum, tus_metadata
from src.reservations import GIB, ReservationLedger
from src.uploads import store
from src.uploads.naming import UploadRejected, sanitize_filename, validate_metadata
from src.uploads.service import (
    CHUNK_CEILING,
    MAX_UNFINISHED_PER_DEVICE,
    TOMBSTONE_TTL_SEC,
    UPLOAD_TTL_SEC,
    UploadService,
    parse_checksum_header,
)

MIB = 1024 * 1024
DATA = os.urandom(3 * 1024)  # content for tiny tests; chunk sizes are what matter


class SimulatedCrash(BaseException):
    """Stands in for the process dying at a precise step."""


def make_root(tmp_path, name="proj"):
    root = tmp_path / name
    (root / "clipassembler").mkdir(parents=True)
    return root


def service_for(clock=None, ledger=None):
    return UploadService(clock=clock or Clock(), ledger=ledger or ReservationLedger(lambda _p: (10**15, 0, 10**15)))


def create(service, root, length, *, device="dev1", key="key-00000001", filename="IMG_1.MOV"):
    upload, replayed = service.create(
        root,
        device_id=device,
        device_label="iPhone",
        owner_login=OWNER,
        upload_length=str(length),
        metadata_header=tus_metadata(filename),
        idempotency_key=key,
    )
    return upload, replayed


def send_chunk(service, root, upload, offset, data, pieces=1):
    writer = service.begin_chunk(
        root,
        upload,
        offset=offset,
        content_length=len(data),
        checksum_header=chunk_checksum(data),
    )
    size = max(1, len(data) // pieces)
    for index in range(0, len(data), size):
        writer.write(data[index : index + size])
    return writer.commit()


def restart(service, root):
    """A fresh service over the same files: what a crashed backend comes back to."""
    service.forget(root)
    fresh = UploadService(clock=service.clock, ledger=ReservationLedger(lambda _p: (10**15, 0, 10**15)))
    return fresh


def reload_upload(service, root, upload_id, device="dev1"):
    return service.get(root, upload_id, device)


# --- naming and metadata -----------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("IMG_1234.MOV", "IMG_1234.MOV"),
        ("clip one.mp4", "clip one.mp4"),
        ("../../etc/passwd.mov", "etcpasswd.mov"),
        ("a\\b/c:d.mp4", "abcd.mp4"),
        ("tab\tand\nnewline.mov", "tabandnewline.mov"),
        ("é.mov", "é.mov"),  # NFD é -> NFC
        ("  spaced.MP4  ", "spaced.MP4"),
        ("...dots...mov", "dots.mov"),
    ],
)
def test_filenames_are_sanitized_to_a_top_level_name(raw, expected):
    name = sanitize_filename(raw)
    assert name == expected
    assert "/" not in name and "\\" not in name and "\x00" not in name


def test_long_names_are_shortened_but_keep_their_extension():
    name = sanitize_filename("x" * 500 + ".MOV")
    assert name.endswith(".MOV") and len(name.encode()) <= 200
    wide = sanitize_filename("é" * 300 + ".mp4")
    assert len(wide.encode()) <= 200 and wide.endswith(".mp4")


@pytest.mark.parametrize(
    "raw, status, code",
    [
        ("IMG.mkv", 415, "unsupported_type"),
        ("IMG.exe", 415, "unsupported_type"),
        ("IMG", 415, "unsupported_type"),
        (".mov", 415, "unsupported_type"),
        ("", 400, "bad_filename"),
        (".", 400, "bad_filename"),
        ("..", 400, "bad_filename"),
        ("/", 400, "bad_filename"),
        (" .mov", 415, "unsupported_type"),
    ],
)
def test_unusable_names_are_refused(raw, status, code):
    with pytest.raises(UploadRejected) as exc:
        sanitize_filename(raw)
    assert (exc.value.status, exc.value.code) == (status, code)


def test_metadata_is_bounded_validated_and_ignores_unknown_keys():
    meta = validate_metadata(tus_metadata("IMG.MOV", "video/quicktime", 1_700_000_000_000))
    assert (meta.filename, meta.filetype, meta.client_last_modified) == (
        "IMG.MOV",
        "video/quicktime",
        1_700_000_000_000,
    )
    for bad in (None, "", "filename", "filename !!!notb64", "a b," * 20, "x" * 5000):
        with pytest.raises(UploadRejected):
            validate_metadata(bad)
    with pytest.raises(UploadRejected) as wrong_type:
        validate_metadata(tus_metadata("IMG.MOV", "text/html"))
    assert wrong_type.value.status == 415
    with pytest.raises(UploadRejected):
        validate_metadata(tus_metadata("IMG.MOV", last_modified=-5))
    with pytest.raises(UploadRejected):
        validate_metadata(tus_metadata("IMG.MOV", last_modified="abc"))


def test_checksum_header_parsing():
    digest = hashlib.sha256(b"x").digest()
    import base64

    ok = parse_checksum_header("sha256 " + base64.b64encode(digest).decode())
    assert ok == ("sha256", digest)
    assert parse_checksum_header("sha1 " + base64.b64encode(hashlib.sha1(b"x").digest()).decode())[0] == "sha1"
    for bad in (None, "", "md5 AAAA", "sha256", "sha256 !!!", "sha256 " + base64.b64encode(b"short").decode()):
        with pytest.raises(UploadRejected):
            parse_checksum_header(bad)


# --- durable chunks: only acknowledged bytes survive ----------------------------------


@pytest.mark.parametrize("step", ["after_write", "after_fsync"])
def test_crash_before_the_checkpoint_loses_only_the_unacknowledged_chunk(tmp_path, step):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 3 * len(DATA))
    first = DATA
    send_chunk(service, root, upload, 0, first)

    def crash(at):
        if at == step:
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        send_chunk(service, root, upload, len(DATA), os.urandom(len(DATA)))
    # Emulate a hard kill that never ran cleanup: the stray bytes stay on disk.
    with open(upload.data_path, "ab") as handle:
        handle.write(b"UNACKNOWLEDGED" * 50)

    reborn = restart(service, root)
    again = reload_upload(reborn, root, upload.upload_id)
    assert again.offset == len(DATA)
    assert again.data_path.read_bytes() == first  # trimmed back to the checkpoint
    assert again.record.state == "receiving"
    # ...and the transfer carries on from there.
    send_chunk(reborn, root, again, again.offset, DATA)
    assert again.offset == 2 * len(DATA)


def test_crash_after_the_checkpoint_keeps_the_chunk_even_though_the_ack_was_lost(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 3 * len(DATA))
    second = os.urandom(len(DATA))
    send_chunk(service, root, upload, 0, DATA)

    def crash(at):
        if at == "after_checkpoint":
            raise SimulatedCrash(at)

    service.fault = crash
    with pytest.raises(SimulatedCrash):
        send_chunk(service, root, upload, len(DATA), second)

    reborn = restart(service, root)
    again = reload_upload(reborn, root, upload.upload_id)
    assert again.offset == 2 * len(DATA)  # the phone's HEAD will tell it so
    assert again.data_path.read_bytes() == DATA + second
    assert [r.n for r in again.receipts] == [len(DATA), len(DATA)]


def test_torn_receipt_line_is_ignored_and_trimmed(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 2 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)
    receipts = upload.directory / store.RECEIPTS_NAME
    good = receipts.read_bytes()
    receipts.write_bytes(good + b'{"o": 3072, "n": 30')  # torn append

    again = reload_upload(restart(service, root), root, upload.upload_id)

    assert again.offset == len(DATA)
    assert receipts.read_bytes() == good  # trimmed so appends continue cleanly


def test_a_receipt_that_does_not_continue_the_checkpoint_stops_the_replay(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 4 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)
    receipts = upload.directory / store.RECEIPTS_NAME
    forged = store.ChunkReceipt(o=999, n=10, h="0" * 64, t=1.0)
    receipts.write_bytes(receipts.read_bytes() + (forged.model_dump_json() + "\n").encode())

    again = reload_upload(restart(service, root), root, upload.upload_id)
    assert again.offset == len(DATA)


def test_data_shorter_than_its_checkpoint_marks_the_upload_damaged(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 2 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)
    upload.data_path.write_bytes(DATA[:100])  # bytes the checkpoint promised are gone

    reborn = restart(service, root)
    again = reload_upload(reborn, root, upload.upload_id)

    assert again.damaged
    assert reborn.status(root, again)["state"] == "failed"
    assert reborn.status(root, again)["error_code"] == "damaged"
    with pytest.raises(UploadRejected) as exc:
        reborn.begin_chunk(root, again, offset=len(DATA), content_length=1, checksum_header=chunk_checksum(b"x"))
    assert (exc.value.status, exc.value.code) == (409, "damaged")


def test_checksum_mismatch_leaves_the_offset_and_bytes_unchanged(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 2 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)
    before = upload.data_path.read_bytes()

    writer = service.begin_chunk(
        root, upload, offset=len(DATA), content_length=len(DATA), checksum_header=chunk_checksum(b"other")
    )
    writer.write(DATA)
    with pytest.raises(UploadRejected) as exc:
        writer.commit()

    assert (exc.value.status, exc.value.code) == (460, "checksum_mismatch")
    assert upload.offset == len(DATA)
    assert upload.data_path.read_bytes() == before
    assert len(upload.receipts) == 1
    assert upload.lock.acquire(blocking=False)  # the lock was released
    upload.lock.release()


class FullDisk:
    """A file object that runs out of space after ``allow`` bytes."""

    def __init__(self, real, allow):
        self.real, self.allow, self.seen = real, allow, 0

    def write(self, data):
        if self.seen + len(data) > self.allow:
            raise OSError(errno.ENOSPC, "No space left on device")
        self.seen += len(data)
        return self.real.write(data)

    def __getattr__(self, name):
        return getattr(self.real, name)


def test_enospc_mid_chunk_returns_507_and_leaves_a_valid_checkpoint(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 3 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)

    writer = service.begin_chunk(
        root, upload, offset=len(DATA), content_length=len(DATA), checksum_header=chunk_checksum(DATA)
    )
    writer._handle = FullDisk(writer._handle, allow=len(DATA) // 2)
    writer.write(DATA[: len(DATA) // 2])
    with pytest.raises(UploadRejected) as exc:
        writer.write(DATA[len(DATA) // 2 :])

    assert (exc.value.status, exc.value.code) == (507, "insufficient_storage")
    assert upload.offset == len(DATA)
    assert upload.data_path.read_bytes() == DATA  # truncated back to the checkpoint
    reborn = restart(service, root)
    again = reload_upload(reborn, root, upload.upload_id)
    assert again.offset == len(DATA) and not again.damaged
    send_chunk(reborn, root, again, again.offset, DATA)  # space came back: carry on
    assert again.offset == 2 * len(DATA)


def test_enospc_while_writing_the_receipt_keeps_the_previous_checkpoint(tmp_path, monkeypatch):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 2 * len(DATA))
    send_chunk(service, root, upload, 0, DATA)

    def full(*_a, **_k):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(store, "append_receipt", full)
    with pytest.raises(UploadRejected) as exc:
        send_chunk(service, root, upload, len(DATA), DATA)
    assert exc.value.status == 507
    monkeypatch.undo()
    assert upload.offset == len(DATA)
    assert upload.data_path.read_bytes() == DATA
    send_chunk(service, root, upload, len(DATA), DATA)
    assert upload.record.state == "received"


def test_offset_and_size_rules(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, len(DATA))

    for offset, size, code, status in [
        (5, 10, "offset_mismatch", 409),
        (0, len(DATA) + 1, "exceeds_length", 413),
        (0, CHUNK_CEILING + 1, "chunk_too_large", 413),
    ]:
        with pytest.raises(UploadRejected) as exc:
            service.begin_chunk(root, upload, offset=offset, content_length=size,
                                checksum_header=chunk_checksum(b"x"))
        assert (exc.value.status, exc.value.code) == (status, code)
        assert upload.lock.acquire(blocking=False)  # never left locked by a refusal
        upload.lock.release()

    writer = service.begin_chunk(root, upload, offset=0, content_length=10,
                                 checksum_header=chunk_checksum(b"x" * 10))
    with pytest.raises(UploadRejected) as too_much:
        writer.write(b"x" * 11)  # more bytes than declared
    assert too_much.value.status == 413
    assert upload.offset == 0 and upload.data_path.read_bytes() == b""


def test_completing_the_last_chunk_moves_to_received_durably(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 2 * len(DATA))
    send_chunk(service, root, upload, 0, DATA, pieces=3)
    assert upload.record.state == "receiving"
    send_chunk(service, root, upload, len(DATA), DATA, pieces=7)
    assert upload.record.state == "received"
    again = reload_upload(restart(service, root), root, upload.upload_id)
    assert (again.record.state, again.offset) == ("received", 2 * len(DATA))


# --- limits ------------------------------------------------------------------------------


def test_limits_on_size_unfinished_uploads_and_idempotency(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    with pytest.raises(UploadRejected) as too_big:
        create(service, root, 51 * GIB)
    assert too_big.value.status == 413
    for bad in ("0", "-1", "abc", None):
        with pytest.raises(UploadRejected):
            service.create(root, device_id="dev1", device_label="x", owner_login=OWNER,
                           upload_length=bad, metadata_header=tus_metadata(), idempotency_key="key-00000001")
    for key in (None, "", "short", "has spaces in it", "x" * 200):
        with pytest.raises(UploadRejected):
            service.create(root, device_id="dev1", device_label="x", owner_login=OWNER,
                           upload_length="5", metadata_header=tus_metadata(), idempotency_key=key)

    for n in range(MAX_UNFINISHED_PER_DEVICE):
        create(service, root, 10, key=f"key-{n:08d}")
    with pytest.raises(UploadRejected) as many:
        create(service, root, 10, key="key-99999999")
    assert (many.value.status, many.value.code) == (429, "too_many_uploads")
    create(service, root, 10, device="dev2", key="key-99999999")  # another phone is unaffected


def test_creation_is_idempotent_per_device_and_key(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    first, replay1 = create(service, root, 100, key="key-aaaaaaaa")
    second, replay2 = create(service, root, 100, key="key-aaaaaaaa")
    assert (replay1, replay2) == (False, True)
    assert second.upload_id == first.upload_id
    with pytest.raises(UploadRejected) as conflict:
        create(service, root, 200, key="key-aaaaaaaa")
    assert conflict.value.status == 409
    other_device, _ = create(service, root, 100, device="dev2", key="key-aaaaaaaa")
    assert other_device.upload_id != first.upload_id
    assert len(list(store.staging_root(root).iterdir())) == 2


def test_active_transfers_are_limited_per_device_and_per_mac(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    a1, _ = create(service, root, 100, device="devA", key="key-00000001")
    a2, _ = create(service, root, 100, device="devA", key="key-00000002")
    b1, _ = create(service, root, 100, device="devB", key="key-00000003")
    c1, _ = create(service, root, 100, device="devC", key="key-00000004")
    cs = chunk_checksum(b"x")

    w1 = service.begin_chunk(root, a1, offset=0, content_length=1, checksum_header=cs)
    with pytest.raises(UploadRejected) as per_device:
        service.begin_chunk(root, a2, offset=0, content_length=1, checksum_header=cs)
    assert (per_device.value.status, per_device.value.code) == (423, "busy")
    with pytest.raises(UploadRejected) as same_upload:
        service.begin_chunk(root, a1, offset=0, content_length=1, checksum_header=cs)
    assert same_upload.value.status == 423

    w2 = service.begin_chunk(root, b1, offset=0, content_length=1, checksum_header=cs)
    with pytest.raises(UploadRejected) as per_mac:
        service.begin_chunk(root, c1, offset=0, content_length=1, checksum_header=cs)
    assert per_mac.value.status == 423

    w1.abort()
    w3 = service.begin_chunk(root, c1, offset=0, content_length=1, checksum_header=cs)
    w2.abort()
    w3.abort()
    assert service._active_total == 0


def test_free_space_floor_and_reservation_ledger(tmp_path):
    state = {"total": 1000 * GIB, "free": 120 * GIB}
    ledger = ReservationLedger(lambda _p: (state["total"], 0, state["free"]))
    service = service_for(ledger=ledger)
    root = make_root(tmp_path)

    # 10% of 1000 GiB = 100 GiB must stay free: only 20 GiB of room.
    create(service, root, 15 * GIB, key="key-00000001")
    assert ledger.total() == 15 * GIB
    with pytest.raises(UploadRejected) as full:
        create(service, root, 10 * GIB, key="key-00000002")  # 15 reserved + 10 > 20
    assert (full.value.status, full.value.code) == (507, "insufficient_storage")
    create(service, root, 4 * GIB, key="key-00000003")

    small = ReservationLedger(lambda _p: (20 * GIB, 0, 8 * GIB))  # floor is 5 GiB
    s2 = service_for(ledger=small)
    create(s2, make_root(tmp_path, "p2"), 2 * GIB)
    with pytest.raises(UploadRejected):
        create(s2, make_root(tmp_path, "p3"), 2 * GIB, key="key-00000009")


def test_cross_project_admission_reserves_capacity_atomically(tmp_path, monkeypatch):
    ledger = ReservationLedger(lambda _path: (20 * GIB, 0, 7 * GIB))
    service = service_for(ledger=ledger)
    roots = [make_root(tmp_path, "p1"), make_root(tmp_path, "p2")]
    for root in roots:
        service.folder(root)
    first_staging = threading.Event()
    second_done = threading.Event()
    outcomes = []
    new_directory = store.new_upload_directory
    write_record = store.write_record

    def pause_first_staging(root, upload_id):
        if root == roots[0]:
            first_staging.set()
            assert second_done.wait(5)
        return new_directory(root, upload_id)

    def fail_first_record(directory, record):
        if directory.is_relative_to(roots[0]):
            raise OSError(errno.EIO, "first Project staging failed")
        return write_record(directory, record)

    monkeypatch.setattr(store, "new_upload_directory", pause_first_staging)
    monkeypatch.setattr(store, "write_record", fail_first_record)

    def admit_first():
        try:
            create(service, roots[0], 2 * GIB, key="key-00000000")
        except UploadRejected as exc:
            outcomes.append(("first", exc.status, exc.code))

    def admit_second():
        try:
            assert first_staging.wait(5)
            try:
                upload, _ = create(service, roots[1], 2 * GIB, key="key-00000001")
                outcomes.append(("second-created", upload.upload_id))
            except UploadRejected as exc:
                outcomes.append(("second", exc.status, exc.code))
        finally:
            second_done.set()

    threads = [threading.Thread(target=admit_first), threading.Thread(target=admit_second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert all(not thread.is_alive() for thread in threads)
    assert outcomes == [
        ("second", 507, "insufficient_storage"),
        ("first", 500, "storage_error"),
    ]
    assert ledger.total() == 0
    create(service, roots[1], 2 * GIB, key="key-00000002")


@pytest.mark.parametrize("check", ["reserve", "chunk"])
def test_reservation_admission_samples_disk_while_reduction_is_serialized(check):
    free = {"bytes": 7 * GIB}
    sampled = threading.Event()
    reduce = threading.Event()
    reduced = threading.Event()
    ledger = None

    def disk_usage(_path):
        # A chunk completing after this sample can consume those bytes while
        # reducing its reservation. Sampling must share the ledger lock.
        sampled_free = free["bytes"]
        sampled.set()
        if not ledger._lock.locked():
            assert reduced.wait(5)
        return (20 * GIB, 13 * GIB, sampled_free)

    ledger = ReservationLedger(disk_usage)
    ledger.set("completing-upload", 2 * GIB)

    def complete_chunk():
        assert sampled.wait(5)
        free["bytes"] = 5 * GIB
        reduce.set()
        ledger.set("completing-upload", 0)
        reduced.set()

    completion = threading.Thread(target=complete_chunk)
    completion.start()
    admitted = (ledger.reserve_if_fits("project", "new-upload", 2 * GIB)
                if check == "reserve" else ledger.can_fit("project", 2 * GIB))
    assert reduce.wait(5)
    assert reduced.wait(5)
    completion.join(timeout=5)
    assert not completion.is_alive()
    assert admitted is False
    assert ledger.reserved("new-upload") == 0


def test_external_free_space_loss_rejects_chunk_before_checkpoint(tmp_path):
    state = {"free": 15 * GIB}
    ledger = ReservationLedger(lambda _p: (100 * GIB, 0, state["free"]))
    service = service_for(ledger=ledger)
    root = make_root(tmp_path)
    upload, _ = create(service, root, 2 * GIB)
    state["free"] = 11 * GIB

    with pytest.raises(UploadRejected) as error:
        service.begin_chunk(root, upload, offset=0, content_length=1,
                            checksum_header=chunk_checksum(b"x"))
    assert (error.value.status, error.value.code) == (507, "insufficient_storage")
    assert upload.offset == 0
    assert upload.data_path.stat().st_size == 0


def test_unfinished_upload_quota_is_shared_across_project_folders(tmp_path):
    service = service_for()
    roots = [make_root(tmp_path, "quota-a"), make_root(tmp_path, "quota-b")]
    uploads = []
    for index in range(MAX_UNFINISHED_PER_DEVICE):
        upload, _ = create(service, roots[index % len(roots)], 100, key=f"key-{index:08d}")
        uploads.append((roots[index % len(roots)], upload))

    replay, replayed = create(service, roots[0], 100, key="key-00000000")
    assert replayed and replay.upload_id == uploads[0][1].upload_id

    with pytest.raises(UploadRejected) as error:
        create(service, roots[0], 100, key="key-99999999")
    assert (error.value.status, error.value.code) == (429, "too_many_uploads")

    service.terminate(*uploads[0])
    create(service, roots[0], 100, key="key-99999999")


def test_admission_serializes_folder_loading_and_releases_reservation_on_failure(tmp_path):
    clock = Clock()
    service = service_for(
        clock=clock, ledger=ReservationLedger(lambda _path: (20 * GIB, 0, 20 * GIB))
    )
    first_root = make_root(tmp_path, "loading-a")
    second_root = make_root(tmp_path, "loading-b")
    third_root = make_root(tmp_path, "loading-c")
    service.folder(first_root)
    service.folder(second_root)
    expiring, _ = create(service, second_root, 100, device="other-device", key="key-87654321")
    service.terminate(second_root, expiring)
    clock.advance(TOMBSTONE_TTL_SEC + 1)
    scan_started = threading.Event()
    mutation_attempted = threading.Event()

    class PausingRegistry(dict):
        def values(self):
            iterator = iter(super().values())
            scan_started.set()
            yield next(iterator)
            # Existing folder loading mutates this live registry under a
            # different lock. Give that mutation a chance to occur mid-scan;
            # on serialized admission it waits until this snapshot completes.
            mutation_attempted.wait(1)
            yield from iterator

        def __setitem__(self, key, value):
            mutation_attempted.set()
            return super().__setitem__(key, value)

    service._folders = PausingRegistry(service._folders)
    outcomes = []

    def admit():
        try:
            upload, _ = create(service, first_root, 100, key="key-12345678")
            outcomes.append(("created", upload.upload_id))
        except Exception as exc:
            outcomes.append(("error", type(exc).__name__, str(exc)))

    def load_and_sweep():
        try:
            assert scan_started.wait(5)
            service.folder(third_root)
            service.sweep(third_root)
            outcomes.append(("loaded", str(third_root)))
        except Exception as exc:
            outcomes.append(("load-error", type(exc).__name__))

    def sweep():
        try:
            assert scan_started.wait(5)
            service.sweep(second_root)
            outcomes.append(("swept", str(second_root)))
        except Exception as exc:
            outcomes.append(("sweep-error", type(exc).__name__))

    threads = [
        threading.Thread(target=admit),
        threading.Thread(target=load_and_sweep),
        threading.Thread(target=sweep),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert all(not thread.is_alive() for thread in threads)
    assert sorted(outcome[0] for outcome in outcomes) == ["created", "loaded", "swept"], outcomes
    assert service.ledger.total() == 100
    assert expiring.upload_id not in service.folder(second_root).uploads


def test_ledger_tracks_remaining_bytes_and_releases_on_completion_and_cancel(tmp_path):
    ledger = ReservationLedger(lambda _p: (10**15, 0, 10**15))
    service = service_for(ledger=ledger)
    root = make_root(tmp_path)
    upload, _ = create(service, root, 3 * len(DATA))
    assert ledger.reserved(upload.upload_id) == 3 * len(DATA)
    send_chunk(service, root, upload, 0, DATA)
    assert ledger.reserved(upload.upload_id) == 2 * len(DATA)
    send_chunk(service, root, upload, len(DATA), DATA)
    send_chunk(service, root, upload, 2 * len(DATA), DATA)
    assert ledger.reserved(upload.upload_id) == 0

    other, _ = create(service, root, 500, key="key-00000002")
    assert ledger.reserved(other.upload_id) == 500
    service.terminate(root, other)
    assert ledger.total() == 0


# --- staging safety ------------------------------------------------------------------------


def test_staging_that_is_a_symlink_out_of_the_project_is_refused(tmp_path):
    root = make_root(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    cache = root / "clipassembler" / "cache"
    cache.mkdir()
    (cache / "uploads").symlink_to(outside, target_is_directory=True)
    service = service_for()

    with pytest.raises(UploadRejected) as exc:
        create(service, root, 100)
    assert (exc.value.status, exc.value.code) == (500, "staging_unsafe")
    assert list(outside.iterdir()) == []


def test_upload_ids_cannot_name_other_directories(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    create(service, root, 100)
    for bad in ("..", "../..", "../../etc", "a" * 32 + "/..", "", "ZZZ", "%2e%2e"):
        with pytest.raises(UploadRejected) as exc:
            service.get(root, bad, "dev1")
        assert exc.value.status == 404
        assert store.upload_directory(root, bad) is None


def test_a_symlinked_upload_directory_is_not_loaded(tmp_path):
    root = make_root(tmp_path)
    service = service_for()
    upload, _ = create(service, root, 100)
    fake = store.staging_root(root) / ("e" * 32)
    fake.symlink_to(upload.directory, target_is_directory=True)
    reborn = restart(service, root)
    assert set(reborn.folder(root).uploads) == {upload.upload_id}


# --- expiry and cancellation -------------------------------------------------------------------


def test_expiry_removes_only_app_owned_paths_and_leaves_a_tombstone(tmp_path):
    clock = Clock()
    ledger = ReservationLedger(lambda _p: (10**15, 0, 10**15))
    service = service_for(clock=clock, ledger=ledger)
    root = make_root(tmp_path)
    footage = root / "IMG_9.MOV"
    footage.write_bytes(b"precious")
    decoy = tmp_path / "decoy.txt"
    decoy.write_text("keep me")
    active, _ = create(service, root, 2 * len(DATA), key="key-00000001")
    send_chunk(service, root, active, 0, DATA)
    stale, _ = create(service, root, 2 * len(DATA), key="key-00000002")
    send_chunk(service, root, stale, 0, DATA)
    # a hostile symlink where data.part should be: expiry must unlink it, not follow it
    os.unlink(stale.data_path)
    stale.data_path.symlink_to(decoy)
    clock.advance(UPLOAD_TTL_SEC - 10)
    send_chunk(service, root, active, len(DATA), DATA)  # recent progress keeps `active` alive
    clock.advance(20)

    service.sweep(root)

    assert stale.record.state == "expired"
    assert not stale.data_path.exists() and not stale.data_path.is_symlink()
    assert (stale.directory / store.RECORD_NAME).exists()  # the tombstone
    assert decoy.read_text() == "keep me"
    assert footage.read_bytes() == b"precious"
    assert active.record.state == "received"
    assert ledger.reserved(stale.upload_id) == 0
    with pytest.raises(UploadRejected) as gone:
        service.get(root, stale.upload_id, "dev1")
    assert gone.value.status == 410

    clock.advance(TOMBSTONE_TTL_SEC + 1)
    service.sweep(root)
    assert not stale.directory.exists()
    with pytest.raises(UploadRejected) as missing:
        service.get(root, stale.upload_id, "dev1")
    assert missing.value.status == 404


def test_sweep_all_expires_stale_uploads_in_every_loaded_project(tmp_path):
    clock = Clock()
    service = service_for(clock=clock)
    roots = [make_root(tmp_path, "p1"), make_root(tmp_path, "p2")]
    uploads = [create(service, root, 100)[0] for root in roots]
    clock.advance(UPLOAD_TTL_SEC + 1)
    service.sweep_all()
    assert [u.record.state for u in uploads] == ["expired", "expired"]


def test_expiry_skips_uploads_being_verified_or_published(tmp_path):
    clock = Clock()
    service = service_for(clock=clock)
    root = make_root(tmp_path)
    upload, _ = create(service, root, len(DATA))
    send_chunk(service, root, upload, 0, DATA)
    upload.record = upload.record.model_copy(update={"state": "publishing"})
    clock.advance(UPLOAD_TTL_SEC * 5)
    service.sweep(root)
    assert upload.record.state == "publishing" and upload.data_path.exists()


def test_cancel_waits_for_an_in_flight_chunk_then_cleans_up(tmp_path):
    ledger = ReservationLedger(lambda _p: (10**15, 0, 10**15))
    service = service_for(ledger=ledger)
    root = make_root(tmp_path)
    upload, _ = create(service, root, 2 * len(DATA))
    writer = service.begin_chunk(root, upload, offset=0, content_length=len(DATA),
                                 checksum_header=chunk_checksum(DATA))
    writer.write(DATA)

    service.on_device_ended("dev1")  # revoked mid-chunk
    assert upload.record.state == "receiving"  # not torn down under the writer
    with pytest.raises(UploadRejected) as exc:
        writer.commit()  # the chunk is not acknowledged
    assert exc.value.status == 410

    assert upload.record.state == "cancelled"
    assert not upload.data_path.exists()
    assert ledger.total() == 0


# --- HTTP: the wire contract ----------------------------------------------------------------------


@pytest.fixture
def world(tmp_path):
    clock = Clock()
    ledger = ReservationLedger(lambda _p: (10**15, 0, 10**15))
    service = UploadService(clock=clock, ledger=ledger)
    harness = RemoteHarness(tmp_path / "state", clock=clock, uploads=service)
    project_uuid, folder, _ = harness.make_project(tmp_path)
    phone = harness.paired_phone()
    yield type("World", (), {
        "h": harness, "service": service, "ledger": ledger, "phone": phone,
        "project": project_uuid, "folder": folder, "tus": Tus(phone, project_uuid), "clock": clock,
    })
    harness.close()


def test_options_advertises_the_supported_tus_features(world):
    response = world.phone.request("OPTIONS", f"{world.tus.base}/uploads")
    assert response.status_code == 204
    assert response.headers["tus-version"] == "1.0.0"
    assert response.headers["tus-extension"] == "creation,checksum,expiration,termination"
    assert response.headers["tus-checksum-algorithm"] == "sha1,sha256"
    assert response.headers["tus-max-size"] == str(50 * GIB)


def test_create_head_patch_complete_over_http(world):
    tus = world.tus
    created = tus.create(2 * len(DATA))
    assert created.status_code == 201
    location = created.headers["location"]
    upload_id = tus.upload_id(created)
    # Public URLs use the /remote mount, never the per-enable ingress capability.
    assert location == f"/remote/api/projects/{world.project}/uploads/{upload_id}"
    assert world.h.runtime.ingress not in str(created.headers)
    assert "upload-expires" in created.headers

    head = tus.head(upload_id)
    assert head.status_code == 200 and head.content == b""
    assert head.headers["upload-offset"] == "0"
    assert head.headers["upload-length"] == str(2 * len(DATA))
    assert head.headers["cache-control"] == "private, no-store"
    assert head.headers["tus-resumable"] == "1.0.0"

    first = tus.patch(upload_id, 0, DATA)
    assert first.status_code == 204 and first.headers["upload-offset"] == str(len(DATA))
    assert tus.head(upload_id).headers["upload-offset"] == str(len(DATA))
    second = tus.patch(upload_id, len(DATA), DATA, checksum=chunk_checksum(DATA, "sha1"))
    assert second.status_code == 204 and second.headers["upload-offset"] == str(2 * len(DATA))

    status = tus.status(upload_id, chunks=True).json()
    assert status["state"] == "received" and status["offset"] == status["length"]
    assert [c["sha256"] for c in status["chunks"]] == [hashlib.sha256(DATA).hexdigest()] * 2
    assert "chunks" not in tus.status(upload_id).json()
    staged = Path(world.folder) / "clipassembler" / "cache" / "uploads" / upload_id / "data.part"
    assert staged.read_bytes() == DATA * 2


def test_lost_creation_response_retried_with_the_same_key_returns_the_same_upload(world):
    tus = world.tus
    first = tus.create(1000, key="retry-key-1")
    again = tus.create(1000, key="retry-key-1")
    assert tus.upload_id(first) == tus.upload_id(again)
    assert again.headers["idempotent-replay"] == "true"
    conflict = tus.create(2000, key="retry-key-1")
    assert conflict.status_code == 409 and conflict.json()["reason"] == "idempotency_conflict"


def test_http_errors_follow_the_tus_contract(world):
    tus, phone = world.tus, world.phone
    upload_id = tus.upload_id(tus.create(2 * len(DATA)))

    missing_version = phone.request("HEAD", f"{tus.base}/uploads/{upload_id}")
    assert missing_version.status_code == 412 and missing_version.headers["tus-version"] == "1.0.0"
    assert tus.patch(upload_id, 0, DATA, content_type="application/json").status_code == 415
    assert tus.patch(upload_id, 5, DATA).status_code == 409  # offset mismatch
    assert tus.head(upload_id).headers["upload-offset"] == "0"  # unchanged
    assert tus.patch(upload_id, 0, DATA * 3).status_code == 413  # past the declared length
    bad = tus.patch(upload_id, 0, DATA, checksum=chunk_checksum(b"different"))
    assert bad.status_code == 460 and bad.json()["reason"] == "checksum_mismatch"
    assert tus.head(upload_id).headers["upload-offset"] == "0"
    no_checksum = phone.request(
        "PATCH", f"{tus.base}/uploads/{upload_id}", content=DATA,
        extra={"Tus-Resumable": "1.0.0", "Upload-Offset": "0",
               "Content-Type": "application/offset+octet-stream"},
    )
    assert no_checksum.status_code == 400 and no_checksum.json()["reason"] == "checksum_required"
    assert tus.patch(upload_id, 0, DATA).status_code == 204  # and it still works afterwards


def test_creation_validation_over_http(world):
    tus = world.tus
    assert tus.create(100, filename="movie.mkv").status_code == 415
    assert tus.create(100, filename="../../x.mov", key="key-00000002").status_code == 201
    too_big = tus.create(51 * GIB, key="key-00000003")
    assert too_big.status_code == 413 and too_big.json()["reason"] == "too_large"
    no_key = world.phone.post(f"{tus.base}/uploads",
                              extra={"Tus-Resumable": "1.0.0", "Upload-Length": "5",
                                     "Upload-Metadata": tus_metadata()})
    assert no_key.status_code == 400
    wrong_version = world.phone.post(f"{tus.base}/uploads", extra={"Upload-Length": "5"})
    assert wrong_version.status_code == 412


def test_stored_filename_is_the_sanitized_one_and_never_a_path(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(100, filename="../../etc/passwd.mov"))
    assert tus.status(upload_id).json()["filename"] == "etcpasswd.mov"
    # nothing was created outside the app's staging directory
    assert not (world.folder.parent / "etc").exists()
    assert not (world.folder / "etcpasswd.mov").exists()


def test_another_paired_device_gets_404_for_a_known_upload_id(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(2 * len(DATA)))
    assert tus.patch(upload_id, 0, DATA).status_code == 204

    intruder = world.h.paired_phone("iPad")
    other = Tus(intruder, world.project)
    for response in (
        other.head(upload_id),
        other.patch(upload_id, len(DATA), DATA),
        other.delete(upload_id),
        other.status(upload_id),
    ):
        assert response.status_code == 404, response.request.method
    unknown = other.head("f" * 32)
    assert unknown.status_code == 404  # indistinguishable from a made-up ID
    assert tus.head(upload_id).headers["upload-offset"] == str(len(DATA))  # untouched


def test_upload_routes_need_an_exposed_project_and_a_session(world, tmp_path):
    hidden_uuid, _, _ = world.h.make_project(tmp_path, "hidden", shown=False)
    assert Tus(world.phone, hidden_uuid).create(10).status_code == 404
    anonymous = Tus(world.h.phone(), world.project)
    assert anonymous.create(10).status_code == 401
    no_csrf = world.phone.post(
        f"{world.tus.base}/uploads",
        extra={"Tus-Resumable": "1.0.0", "Upload-Length": "5", "Upload-Metadata": tus_metadata(),
               "Idempotency-Key": "key-00000009", "X-CSRF-Token": "wrong"},
    )
    assert no_csrf.status_code == 403
    wrong_origin = world.phone.post(
        f"{world.tus.base}/uploads", origin="https://evil.example",
        extra={"Tus-Resumable": "1.0.0", "Upload-Length": "5", "Upload-Metadata": tus_metadata(),
               "Idempotency-Key": "key-00000009"},
    )
    assert wrong_origin.status_code == 403


def test_delete_terminates_the_transfer_and_later_requests_are_gone(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(2 * len(DATA)))
    tus.patch(upload_id, 0, DATA)
    assert tus.delete(upload_id).status_code == 204
    assert tus.delete(upload_id).status_code == 204  # idempotent
    assert tus.head(upload_id).status_code == 410
    assert tus.patch(upload_id, len(DATA), DATA).status_code == 410
    status = tus.status(upload_id)
    assert status.status_code == 200 and status.json()["state"] == "cancelled"
    assert world.ledger.total() == 0
    staging = Path(world.folder) / "clipassembler" / "cache" / "uploads" / upload_id
    assert not (staging / "data.part").exists()


def test_patch_bodies_over_the_ceiling_are_refused_before_reading(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(20 * MIB))
    big = b"\0" * (CHUNK_CEILING + 1)
    response = tus.patch(upload_id, 0, big)
    assert response.status_code in (413,)
    assert tus.head(upload_id).headers["upload-offset"] == "0"


def test_revoke_releases_reservations_and_stops_the_uploads(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(3 * len(DATA)))
    tus.patch(upload_id, 0, DATA)
    assert world.ledger.total() == 2 * len(DATA)

    device_id = world.h.auth.list_devices()[0]["device_id"]
    world.h.auth.revoke(device_id)

    assert world.ledger.total() == 0
    upload = world.service.folder(world.folder).uploads[upload_id]
    assert upload.record.state == "cancelled"
    after = tus.patch(upload_id, len(DATA), DATA)
    assert after.status_code == 401 and after.json()["reason"] == "revoked"
    # a re-paired phone is a different device and cannot adopt the old upload
    again = world.h.paired_phone("iPhone again")
    assert Tus(again, world.project).head(upload_id).status_code == 404


def test_http_enospc_is_507_and_the_checkpoint_stays_valid(world, monkeypatch):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(2 * len(DATA)))
    assert tus.patch(upload_id, 0, DATA).status_code == 204

    def full(*_a, **_k):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(store, "append_receipt", full)
    response = tus.patch(upload_id, len(DATA), DATA)
    assert response.status_code == 507 and response.json()["reason"] == "insufficient_storage"
    monkeypatch.undo()
    assert tus.head(upload_id).headers["upload-offset"] == str(len(DATA))
    assert tus.patch(upload_id, len(DATA), DATA).status_code == 204


def test_disabling_remote_view_stops_an_in_flight_transfer_without_acknowledging_it(world):
    tus = world.tus
    upload_id = tus.upload_id(tus.create(2 * len(DATA)))
    upload = world.service.folder(world.folder).uploads[upload_id]
    writer = world.service.begin_chunk(
        world.folder, upload, offset=0, content_length=len(DATA), checksum_header=chunk_checksum(DATA)
    )
    writer.write(DATA[:100])
    world.h.runtime.close_lease()
    writer.abort()  # what the route does when its stream handle closes
    assert upload.offset == 0 and upload.data_path.read_bytes() == b""


def test_sweep_rechecks_verification_after_taking_upload_lock(tmp_path):
    now = [0.0]
    service = service_for(clock=lambda: now[0])
    root = make_root(tmp_path)
    upload, _ = create(service, root, 100)
    now[0] = UPLOAD_TTL_SEC + 1
    original_lock = upload.lock

    class FinalizerWinsLock:
        def acquire(self, blocking=True):
            acquired = original_lock.acquire(blocking=blocking)
            if acquired:
                upload.record = upload.record.model_copy(update={"state": "verifying"})
            return acquired

        def release(self):
            original_lock.release()

    upload.lock = FinalizerWinsLock()
    service.sweep(root)
    assert upload.record.state == "verifying"
    assert upload.data_path.exists()
    assert service.ledger.reserved(upload.upload_id) == 100
