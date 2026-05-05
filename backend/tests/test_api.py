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
