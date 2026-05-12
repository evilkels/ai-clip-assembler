from pathlib import Path

from fastapi.testclient import TestClient

from src import api
from src.models import AssemblyResult, ClipSuggestion, FrameSample, FrameScore, TimelineSequence, VideoMetadata


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


def test_analyze_local_qwen_harness_returns_enhanced_clips(monkeypatch, tmp_path):
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
                "metadata": {"model_used": "qwen2.5-vl:7b", "local": True},
                "harness_id": "local_qwen",
            }
        )
        return enhanced, True

    monkeypatch.setattr("src.api.enhance_clips_with_local_qwen", fake_enhance)

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "local_qwen", "preferences": {}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["harness_id"] == "local_qwen"
    assert body["clips"][0]["clip_id"] == "clip-1"
    assert body["metadata"]["model_used"] == "qwen2.5-vl:7b"
    assert body["metadata"]["local"] is True
    assert "warning" not in body["metadata"]


def test_analyze_local_qwen_fallback_when_ollama_unavailable(monkeypatch, tmp_path):
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
                "metadata": {"warning": "Local Qwen fallback: Ollama/model unavailable"},
                "harness_id": "local_qwen",
            }
        )
        return fallback, False

    monkeypatch.setattr("src.api.enhance_clips_with_local_qwen", fake_enhance)

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "local_qwen", "preferences": {}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["harness_id"] == "local_qwen"
    assert body["clips"][0]["overall_score"] == 8
    assert body["metadata"]["warning"] == "Local Qwen fallback: Ollama/model unavailable"


def test_list_harnesses_shows_local_qwen_enabled():
    client = TestClient(api.app)
    response = client.get("/harnesses")
    assert response.status_code == 200
    harnesses = {h["id"]: h for h in response.json()["harnesses"]}
    assert harnesses["local_qwen"]["enabled"] is True
    assert harnesses["manual"]["enabled"] is True
