from pathlib import Path

from fastapi.testclient import TestClient

from src import api
from src.models import AssemblyResult, ClipSuggestion, FrameSample, FrameScore, TimelineSequence, VideoMetadata


def test_create_project_from_folder_registers_source_videos_without_copying(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "sunset-drone-footage"
    project_folder.mkdir()
    source_video = project_folder / "DJI_0042.MP4"
    source_video.write_bytes(b"original")
    client = TestClient(api.app)

    response = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["project"]["name"] == "sunset-drone-footage"
    assert body["project"]["harness"] == "pi_agent"
    assert body["project"]["source_videos"][0]["filename"] == "DJI_0042.MP4"
    project = api.projects[body["project_id"]]
    assert project["project_folder"] == str(project_folder)
    assert project["videos"] == [
        {
            "file_id": "DJI_0042.MP4",
            "file_name": "DJI_0042.MP4",
            "file_path": str(source_video),
            "status": "ready",
            "metadata": {},
        }
    ]
    assert not (project_folder / "videos").exists()


def test_create_project_from_folder_opens_existing_manifest_without_rescan(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"original")
    client = TestClient(api.app)
    first = client.post("/projects/from-folder", json={"folder_path": str(project_folder)})
    (project_folder / "DJI_0043.MP4").write_bytes(b"new")

    second = client.post("/projects/from-folder", json={"folder_path": str(project_folder)})

    assert second.status_code == 200
    assert first.json()["project"]["source_videos"] == second.json()["project"]["source_videos"]
    assert [video["file_name"] for video in api.projects[second.json()["project_id"]]["videos"]] == [
        "DJI_0042.MP4"
    ]


def test_create_project_from_folder_rejects_empty_folder_without_mutation(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "empty"
    project_folder.mkdir()
    client = TestClient(api.app)

    response = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    )

    assert response.status_code == 422
    assert "No supported source videos" in response.json()["detail"]
    assert not (project_folder / "clipassembler").exists()


def test_rescan_folder_project_adds_new_source_videos(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]
    (project_folder / "DJI_0043.MP4").write_bytes(b"video")

    response = client.post(f"/projects/{project_id}/rescan")

    assert response.status_code == 200
    assert [video["file_name"] for video in response.json()["videos"]] == [
        "DJI_0042.MP4",
        "DJI_0043.MP4",
    ]
    assert [
        video["filename"]
        for video in response.json()["project"]["source_videos"]
    ] == ["DJI_0042.MP4", "DJI_0043.MP4"]


def test_delete_folder_project_files_keeps_source_video(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    source_video = project_folder / "DJI_0042.MP4"
    source_video.write_bytes(b"video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]
    (project_folder / "exports").mkdir()
    (project_folder / "exports" / "timeline.edl").write_text("export", encoding="utf-8")

    response = client.delete(f"/projects/{project_id}/files")

    assert response.status_code == 200
    assert source_video.read_bytes() == b"video"
    assert not (project_folder / "clipassembler").exists()
    assert not (project_folder / "exports").exists()
    assert project_id not in api.projects


def test_analyze_folder_project_writes_work_files_under_clipassembler(monkeypatch, tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]
    paths = {}

    def fake_vidstab(**kwargs):
        paths["transforms_path"] = kwargs["transforms_path"]

    def fake_extract(**kwargs):
        paths["frames_dir"] = kwargs["frames_dir"]
        return [FrameSample(timestamp=0, frame_path="/tmp/0.jpg")]

    monkeypatch.setattr(api, "run_vidstabdetect", fake_vidstab)
    monkeypatch.setattr(api, "detect_scenes", lambda video_path: [])
    monkeypatch.setattr(api, "extract_frames", fake_extract)
    monkeypatch.setattr(api, "score_samples_rule_based", lambda samples: [])
    monkeypatch.setattr(
        api,
        "assemble_smooth_clips",
        lambda file_id, file_name, frames, preferences: AssemblyResult(
            clips=[],
            sequence=TimelineSequence(total_duration_sec=0, clips=[]),
        ),
    )

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
    )

    assert response.status_code == 200
    assert paths["transforms_path"] == (
        project_folder / "clipassembler" / "analysis" / "motion" / "DJI_0042.MP4.trf"
    )
    assert paths["frames_dir"] == (
        project_folder / "clipassembler" / "samples" / "DJI_0042.MP4"
    )


def test_upload_video_stores_file_and_returns_metadata(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)

    def fake_probe(path):
        return VideoMetadata(
            file_id="ignored",
            file_path=str(path),
            file_name=path.name,
            duration_sec=10.0,
            fps=29.97,
            resolution=[1920, 1080],
            codec="h264",
        )

    monkeypatch.setattr(api, "probe_video", fake_probe)
    client = TestClient(api.app)

    project_id = client.post("/projects").json()["project_id"]
    response = client.post(
        f"/projects/{project_id}/videos",
        files={"file": ("DJI_0001.MP4", b"fake video bytes", "video/mp4")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["metadata"]["file_name"] == "DJI_0001.MP4"
    assert body["metadata"]["resolution"] == [1920, 1080]
    assert api.projects[project_id]["videos"][0]["file_path"].endswith("_DJI_0001.MP4")


def test_upload_video_uses_unique_paths_for_duplicate_filenames(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)

    def fake_probe(path):
        return VideoMetadata(
            file_id="ignored",
            file_path=str(path),
            file_name=path.name,
            duration_sec=10.0,
            fps=29.97,
            resolution=[1920, 1080],
            codec="h264",
        )

    monkeypatch.setattr(api, "probe_video", fake_probe)
    client = TestClient(api.app)

    project_id = client.post("/projects").json()["project_id"]
    for content in [b"first", b"second"]:
        response = client.post(
            f"/projects/{project_id}/videos",
            files={"file": ("DJI_0001.MP4", content, "video/mp4")},
        )
        assert response.status_code == 200

    paths = [video["file_path"] for video in api.projects[project_id]["videos"]]
    assert len(paths) == 2
    assert paths[0] != paths[1]
    assert Path(paths[0]).read_bytes() == b"first"
    assert Path(paths[1]).read_bytes() == b"second"


def test_upload_video_removes_saved_file_when_probe_fails(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)

    def failing_probe(path):
        raise api.FFprobeError("not a video")

    monkeypatch.setattr(api, "probe_video", failing_probe)
    client = TestClient(api.app)

    project_id = client.post("/projects").json()["project_id"]
    response = client.post(
        f"/projects/{project_id}/videos",
        files={"file": ("broken.mp4", b"broken", "video/mp4")},
    )

    assert response.status_code == 422
    assert list((tmp_path / project_id / "videos").glob("*")) == []


def test_analyze_manual_harness_extracts_scores_and_stores_clips(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )
    monkeypatch.setattr(api, "run_vidstabdetect", lambda **kwargs: None)
    monkeypatch.setattr(api, "detect_scenes", lambda video_path: [])

    monkeypatch.setattr(
        api,
        "extract_frames",
        lambda **kwargs: [FrameSample(timestamp=0, frame_path="/tmp/0.jpg"), FrameSample(timestamp=1, frame_path="/tmp/1.jpg")],
    )
    monkeypatch.setattr(
        api,
        "score_samples_rule_based",
        lambda samples: [
            FrameScore(
                timestamp=0,
                frame_path="/tmp/0.jpg",
                motion_stability=8,
                smoothness_score=8,
                sharpness_score=8,
                exposure_score=8,
                contrast_score=8,
                overall_score=8,
                blur_score=8,
                brightness=0.5,
                contrast=0.5,
            )
        ],
    )
    monkeypatch.setattr(
        api,
        "assemble_smooth_clips",
        lambda file_id, file_name, frames, preferences: AssemblyResult(
            clips=[
                ClipSuggestion(
                    clip_id="clip-1",
                    file_id=file_id,
                    file_name=file_name,
                    start_sec=0,
                    end_sec=3,
                    duration_sec=3,
                    smoothness_score=8,
                    visual_interest_score=0,
                    overall_score=8,
                    ai_reason="Stable 8.0/10",
                )
            ],
            sequence=TimelineSequence(total_duration_sec=3, clips=["clip-1"]),
        ),
    )

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {"smoothness_threshold": 7}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["clips"][0]["clip_id"] == "clip-1"
    assert api.projects[project_id]["clips"][0]["clip_id"] == "clip-1"


def test_analyze_runs_motion_and_scene_detection_before_scoring(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )
    calls = {"vidstab": False}

    def fake_vidstab(**kwargs):
        calls["vidstab"] = True

    monkeypatch.setattr(api, "run_vidstabdetect", fake_vidstab)
    monkeypatch.setattr(
        api,
        "detect_scenes",
        lambda video_path: [api.SceneBoundary(scene_id=7, start_sec=0, end_sec=5)],
    )
    monkeypatch.setattr(
        api,
        "extract_frames",
        lambda **kwargs: [FrameSample(timestamp=1, frame_path="/tmp/1.jpg")],
    )

    def fake_score(samples):
        assert samples[0].scene_id == 7
        return []

    monkeypatch.setattr(api, "score_samples_rule_based", fake_score)
    monkeypatch.setattr(
        api,
        "assemble_smooth_clips",
        lambda file_id, file_name, frames, preferences: AssemblyResult(
            clips=[],
            sequence=TimelineSequence(total_duration_sec=0, clips=[]),
        ),
    )

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
    )

    assert response.status_code == 200
    assert calls["vidstab"] is True


def test_analyze_rejects_invalid_sample_fps(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {"sample_fps": 0}},
    )

    assert response.status_code == 422
    assert "sample_fps" in response.json()["detail"]


def test_analyze_returns_clear_error_when_ffmpeg_is_missing(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )
    monkeypatch.setattr(api, "run_vidstabdetect", lambda **kwargs: None)
    monkeypatch.setattr(api, "extract_frames", lambda **kwargs: (_ for _ in ()).throw(api.FFmpegUnavailableError("ffmpeg missing")))

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "ffmpeg missing"


def test_analyze_ranks_clips_globally_across_videos(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].extend(
        [
            {"file_id": "low", "file_name": "low.mp4", "file_path": str(tmp_path / "low.mp4"), "status": "ready"},
            {"file_id": "high", "file_name": "high.mp4", "file_path": str(tmp_path / "high.mp4"), "status": "ready"},
        ]
    )

    monkeypatch.setattr(api, "run_vidstabdetect", lambda **kwargs: None)
    monkeypatch.setattr(api, "detect_scenes", lambda video_path: [])
    monkeypatch.setattr(api, "extract_frames", lambda **kwargs: [FrameSample(timestamp=0, frame_path="/tmp/0.jpg")])
    monkeypatch.setattr(api, "score_samples_rule_based", lambda samples: [])

    def fake_assemble(file_id, file_name, frames, preferences):
        score = 9 if file_id == "high" else 7
        clip_id = f"{file_id}-clip"
        return AssemblyResult(
            clips=[
                ClipSuggestion(
                    clip_id=clip_id,
                    file_id=file_id,
                    file_name=file_name,
                    start_sec=0,
                    end_sec=3,
                    duration_sec=3,
                    smoothness_score=score,
                    visual_interest_score=0,
                    overall_score=score,
                    ai_reason=f"Stable {score}/10",
                )
            ],
            sequence=TimelineSequence(total_duration_sec=3, clips=[clip_id]),
        )

    monkeypatch.setattr(api, "assemble_smooth_clips", fake_assemble)

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
    )

    assert response.status_code == 200
    assert [clip["clip_id"] for clip in response.json()["clips"]] == ["high-clip", "low-clip"]
    assert response.json()["sequence"]["clips"] == ["high-clip", "low-clip"]


def test_export_timeline_writes_requested_format(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0, "fps": 30, "resolution": [1920, 1080]},
            "status": "ready",
        }
    )
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0,
            "end_sec": 3,
            "duration_sec": 3,
            "overall_score": 8,
        }
    ]
    api.projects[project_id]["timeline"] = {"clips": ["clip-1"], "total_duration_sec": 3}

    response = client.post(f"/projects/{project_id}/export?format=edl")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "generated"
    assert body["file_path"].endswith("timeline.edl")
    assert "TITLE:" in Path(body["file_path"]).read_text()


