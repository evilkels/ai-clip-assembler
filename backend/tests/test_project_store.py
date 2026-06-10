from datetime import datetime, timezone

import pytest

from src.project_store import (
    InvalidProjectManifestError,
    NoSourceVideosFoundError,
    ProjectFolderNotWritableError,
    UnsafeProjectFolderError,
    create_or_open_project,
    create_project,
    delete_project_files,
    open_project,
    rescan_project,
)


def fixed_now():
    return datetime(2026, 5, 30, 19, 0, 0, tzinfo=timezone.utc)


def test_create_project_writes_manifest_with_relative_source_video_filenames(tmp_path):
    project_folder = tmp_path / "sunset-drone-footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    (project_folder / "DJI_0043.mov").write_bytes(b"video")

    project = create_project(project_folder, now=fixed_now)

    assert project.name == "sunset-drone-footage"
    assert project.harness == "pi_agent"
    assert project.created_at == "2026-05-30T19:00:00Z"
    assert [video.filename for video in project.source_videos] == [
        "DJI_0042.MP4",
        "DJI_0043.mov",
    ]
    assert project.settings_overrides == {}
    assert (project_folder / "clipassembler" / "project.json").is_file()
    assert (project_folder / "clipassembler" / "samples").is_dir()
    assert (project_folder / "clipassembler" / "analysis").is_dir()
    assert (project_folder / "clipassembler" / "cache").is_dir()
    assert (project_folder / "clipassembler" / "cache" / ".nosync").is_file()


def test_create_project_scans_only_top_level_supported_videos(tmp_path):
    project_folder = tmp_path / "footage"
    nested_folder = project_folder / "nested"
    nested_folder.mkdir(parents=True)
    (project_folder / "A.MKV").write_bytes(b"video")
    (project_folder / "notes.txt").write_text("ignore me")
    (nested_folder / "B.MP4").write_bytes(b"nested video")

    project = create_project(project_folder, now=fixed_now)

    assert [video.filename for video in project.source_videos] == ["A.MKV"]


def test_create_project_with_no_videos_does_not_mutate_folder(tmp_path):
    project_folder = tmp_path / "empty"
    project_folder.mkdir()

    with pytest.raises(NoSourceVideosFoundError):
        create_project(project_folder, now=fixed_now)

    assert not (project_folder / "clipassembler").exists()


def test_create_or_open_project_opens_existing_manifest_without_overwriting(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    original = create_project(project_folder, now=fixed_now)
    (project_folder / "DJI_0043.MP4").write_bytes(b"video")

    reopened = create_or_open_project(
        project_folder,
        now=lambda: datetime(2027, 1, 1, tzinfo=timezone.utc),
    )

    assert reopened == original


def test_open_project_loads_existing_manifest(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    created = create_project(project_folder, now=fixed_now)

    opened = open_project(project_folder)

    assert opened == created


def test_create_project_rejects_folder_without_write_permission(monkeypatch, tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    monkeypatch.setattr("src.project_store.has_write_permission", lambda path: False)

    with pytest.raises(ProjectFolderNotWritableError):
        create_project(project_folder, now=fixed_now)

    assert not (project_folder / "clipassembler").exists()


def test_create_project_rejects_unsafe_system_folder(monkeypatch, tmp_path):
    project_folder = tmp_path / "System"
    project_folder.mkdir()
    monkeypatch.setattr("src.project_store.UNSAFE_PROJECT_ROOTS", [project_folder])

    with pytest.raises(UnsafeProjectFolderError):
        create_project(project_folder, now=fixed_now)


def test_rescan_project_adds_new_top_level_videos_without_duplicates(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    create_project(project_folder, now=fixed_now)
    (project_folder / "DJI_0043.MP4").write_bytes(b"video")
    (project_folder / "notes.txt").write_text("ignore")

    project = rescan_project(project_folder, now=lambda: datetime(2026, 5, 31, 8, 0, 0, tzinfo=timezone.utc))

    assert [video.filename for video in project.source_videos] == [
        "DJI_0042.MP4",
        "DJI_0043.MP4",
    ]
    assert project.source_videos[0].imported_at == "2026-05-30T19:00:00Z"
    assert project.source_videos[1].imported_at == "2026-05-31T08:00:00Z"


def test_delete_project_files_removes_only_app_owned_folders(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    source_video = project_folder / "DJI_0042.MP4"
    source_video.write_bytes(b"video")
    create_project(project_folder, now=fixed_now)
    exports_dir = project_folder / "exports"
    exports_dir.mkdir()
    (exports_dir / "timeline.edl").write_text("export", encoding="utf-8")

    deleted = delete_project_files(project_folder)

    assert set(deleted) == {"clipassembler", "exports"}
    assert source_video.read_bytes() == b"video"
    assert not (project_folder / "clipassembler").exists()
    assert not exports_dir.exists()


def test_open_project_rejects_unsupported_schema_version(tmp_path):
    project_folder = tmp_path / "footage"
    manifest_folder = project_folder / "clipassembler"
    manifest_folder.mkdir(parents=True)
    (manifest_folder / "project.json").write_text(
        """
        {
          "schema_version": 2,
          "name": "footage",
          "created_at": "2026-05-30T19:00:00Z",
          "harness": "pi_agent",
          "source_videos": [
            {"filename": "DJI_0042.MP4", "imported_at": "2026-05-30T19:00:00Z"}
          ],
          "settings_overrides": {}
        }
        """,
        encoding="utf-8",
    )

    with pytest.raises(InvalidProjectManifestError):
        open_project(project_folder)


def test_open_project_rejects_absolute_source_video_filename(tmp_path):
    project_folder = tmp_path / "footage"
    manifest_folder = project_folder / "clipassembler"
    manifest_folder.mkdir(parents=True)
    (manifest_folder / "project.json").write_text(
        """
        {
          "schema_version": 1,
          "name": "footage",
          "created_at": "2026-05-30T19:00:00Z",
          "harness": "pi_agent",
          "source_videos": [
            {"filename": "/tmp/DJI_0042.MP4", "imported_at": "2026-05-30T19:00:00Z"}
          ],
          "settings_overrides": {}
        }
        """,
        encoding="utf-8",
    )

    with pytest.raises(InvalidProjectManifestError):
        open_project(project_folder)
