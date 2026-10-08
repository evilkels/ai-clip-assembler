import json
import re

import pytest
from fastapi.testclient import TestClient

from src import api
from src.ai_engines.pi import PiEngine
from src.ai_engines.payload import PayloadError, stage, staged, strip_paths, validate_images
from src.ai_engines.types import AiReply, AiRequest
from src.ai_scoring import enhance_clips
from src.models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence
from src.review_agent import engine_review_agent
from support import fake_engine


def request(images, samples_dir, **kwargs):
    return AiRequest(images=images, samples_dir=samples_dir, text="look", schema={"type": "object"}, timeout_sec=1, **kwargs)


def test_rejects_images_outside_samples_dir(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"outside")
    with pytest.raises(PayloadError):
        validate_images([outside], samples, 12)


def test_rejects_symlink_that_resolves_outside_samples_dir(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"outside")
    link = samples / "link.jpg"
    link.symlink_to(outside)
    with pytest.raises(PayloadError):
        validate_images([link], samples, 12)


def test_rejects_non_jpg_and_more_than_limit(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    png = samples / "frame.png"
    png.write_bytes(b"png")
    with pytest.raises(PayloadError):
        validate_images([png], samples, 12)
    jpgs = []
    for i in range(2):
        path = samples / f"{i}.jpg"
        path.write_bytes(b"jpg")
        jpgs.append(path)
    with pytest.raises(PayloadError):
        validate_images(jpgs, samples, 1)


def test_stage_copies_only_staged_images_and_context_cleans_up(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    images = []
    for i in range(2):
        path = samples / f"original-{i}.jpg"
        path.write_bytes(f"image-{i}".encode())
        images.append(path)
    req = request(images, samples)

    with staged(req) as staged_request:
        assert sorted(path.name for path in staged_request.cwd.iterdir()) == ["frame-01.jpg", "frame-02.jpg"]
        assert [path.read_bytes() for path in staged_request.images] == [b"image-0", b"image-1"]
        assert staged_request.names == ["frame-01.jpg", "frame-02.jpg"]
        scratch = staged_request.cwd
    assert not scratch.exists()


def test_context_cleans_up_when_body_raises(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    path = samples / "one.jpg"
    path.write_bytes(b"jpg")
    with pytest.raises(RuntimeError):
        with staged(request([path], samples)) as staged_request:
            scratch = staged_request.cwd
            raise RuntimeError("stop")
    assert not scratch.exists()


def test_rejects_invalid_or_duplicate_image_names(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    images = []
    for i in range(2):
        path = samples / f"{i}.jpg"
        path.write_bytes(b"jpg")
        images.append(path)
    for names in (["../secret.jpg", "frame-02.jpg"], ["frame-01.jpg", "frame-01.jpg"], ["frame-01.jpg"]):
        with pytest.raises(PayloadError):
            stage(request(images, samples, image_names=names))


def test_strip_paths_replaces_embedded_absolute_paths_but_keeps_relative_text():
    text = ('print("/Users/editor/My Project/private-folder/DJI_0001.MP4") '
            'Opened /Users/editor/My Project/DJI_0002.MOV now '
            'file:///Users/editor/My Project/a.mp4')
    assert strip_paths(text) == 'print("DJI_0001.MP4") Opened DJI_0002.MOV now file://a.mp4'
    unchanged = (
        "https://claude.ai/download 5/5 k/v cut A / B / C 14:00 "
        "clips/a.mp4 frame-01.jpg"
    )
    assert strip_paths(unchanged) == unchanged


def test_text_has_no_paths(tmp_path):
    project_folder = tmp_path / "secret folder fixture"
    samples = project_folder / "clipassembler" / "samples"
    sample_folder = samples / "DJI_0001.MP4"
    sample_folder.mkdir(parents=True)
    frame_scores = []
    for index, timestamp in enumerate((1.0, 2.0), start=1):
        path = sample_folder / f"DJI_0001.MP4_{int(timestamp * 1000):06d}.jpg"
        path.write_bytes(f"image-{index}".encode())
        frame_scores.append(FrameScore(
            timestamp=timestamp, frame_path=str(path), motion_stability=8,
            smoothness_score=8, sharpness_score=8, exposure_score=8,
            contrast_score=8, visual_interest_score=0, overall_score=8,
            blur_score=8, brightness=0.8, contrast=0.8, scene_id=1,
            is_keyframe=True, turn_rate_deg_per_sec=0,
        ))
    clip = ClipSuggestion(
        clip_id="clip-1", file_id="DJI_0001.MP4", file_name="DJI_0001.MP4",
        start_sec=0, end_sec=4, duration_sec=4, smoothness_score=8,
        visual_interest_score=0, overall_score=8, ai_reason="Stable",
    )
    result = AssemblyResult(
        clips=[clip], sequence=TimelineSequence(total_duration_sec=4, clips=["clip-1"]),
    )

    class RecordingEngine:
        provider = "chatgpt"

        def __init__(self):
            self.requests = []

        def run(self, ai_request):
            self.requests.append(ai_request)
            if "scores" in ai_request.schema_.get("required", []):
                return AiReply(
                    provider="chatgpt",
                    data={"scores": [{"k": 1, "visual_interest": 7, "reason": "Good"}]},
                    raw_text="{}", elapsed_sec=0,
                )
            return AiReply(
                provider="chatgpt", data={"message": "Ready.", "operations": []},
                raw_text="{}", elapsed_sec=0,
            )

    recorder = RecordingEngine()
    enhance_clips(recorder, result, frame_scores, samples_dir=samples)

    api.projects.clear()
    client = TestClient(api.app)
    project_folder.mkdir(parents=True, exist_ok=True)
    (project_folder / "DJI_0001.MP4").write_bytes(b"source video")
    project_id = client.post(
        "/projects/from-folder", json={"folder_path": str(project_folder)}
    ).json()["project_id"]
    api.projects[project_id]["clips"] = [clip.model_dump()]
    candidates, candidate_frames, _agent, _fallback_versions = api._review_inputs(project_id)
    review = engine_review_agent(recorder)(
        {
            "user_message": f"Please review {project_folder / 'DJI_0001.MP4'}",
            "candidates": candidates,
            "candidate_frames": candidate_frames,
            "samples_dir": samples,
            "history": [{"script": {"source": 'print("/tmp/secret-folder/DJI_0001.MP4")'},
                         "log": ["Opened /tmp/secret-folder/DJI_0001.MP4"]}],
            "timeline": {"notes": "/tmp/secret-folder/DJI_0001.MP4"},
        }
    )
    assert review["message"] == "Ready."
    assert "secret-folder" not in recorder.requests[-1].text
    assert "secret folder fixture" not in recorder.requests[-1].text
    assert "/tmp/" not in recorder.requests[-1].text
    assert "DJI_0001.MP4" in recorder.requests[-1].text
    requests = [recorder.requests[0], recorder.requests[-1]]
    bin_path, log_path = fake_engine(tmp_path / "fake", reply='{"message":"Ready.","operations":[]}')
    for ai_request in requests:
        assert not re.search(r"(?<![\w.])/[\S\"']+/", ai_request.text)
        assert "secret-folder" not in ai_request.text
        assert "DJI_0001.MP4" in ai_request.text
        PiEngine(str(bin_path), "openai-codex", "fake").run(ai_request)

    for call in map(json.loads, log_path.read_text().splitlines()):
        argv_text = " ".join(call["argv"])
        assert not re.search(r"(?<![\w.])/[\S\"']+/", argv_text)
        assert "secret-folder" not in argv_text
        assert "DJI_0001.MP4" in argv_text
