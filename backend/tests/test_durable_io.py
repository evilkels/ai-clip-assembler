import os
import stat

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


def test_missing_parent_raises(tmp_path):
    with pytest.raises(OSError):
        write_text_atomic(tmp_path / "nope" / "a.json", "x")
    assert os.listdir(tmp_path) == []
