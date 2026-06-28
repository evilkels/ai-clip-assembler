import json

from src.runtime_descriptor import (
    RuntimeDescriptor,
    read_runtime_descriptor,
    resolve_runtime_file,
    set_active_project,
    write_runtime_descriptor,
)


def test_resolve_runtime_file_prefers_explicit_path(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(tmp_path / "env.json"))
    explicit = tmp_path / "explicit.json"

    assert resolve_runtime_file(str(explicit)) == explicit


def test_resolve_runtime_file_uses_environment(tmp_path, monkeypatch):
    runtime_path = tmp_path / "runtime.json"
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(runtime_path))

    assert resolve_runtime_file() == runtime_path


def test_write_and_read_runtime_descriptor(tmp_path):
    runtime_path = tmp_path / "runtime.json"

    written = write_runtime_descriptor(
        port=8123,
        pid=456,
        active_project_id="project-1",
        path=runtime_path,
    )

    assert written.port == 8123
    assert written.pid == 456
    assert written.active_project_id == "project-1"
    payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert payload["port"] == 8123
    assert payload["pid"] == 456
    assert payload["active_project_id"] == "project-1"
    assert isinstance(payload["updated_at"], str)
    assert read_runtime_descriptor(runtime_path) == RuntimeDescriptor(**payload)


def test_read_runtime_descriptor_missing_file_returns_none(tmp_path):
    assert read_runtime_descriptor(tmp_path / "missing.json") is None


def test_set_active_project_updates_runtime_descriptor_preserving_port_and_pid(
    tmp_path, monkeypatch
):
    runtime_path = tmp_path / "runtime.json"
    monkeypatch.setenv("CLIP_ASSEMBLER_RUNTIME_FILE", str(runtime_path))
    write_runtime_descriptor(
        port=8123,
        pid=456,
        active_project_id="project-1",
        path=runtime_path,
    )

    updated = set_active_project("project-2")

    assert updated.port == 8123
    assert updated.pid == 456
    assert updated.active_project_id == "project-2"
    payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    assert payload["port"] == 8123
    assert payload["pid"] == 456
    assert payload["active_project_id"] == "project-2"
