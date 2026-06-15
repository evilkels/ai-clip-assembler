"""Tests for analysis cancellation and source-file selection."""

import threading
import time

from fastapi.testclient import TestClient

import src.api as api
import src.motion_analysis as motion_analysis


def _add_video(project_id: str, tmp_path, file_id: str, name: str) -> None:
    path = tmp_path / name
    path.write_bytes(b"\x00")  # placeholder; ffmpeg is stubbed in these tests
    api.projects[project_id]["videos"].append(
        {
            "file_id": file_id,
            "file_name": name,
            "file_path": str(path),
            "metadata": {"duration_sec": 10.0},
            "status": "ready",
        }
    )


def test_cancel_aborts_running_analysis_and_kills_subprocess(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    _add_video(project_id, tmp_path, "file-1", "DJI_0001.MP4")

    # Stand in for the slow ffmpeg vidstabdetect pass with a long sleep so the
    # cancellable runner has a live process to kill.
    monkeypatch.setattr(
        motion_analysis, "build_vidstabdetect_command", lambda *_: ["sleep", "30"]
    )

    result: dict = {}

    def run_analyze():
        result["response"] = client.post(
            f"/projects/{project_id}/analyze",
            json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
        )

    worker = threading.Thread(target=run_analyze)
    worker.start()

    # Wait until the cancellable runner has registered a live subprocess.
    deadline = time.time() + 10
    while time.time() < deadline and api._analysis_active_proc.get(project_id) is None:
        time.sleep(0.05)
    proc = api._analysis_active_proc.get(project_id)
    assert proc is not None, "analysis subprocess never started"

    cancel = client.post(f"/projects/{project_id}/analyze/cancel")
    assert cancel.json()["status"] == "cancelling"

    worker.join(timeout=10)
    assert not worker.is_alive(), "analysis did not abort promptly"

    assert result["response"].status_code == 409
    assert "cancel" in result["response"].json()["detail"].lower()
    assert api.projects[project_id]["analysis_progress"]["phase"] == "cancelled"
    # Registry is cleaned up and the sleep process is gone.
    assert api._analysis_active_proc.get(project_id) is None
    assert proc.poll() is not None


def test_file_ids_restrict_analysis_to_selected_videos(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    _add_video(project_id, tmp_path, "file-1", "DJI_0001.MP4")
    _add_video(project_id, tmp_path, "file-2", "DJI_0002.MP4")

    analyzed: list = []

    def fake_vidstab(*, input_path, transforms_path, runner=None):
        analyzed.append(input_path.name)

    monkeypatch.setattr(api, "run_vidstabdetect", fake_vidstab)
    monkeypatch.setattr(api, "extract_frames", lambda **kwargs: [])
    monkeypatch.setattr(api, "detect_scenes", lambda *_a, **_k: [])
    monkeypatch.setattr(api, "assign_scene_ids", lambda samples, scenes: samples)
    monkeypatch.setattr(api, "score_samples_rule_based", lambda samples: [])

    class _Result:
        clips = []
        metadata = {}

    monkeypatch.setattr(api, "assemble_smooth_clips", lambda **kwargs: _Result())

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={
            "project_id": project_id,
            "harness_id": "manual",
            "preferences": {},
            "file_ids": ["file-2"],
        },
    )

    assert response.status_code == 200
    assert analyzed == ["DJI_0002.MP4"]


def test_empty_selection_is_rejected(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    _add_video(project_id, tmp_path, "file-1", "DJI_0001.MP4")

    response = client.post(
        f"/projects/{project_id}/analyze",
        json={
            "project_id": project_id,
            "harness_id": "manual",
            "preferences": {},
            "file_ids": [],
        },
    )
    # Empty list means "explicitly selected nothing" -> 400.
    assert response.status_code == 400