def test_export_folder_project_writes_inside_project_exports(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    source_video = project_folder / "DJI_0042.MP4"
    source_video.write_bytes(b"video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]
    api.projects[project_id]["videos"][0]["metadata"] = {
        "duration_sec": 10.0,
        "fps": 30,
        "resolution": [1920, 1080],
    }
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "DJI_0042.MP4",
            "file_name": "DJI_0042.MP4",
            "start_sec": 0,
            "end_sec": 3,
            "duration_sec": 3,
            "overall_score": 8,
        }
    ]
    api.projects[project_id]["timeline"] = {"clips": ["clip-1"], "total_duration_sec": 3}

    response = client.post(f"/projects/{project_id}/export?format=fcpxml")

    assert response.status_code == 200
    body = response.json()
    export_path = Path(body["file_path"])
    assert export_path == project_folder / "exports" / "fcp" / "timeline.fcpxml"
    assert 'src="../../DJI_0042.MP4"' in export_path.read_text(encoding="utf-8")


def test_export_folder_project_requires_overwrite_flag_for_existing_export(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    (project_folder / "DJI_0042.MP4").write_bytes(b"video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]
    api.projects[project_id]["videos"][0]["metadata"] = {
        "duration_sec": 10.0,
        "fps": 30,
        "resolution": [1920, 1080],
    }
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "DJI_0042.MP4",
            "file_name": "DJI_0042.MP4",
            "start_sec": 0,
            "end_sec": 3,
            "duration_sec": 3,
            "overall_score": 8,
        }
    ]
    api.projects[project_id]["timeline"] = {"clips": ["clip-1"], "total_duration_sec": 3}
    first = client.post(f"/projects/{project_id}/export?format=edl")

    blocked = client.post(f"/projects/{project_id}/export?format=edl")
    overwritten = client.post(f"/projects/{project_id}/export?format=edl&overwrite=true")

    assert first.status_code == 200
    assert blocked.status_code == 409
    assert "already exists" in blocked.json()["detail"]
    assert overwritten.status_code == 200


