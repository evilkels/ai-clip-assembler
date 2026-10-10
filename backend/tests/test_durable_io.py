import os
import stat
import errno
from types import SimpleNamespace

import pytest

from src import durable_io
from src.durable_io import write_text_atomic


def _leftovers(directory):
    return sorted(p.name for p in directory.iterdir())


def test_writes_new_and_replaces_existing(tmp_path):
    target = tmp_path / "a.json"
    write_text_atomic(target, "one")
    assert target.read_text() == "one"
    write_text_atomic(target, "two")
    assert target.read_text() == "two"
    assert _leftovers(tmp_path) == ["a.json"]


def test_mode_is_applied(tmp_path):
    target = tmp_path / "secret.json"
    write_text_atomic(target, "x", mode=0o600)
    assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_fsync_failure_keeps_previous_file_and_raises(tmp_path, monkeypatch):
    target = tmp_path / "a.json"
    target.write_bytes(b"previous")

    def boom(fd):
        raise OSError("fsync failed")

    monkeypatch.setattr(durable_io.os, "fsync", boom)
    monkeypatch.setattr(durable_io, "fcntl", None)
    with pytest.raises(OSError, match="fsync failed"):
        write_text_atomic(target, "new")
    assert target.read_bytes() == b"previous"
    assert _leftovers(tmp_path) == ["a.json"]


def test_replace_failure_keeps_previous_file_and_raises(tmp_path, monkeypatch):
    target = tmp_path / "a.json"
    target.write_bytes(b"previous")

    def boom(src, dst):
        raise OSError("replace failed")

    monkeypatch.setattr(durable_io.os, "replace", boom)
    with pytest.raises(OSError, match="replace failed"):
        write_text_atomic(target, "new")
    assert target.read_bytes() == b"previous"
    assert _leftovers(tmp_path) == ["a.json"]


def test_failure_on_new_file_leaves_nothing(tmp_path, monkeypatch):
    target = tmp_path / "fresh.json"
    monkeypatch.setattr(durable_io.os, "replace", lambda s, d: (_ for _ in ()).throw(OSError("x")))
    with pytest.raises(OSError):
        write_text_atomic(target, "new")
    assert _leftovers(tmp_path) == []


def test_directory_is_flushed_after_replace(tmp_path, monkeypatch):
    calls = []
    real = durable_io.fsync_directory
    monkeypatch.setattr(durable_io, "fsync_directory", lambda d: (calls.append(str(d)), real(d)))
    write_text_atomic(tmp_path / "a.json", "x")
    assert calls == [str(tmp_path)]


@pytest.mark.parametrize("code", [errno.EINVAL, errno.ENOTSUP, errno.EOPNOTSUPP])
def test_unsupported_directory_flush_is_ignored(tmp_path, monkeypatch, code):
    def unsupported(_fd):
        raise OSError(code, "directory flush unsupported")

    monkeypatch.setattr(durable_io, "fsync_fd", unsupported)
    durable_io.fsync_directory(tmp_path)


def test_directory_open_io_error_propagates(tmp_path, monkeypatch):
    def failed_open(*_args):
        raise OSError(errno.EIO, "directory open failed")

    monkeypatch.setattr(durable_io.os, "open", failed_open)
    with pytest.raises(OSError, match="directory open failed"):
        durable_io.fsync_directory(tmp_path)


def test_directory_flush_io_error_propagates_after_publication(tmp_path, monkeypatch):
    target = tmp_path / "a.json"
    target.write_bytes(b"previous")

    real_fsync_fd = durable_io.fsync_fd
    flushed_regular_file = False

    def failed_directory_fd(fd):
        nonlocal flushed_regular_file
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            raise OSError(errno.EIO, "directory flush failed")
        flushed_regular_file = True
        real_fsync_fd(fd)

    monkeypatch.setattr(durable_io, "fsync_fd", failed_directory_fd)
    with pytest.raises(OSError, match="directory flush failed"):
        write_text_atomic(target, "published")
    assert target.read_bytes() == b"published"
    assert _leftovers(tmp_path) == ["a.json"]
    assert flushed_regular_file


@pytest.mark.parametrize(
    ("code", "fallback"),
    [(errno.EINVAL, True), (errno.EIO, False)],
)
def test_full_fsync_only_falls_back_when_unsupported(monkeypatch, code, fallback):
    calls = []

    def full_fsync(_fd, _operation):
        raise OSError(code, "full fsync failed")

    monkeypatch.setattr(durable_io, "fcntl", SimpleNamespace(F_FULLFSYNC=99, fcntl=full_fsync))
    monkeypatch.setattr(durable_io.os, "fsync", lambda _fd: calls.append("fsync"))
    if fallback:
        durable_io.fsync_fd(5)
        assert calls == ["fsync"]
    else:
        with pytest.raises(OSError, match="full fsync failed"):
            durable_io.fsync_fd(5)
        assert calls == []


def test_missing_parent_raises(tmp_path):
    with pytest.raises(OSError):
        write_text_atomic(tmp_path / "nope" / "a.json", "x")
    assert os.listdir(tmp_path) == []
