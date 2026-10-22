import json
import re
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from src import api
from src.ai_engines.pi import PiEngine
from src.models import AssemblyResult, ClipSuggestion, FrameSample, FrameScore, TimelineSequence
from support import fake_engine


def test_analysis_and_review_send_only_staged_jpegs(monkeypatch, tmp_path):
    for project_id in list(api.projects):
        api._timeline_lifecycle.invalidate(project_id)
    api.projects.clear()
    folder_name = f"secret-folder-{uuid.uuid4().hex}"
    project_folder = tmp_path / folder_name
    project_folder.mkdir()
    video_names = ("DJI_0001.MP4", "DJI_0002.MOV")
    frame_timestamps = (1.0, 2.0)
    for filename in video_names:
        (project_folder / filename).write_bytes(b"source video")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder", json={"folder_path": str(project_folder)}
    ).json()["project_id"]
    consent = client.put(
        f"/projects/{project_id}/cloud-ai-consent", json={"consented": True}
    )
    assert consent.status_code == 200

    def extract_frames(*, frames_dir, file_id, **_kwargs):
        frames_dir.mkdir(parents=True, exist_ok=True)
        samples = []
        for timestamp in frame_timestamps:
            path = frames_dir / f"{file_id}_{int(timestamp * 1000):06d}.jpg"
            Image.new("RGB", (2, 2), color="blue").save(path, format="JPEG")
            samples.append(FrameSample(timestamp=timestamp, frame_path=str(path), scene_id=1))
        return samples

    def score_samples(samples):
        return [
            FrameScore(
                timestamp=sample.timestamp, frame_path=sample.frame_path,
                motion_stability=8, smoothness_score=8, sharpness_score=8,
                exposure_score=8, contrast_score=8, visual_interest_score=0,
                overall_score=8, blur_score=8, brightness=0.8, contrast=0.8,
                scene_id=1, is_keyframe=True, turn_rate_deg_per_sec=0,
            )
            for sample in samples
        ]

    def assemble_clips(*, file_id, file_name, frames, **_kwargs):
        clip_id = f"clip-{file_id[-1]}"
        return AssemblyResult(
            clips=[ClipSuggestion(
                clip_id=clip_id, file_id=file_id, file_name=file_name,
                start_sec=0, end_sec=3, duration_sec=3, smoothness_score=8,
                visual_interest_score=0, overall_score=8, ai_reason="Stable",
            )],
            sequence=TimelineSequence(total_duration_sec=3, clips=[clip_id]),
        )

    monkeypatch.setattr(api, "run_vidstabdetect", lambda **_kwargs: None)
    monkeypatch.setattr(api, "extract_frames", extract_frames)
    monkeypatch.setattr(api, "detect_scenes", lambda _path: [])
    monkeypatch.setattr(api, "score_samples_rule_based", score_samples)
    monkeypatch.setattr(api, "assemble_smooth_clips", assemble_clips)
    monkeypatch.setattr(api, "default_embedding_provider", lambda: None)
    bin_path, log_path = fake_engine(tmp_path / "fake")
    monkeypatch.setattr(
        api, "get_engine", lambda: PiEngine(str(bin_path), "openai-codex", "fake")
    )

    analysis = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "pi_agent", "preferences": {}},
    )
    assert analysis.status_code == 200, analysis.text
    review = client.post(f"/projects/{project_id}/review/turn", json={"message": "Review"})
    assert review.status_code == 200, review.text

    calls = [json.loads(line) for line in log_path.read_text().splitlines()]
    scoring_names = {
        f"clip-1-frame-{index}.jpg" for index in range(1, len(frame_timestamps) + 1)
    }
    review_names = {
        f"frame-{index:02d}.jpg"
        for index in range(1, len(video_names) * len(frame_timestamps) + 1)
    }
    expected_by_call = []
    for call in calls:
        if any(re.fullmatch(r"@clip-\d-frame-\d\.jpg", arg) for arg in call["argv"]):
            expected_by_call.append(scoring_names)
        else:
            expected_by_call.append(review_names)
    assert expected_by_call

    forbidden_env_prefixes = ("PI_", "OPENAI_", "ANTHROPIC_", "CLAUDE_", "CODEX_")
    for call, expected_names in zip(calls, expected_by_call):
        cwd = Path(call["cwd"])
        attachments = {arg[1:] for arg in call["argv"] if arg.startswith("@")}
        assert set(call["cwd_listing"]) == expected_names
        assert attachments == expected_names
        assert {Path(path).name for path in call["opened"]} == expected_names
        assert set(call["opened"]) == {str(cwd / name) for name in expected_names}
        assert cwd.name.startswith("aca-ai-")
        assert not cwd.exists()
        assert not any(key.startswith(forbidden_env_prefixes) for key in call["env_keys"])
        logged = " ".join(call["argv"]) + call["stdin"] + json.dumps(call["env"])
        assert str(project_folder) not in logged
        assert folder_name not in logged
        assert not re.search(r"/[^\s\"']*\.(?:mp4|mov)", logged, re.IGNORECASE)
    prompts = " ".join(call["argv"][-1] for call in calls)
    assert "DJI_0001.MP4" in prompts and "DJI_0002.MOV" in prompts