def test_analyze_pi_agent_harness_returns_enhanced_clips(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )
    monkeypatch.setattr(api, "run_vidstabdetect", lambda **kwargs: None)
    monkeypatch.setattr(api, "detect_scenes", lambda video_path: [])
    monkeypatch.setattr(
        api,
        "extract_frames",
        lambda **kwargs: [FrameSample(timestamp=0, frame_path="/tmp/0.jpg")],
    )
    monkeypatch.setattr(
        api,
        "score_samples_rule_based",
        lambda samples: [
            FrameScore(
                timestamp=0,
                frame_path="/tmp/0.jpg",
                motion_stability=8,
                smoothness_score=8,
                sharpness_score=8,
                exposure_score=8,
                contrast_score=8,
                overall_score=8,
                blur_score=8,
                brightness=0.5,
                contrast=0.5,
            )
        ],
    )
    monkeypatch.setattr(
        api,
        "assemble_smooth_clips",
        lambda file_id, file_name, frames, preferences: AssemblyResult(
            clips=[
                ClipSuggestion(
                    clip_id="clip-1",
                    file_id=file_id,
                    file_name=file_name,
                    start_sec=0,
                    end_sec=3,
                    duration_sec=3,
                    smoothness_score=8,
                    visual_interest_score=0,
                    overall_score=8,
                    ai_reason="Stable 8.0/10",
                )
            ],
            sequence=TimelineSequence(total_duration_sec=3, clips=["clip-1"]),
        ),
    )

    def fake_enhance(result, frames, **kwargs):
        enhanced = result.model_copy(
            update={
                "clips": [
                    result.clips[0].model_copy(
                        update={
                            "visual_interest_score": 9.0,
                            "overall_score": 8.3,
                            "ai_reason": "Stable 8.0/10 | AI: great composition",
                        }
                    )
                ],
                "metadata": {"model_used": "gpt-5.4-mini", "local": False, "used_ai": True, "clips_enhanced": 1, "clips_total": 1},
                "harness_id": "pi_agent",
            }
        )
        return enhanced, True

    monkeypatch.setattr("src.api.enhance_clips_with_pi_cli", fake_enhance)

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "pi_agent", "preferences": {}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["harness_id"] == "pi_agent"
    assert body["clips"][0]["clip_id"] == "clip-1"
    assert body["metadata"]["model_used"] == "gpt-5.4-mini"
    assert body["metadata"]["local"] is False
    assert "warning" not in body["metadata"]


