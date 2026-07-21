import json
from datetime import datetime, timezone

import pytest

from src.models import Proposal, ReviewMessage, ReviewSession, Transform, TimelineDocument, TimelineItem
from src.project_store import (
    FRAME_SCORES_SCHEMA_VERSION,
    InvalidProjectManifestError,
    NoSourceVideosFoundError,
    ProjectFolderNotWritableError,
    UnsafeProjectFolderError,
    create_or_open_project,
    create_project,
    delete_project_files,
    frame_scores_path,
    load_timeline_document,
    migrate_legacy_timeline,
    open_project,
    read_frame_scores,
    read_review_session,
    read_timeline_document,
    review_session_path,
    rescan_project,
    timeline_document_path,
    write_frame_scores,
    write_timeline_document,
    write_review_session,
)
from src.timeline_ops import SourceClip


def fixed_now():
    return datetime(2026, 5, 30, 19, 0, 0, tzinfo=timezone.utc)


def test_review_session_round_trips_messages_and_proposal(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    session = ReviewSession(
        session_id="session-1",
        updated_at="2026-05-30T19:00:00Z",
        messages=[
            ReviewMessage(
                message_id="message-1",
                role="agent",
                text="Use the opening shot.",
                created_at="2026-05-30T19:00:00Z",
                proposal=Proposal(
                    proposal_id="proposal-1",
                    project_id="runtime-1",
                    message="Use the opening shot.",
                    operations=[],
                ),
            )
        ],
    )

    write_review_session(project_folder, session)

    assert read_review_session(project_folder) == session


def test_frame_scores_round_trip_as_schema_versioned_sidecar(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    per_file = {
        "DJI_0042.MP4": {
            "frames": [
                {
                    "timestamp": 1.0,
                    "frame_path": "/tmp/frame.jpg",
                    "motion_stability": 8.0,
                    "smoothness_score": 8.0,
                    "sharpness_score": 7.0,
                    "exposure_score": 6.0,
                    "contrast_score": 5.0,
                    "visual_interest_score": 0.0,
                    "overall_score": 7.0,
                    "blur_score": 7.0,
                    "brightness": 0.6,
                    "contrast": 0.5,
                    "scene_id": 2,
                    "is_keyframe": True,
                    "turn_rate_deg_per_sec": 3.0,
                }
            ],
            "scene_bounds": {"2": [0.0, 5.0]},
            "source_duration_sec": 5.0,
            "fps": 29.97,
        }
    }

    write_frame_scores(project_folder, per_file)

    assert read_frame_scores(project_folder) == {"per_file": per_file}


def test_frame_scores_schema_version_is_bumped_to_v2():
    assert FRAME_SCORES_SCHEMA_VERSION == 2


def test_frame_scores_v2_round_trip_persists_per_clip_embeddings(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    per_file = {
        "DJI_0042.MP4": {
            "frames": [
                {
                    "timestamp": 1.0,
                    "frame_path": "/tmp/frame.jpg",
                    "motion_stability": 8.0,
                    "smoothness_score": 8.0,
                    "sharpness_score": 7.0,
                    "exposure_score": 6.0,
                    "contrast_score": 5.0,
                    "visual_interest_score": 0.0,
                    "overall_score": 7.0,
                    "blur_score": 7.0,
                    "brightness": 0.6,
                    "contrast": 0.5,
                    "scene_id": 2,
                    "is_keyframe": True,
                    "turn_rate_deg_per_sec": 3.0,
                }
            ],
            "scene_bounds": {"2": [0.0, 5.0]},
            "source_duration_sec": 5.0,
            "fps": 29.97,
            "embeddings": {"clip-abc": [0.1, 0.2, 0.3]},
        }
    }

    write_frame_scores(project_folder, per_file)

    payload = json.loads(frame_scores_path(project_folder).read_text(encoding="utf-8"))
    assert payload["schema_version"] == 2
    assert read_frame_scores(project_folder) == {"per_file": per_file}


def test_read_frame_scores_accepts_legacy_v1_sidecar_with_no_embeddings(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    legacy_per_file = {
        "DJI_0042.MP4": {
            "frames": [],
            "scene_bounds": {"2": [0.0, 5.0]},
            "source_duration_sec": 5.0,
            "fps": 29.97,
        }
    }
    path = frame_scores_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schema_version": 1, "per_file": legacy_per_file}),
        encoding="utf-8",
    )

    result = read_frame_scores(project_folder)

    assert result == {"per_file": legacy_per_file}
    assert "embeddings" not in result["per_file"]["DJI_0042.MP4"]


def test_read_review_session_tolerates_missing_and_corrupt_files(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    assert read_review_session(project_folder) is None

    path = project_folder / "clipassembler" / "analysis" / "review-session.json"
    path.parent.mkdir(parents=True)
    path.write_text("not-json", encoding="utf-8")

    assert read_review_session(project_folder) is None

    path.write_text("[]", encoding="utf-8")
    assert read_review_session(project_folder) is None


def test_create_project_writes_manifest_with_relative_source_video_filenames(tmp_path):
    project_folder = tmp_path / "sunset-drone-footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    (project_folder / "DJI_0043.mov").write_bytes(b"video")

    project = create_project(project_folder, now=fixed_now)

    assert project.name == "sunset-drone-footage"
    assert project.harness == "manual"
    assert project.cloud_ai_consent is False
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


def test_rescan_project_prunes_source_videos_deleted_from_disk(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    remaining = project_folder / "DJI_0042.MP4"
    deleted = project_folder / "DJI_0043.MP4"
    remaining.write_bytes(b"video")
    deleted.write_bytes(b"video")
    create_project(project_folder, now=fixed_now)

    deleted.unlink()
    project = rescan_project(project_folder)

    assert [video.filename for video in project.source_videos] == ["DJI_0042.MP4"]
    assert open_project(project_folder) == project


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


# --- A1.4 Timeline Document persistence + migration -------------------------


def _project_with_state(tmp_path):
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    create_project(project_folder, now=fixed_now)
    return project_folder


def test_write_then_read_timeline_document_round_trips(tmp_path):
    project_folder = _project_with_state(tmp_path)
    document = TimelineDocument(
        items=[
            TimelineItem(
                item_id="item-1",
                source_clip_id="clip-a",
                start_sec=2.0,
                end_sec=5.0,
                speed=2.0,
                transform=Transform(scale=1.5, x=0.1, y=-0.2),
            )
        ],
        profile="cinematic",
        target_duration_sec=42.0,
    )

    write_timeline_document(project_folder, document)
    loaded = read_timeline_document(project_folder)

    assert loaded == document


def test_read_timeline_document_absent_returns_none(tmp_path):
    project_folder = _project_with_state(tmp_path)
    assert read_timeline_document(project_folder) is None


def test_migrate_legacy_timeline_upgrades_old_clip_entries():
    legacy = {
        "source": "manual",
        "profile": "balanced",
        "target_duration_sec": 30.0,
        "clips": [
            {"clip_id": "clip-a", "start_sec": 1.0, "end_sec": 4.0},
            {"clip_id": "clip-b", "start_sec": 0.0, "end_sec": 2.5},
        ],
    }

    document = migrate_legacy_timeline(legacy)

    assert isinstance(document, TimelineDocument)
    assert document.profile == "balanced"
    assert document.target_duration_sec == 30.0
    assert [(i.source_clip_id, i.start_sec, i.end_sec) for i in document.items] == [
        ("clip-a", 1.0, 4.0),
        ("clip-b", 0.0, 2.5),
    ]
    # Each migrated item gets a generated id, default speed, identity transform.
    assert all(i.item_id for i in document.items)
    assert all(i.speed == 1.0 for i in document.items)
    assert all(i.transform == Transform() for i in document.items)
    # Distinct ids even though they come from one legacy list.
    assert len({i.item_id for i in document.items}) == 2


def test_migrate_legacy_timeline_carries_decisions():
    legacy = {
        "clips": [{"clip_id": "clip-a", "start_sec": 1.0, "end_sec": 4.0}],
        "decisions": {"clip-a": "included", "clip-b": "excluded"},
    }
    document = migrate_legacy_timeline(legacy)
    assert document.decisions == {"clip-a": "included", "clip-b": "excluded"}


def test_migrate_legacy_timeline_resolves_bare_clip_ids_from_sources():
    legacy = {"profile": "balanced", "clips": ["clip-a"]}
    sources = {
        "clip-a": SourceClip(
            clip_id="clip-a", start_sec=3.0, end_sec=7.0, source_duration_sec=20.0
        )
    }

    document = migrate_legacy_timeline(legacy, sources=sources)

    assert [(i.source_clip_id, i.start_sec, i.end_sec) for i in document.items] == [
        ("clip-a", 3.0, 7.0)
    ]


def test_load_timeline_document_prefers_saved_over_legacy(tmp_path):
    project_folder = _project_with_state(tmp_path)
    saved = TimelineDocument(
        items=[TimelineItem(item_id="i1", source_clip_id="c", start_sec=0.0, end_sec=1.0)]
    )
    write_timeline_document(project_folder, saved)

    legacy = {"clips": [{"clip_id": "other", "start_sec": 0.0, "end_sec": 9.0}]}
    loaded = load_timeline_document(project_folder, legacy=legacy)

    assert loaded == saved


def test_load_timeline_document_migrates_legacy_when_no_saved_document(tmp_path):
    project_folder = _project_with_state(tmp_path)
    legacy = {"clips": [{"clip_id": "clip-a", "start_sec": 1.0, "end_sec": 4.0}]}

    loaded = load_timeline_document(project_folder, legacy=legacy)

    assert loaded is not None
    assert [i.source_clip_id for i in loaded.items] == ["clip-a"]


def test_load_timeline_document_none_when_nothing_present(tmp_path):
    project_folder = _project_with_state(tmp_path)
    assert load_timeline_document(project_folder) is None


# --- Task 1: persisted revision backfill ------------------------------------


def test_read_timeline_document_backfills_missing_revision_as_zero(tmp_path):
    project_folder = _project_with_state(tmp_path)
    path = timeline_document_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Legacy persisted document with no `revision` field at all.
    path.write_text(
        json.dumps(
            {
                "version": 2,
                "items": [
                    {
                        "item_id": "i1",
                        "source_clip_id": "clip-a",
                        "start_sec": 0.0,
                        "end_sec": 1.0,
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    loaded = read_timeline_document(project_folder)

    assert loaded is not None
    assert loaded.revision == 0


def test_read_timeline_document_does_not_rewrite_file_on_read(tmp_path):
    project_folder = _project_with_state(tmp_path)
    path = timeline_document_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    # A legacy file lacking `revision`; reading must not normalize/rewrite it.
    raw = json.dumps({"version": 2, "items": []}) + "\n"
    path.write_text(raw, encoding="utf-8")

    read_timeline_document(project_folder)

    assert path.read_text(encoding="utf-8") == raw


def test_migrate_legacy_timeline_defaults_revision_zero():
    document = migrate_legacy_timeline(
        {"clips": [{"clip_id": "clip-a", "start_sec": 1.0, "end_sec": 4.0}]}
    )
    assert document.revision == 0


def test_round_trip_timeline_document_preserves_revision(tmp_path):
    project_folder = _project_with_state(tmp_path)
    document = TimelineDocument(
        items=[
            TimelineItem(item_id="i1", source_clip_id="clip-a", start_sec=0.0, end_sec=1.0)
        ],
    ).model_copy(update={"revision": 7})

    write_timeline_document(project_folder, document)
    loaded = read_timeline_document(project_folder)

    assert loaded is not None
    assert loaded.revision == 7


def test_read_review_session_migrates_v1_bare_versions_without_rewriting(tmp_path):
    project_folder = _project_with_state(tmp_path)
    path = review_session_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(
        {
            "schema_version": 1,
            "session_id": "legacy",
            "updated_at": "2026-06-21T00:00:00Z",
            "messages": [
                {
                    "message_id": "agent-1",
                    "role": "agent",
                    "text": "Three versions",
                    "created_at": "2026-06-21T00:00:00Z",
                    "payload": {
                        "versions": [
                            {
                                "version_id": "v1",
                                "title": "Legacy",
                                "vibe": "calm",
                                "rationale": "Saved before v2.",
                                "profile": "long_scenic",
                                "total_duration_sec": 2,
                                "items": [
                                    {
                                        "source_clip_id": "clip-a",
                                        "file_id": "file-a",
                                        "file_name": "A.MOV",
                                        "start_sec": 1,
                                        "end_sec": 3,
                                    }
                                ],
                            }
                        ]
                    },
                }
            ],
        }
    ) + "\n"
    path.write_text(raw, encoding="utf-8")

    session = read_review_session(project_folder)

    assert session is not None
    assert session.schema_version == 2
    version_set = session.messages[0].payload["version_set"]
    assert version_set["versions"][0]["sequence_fingerprint"]
    assert path.read_text(encoding="utf-8") == raw