def test_analyze_pi_agent_fallback_when_cli_unavailable(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )
    monkeypatch.setattr(api, "run_vidstabdetect", lambda **kwargs: None)
    monkeypatch.setattr(api, "detect_scenes", lambda video_path: [])
    monkeypatch.setattr(
        api,
        "extract_frames",
        lambda **kwargs: [FrameSample(timestamp=0, frame_path="/tmp/0.jpg")],
    )
    monkeypatch.setattr(
        api,
        "score_samples_rule_based",
        lambda samples: [
            FrameScore(
                timestamp=0,
                frame_path="/tmp/0.jpg",
                motion_stability=8,
                smoothness_score=8,
                sharpness_score=8,
                exposure_score=8,
                contrast_score=8,
                overall_score=8,
                blur_score=8,
                brightness=0.5,
                contrast=0.5,
            )
        ],
    )
    monkeypatch.setattr(
        api,
        "assemble_smooth_clips",
        lambda file_id, file_name, frames, preferences: AssemblyResult(
            clips=[
                ClipSuggestion(
                    clip_id="clip-1",
                    file_id=file_id,
                    file_name=file_name,
                    start_sec=0,
                    end_sec=3,
                    duration_sec=3,
                    smoothness_score=8,
                    visual_interest_score=0,
                    overall_score=8,
                    ai_reason="Stable 8.0/10",
                )
            ],
            sequence=TimelineSequence(total_duration_sec=3, clips=["clip-1"]),
        ),
    )

    def fake_enhance(result, frames, **kwargs):
        fallback = result.model_copy(
            update={
                "metadata": {"warning": "pi harness fallback: CLI unavailable or no usable scores", "used_ai": False},
                "harness_id": "pi_agent",
            }
        )
        return fallback, False

    monkeypatch.setattr("src.api.enhance_clips_with_pi_cli", fake_enhance)

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "pi_agent", "preferences": {}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["harness_id"] == "pi_agent"
    assert body["clips"][0]["overall_score"] == 8
    assert "file-1" in body["metadata"]["warning"]


def test_analyze_rejects_postponed_local_qwen_harness(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "local_qwen", "preferences": {}},
    )

    assert response.status_code == 400
    assert "manual and pi_agent" in response.json()["detail"]


def test_update_timeline_replaces_order_and_trims(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0.0,
            "end_sec": 5.0,
            "duration_sec": 5.0,
            "overall_score": 8,
        },
        {
            "clip_id": "clip-2",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
            "overall_score": 7,
        },
    ]
    api.projects[project_id]["timeline"] = {"clips": ["clip-1", "clip-2"], "total_duration_sec": 9.0}

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={
            "clips": [
                {"clip_id": "clip-2", "start_sec": 11.0, "end_sec": 13.5, "included": True},
                {"clip_id": "clip-1", "start_sec": 1.0, "end_sec": 4.0, "included": True},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert [clip["clip_id"] for clip in body["clips"]] == ["clip-2", "clip-1"]
    assert body["clips"][0]["duration_sec"] == 2.5
    assert body["clips"][1]["duration_sec"] == 3.0
    assert body["total_duration_sec"] == 5.5


def test_update_timeline_rejects_unknown_clip_id(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0.0,
            "end_sec": 5.0,
            "duration_sec": 5.0,
            "overall_score": 8,
        }
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={"clips": [{"clip_id": "missing", "start_sec": 0.0, "end_sec": 2.0, "included": True}]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown clip_id: missing"


def test_update_timeline_rejects_duplicate_clip_ids(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0.0,
            "end_sec": 5.0,
            "duration_sec": 5.0,
            "overall_score": 8,
        }
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={
            "clips": [
                {"clip_id": "clip-1", "start_sec": 0.5, "end_sec": 2.0, "included": True},
                {"clip_id": "clip-1", "start_sec": 2.0, "end_sec": 4.0, "included": True},
            ]
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Duplicate clip_id: clip-1"


def test_update_timeline_rejects_invalid_trim_range(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0.0,
            "end_sec": 5.0,
            "duration_sec": 5.0,
            "overall_score": 8,
        }
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={"clips": [{"clip_id": "clip-1", "start_sec": 2.0, "end_sec": 2.0, "included": True}]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Timeline clip must satisfy start_sec < end_sec for clip-1"


def test_update_timeline_rejects_missing_project(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)

    response = client.put(
        "/projects/missing/timeline",
        json={"clips": [{"clip_id": "clip-1", "start_sec": 0.0, "end_sec": 1.0, "included": True}]},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


def test_update_timeline_rejects_clip_trim_outside_original_bounds(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 3.0,
            "end_sec": 5.0,
            "duration_sec": 2.0,
            "overall_score": 8,
        }
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={"clips": [{"clip_id": "clip-1", "start_sec": 2.5, "end_sec": 4.0, "included": True}]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Timeline trim is outside original clip bounds for clip-1"


def test_export_uses_updated_timeline_order_and_trimmed_timings(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 20.0, "fps": 30, "resolution": [1920, 1080]},
            "status": "ready",
        }
    )
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0.0,
            "end_sec": 5.0,
            "duration_sec": 5.0,
            "overall_score": 8,
        },
        {
            "clip_id": "clip-2",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
            "overall_score": 7,
        },
    ]
    api.projects[project_id]["timeline"] = {
        "clips": [
            {"clip_id": "clip-2", "start_sec": 11.0, "end_sec": 13.5, "duration_sec": 2.5, "included": True},
            {"clip_id": "clip-1", "start_sec": 1.0, "end_sec": 4.0, "duration_sec": 3.0, "included": True},
        ],
        "total_duration_sec": 5.5,
    }

    response = client.post(f"/projects/{project_id}/export?format=edl")

    assert response.status_code == 200
    body = response.json()
    assert body["clip_count"] == 2
    assert body["total_duration_sec"] == 5.5
    edl = Path(body["file_path"]).read_text()
    assert "00:00:11:00 00:00:13:15 00:00:00:00 00:00:02:15" in edl
    assert "00:00:01:00 00:00:04:00 00:00:02:15 00:00:05:15" in edl


def test_export_timeline_keeps_present_but_empty_edited_timeline_empty(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0, "fps": 30, "resolution": [1920, 1080]},
            "status": "ready",
        }
    )
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 0,
            "end_sec": 3,
            "duration_sec": 3,
            "overall_score": 8,
        }
    ]
    api.projects[project_id]["timeline"] = {"clips": [], "total_duration_sec": 0}

    response = client.post(f"/projects/{project_id}/export?format=edl")

    assert response.status_code == 200
    body = response.json()
    assert body["clip_count"] == 0
    assert body["total_duration_sec"] == 0
    assert Path(body["file_path"]).read_text() == "TITLE: AI Clip Assembler\nFCM: NON-DROP FRAME\n"


def test_export_timeline_uses_source_fps_for_edl_timecode(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "DJI_0001.MP4"),
            "metadata": {"duration_sec": 10.0, "fps": 59.94, "resolution": [1920, 1080]},
            "status": "ready",
        }
    )
    api.projects[project_id]["clips"] = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 1,
            "end_sec": 2,
            "duration_sec": 1,
            "overall_score": 8,
        }
    ]
    api.projects[project_id]["timeline"] = {"clips": ["clip-1"], "total_duration_sec": 1}

    response = client.post(f"/projects/{project_id}/export?format=edl")

    assert response.status_code == 200
    assert "00:00:01:00 00:00:02:00 00:00:00:00 00:00:01:00" in Path(response.json()["file_path"]).read_text()


def test_list_harnesses_shows_pi_agent_enabled_and_local_qwen_postponed():
    client = TestClient(api.app)
    response = client.get("/harnesses")
    assert response.status_code == 200
    harnesses = {h["id"]: h for h in response.json()["harnesses"]}
    assert harnesses["manual"]["enabled"] is True
    assert harnesses["pi_agent"]["enabled"] is True
    # Local Qwen is postponed until the local-model path is fully figured out.
    assert harnesses["local_qwen"]["enabled"] is False
