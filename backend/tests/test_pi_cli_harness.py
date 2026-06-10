import subprocess
from pathlib import Path

from src.models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence
from src.pi_cli_harness import (
    REPO_ROOT,
    PiCliUnavailableError,
    _call_pi_cli,
    _parse_pi_json_response,
    enhance_clips_with_pi_cli,
)


def make_manual_result() -> AssemblyResult:
    return AssemblyResult(
        clips=[
            ClipSuggestion(
                clip_id="clip-low",
                file_id="file-1",
                file_name="DJI_0001.MP4",
                start_sec=0,
                end_sec=4,
                duration_sec=4,
                smoothness_score=8,
                visual_interest_score=0,
                overall_score=7,
                ai_reason="Stable 8.0/10",
            ),
            ClipSuggestion(
                clip_id="clip-high",
                file_id="file-1",
                file_name="DJI_0001.MP4",
                start_sec=10,
                end_sec=15,
                duration_sec=5,
                smoothness_score=8,
                visual_interest_score=0,
                overall_score=7.5,
                ai_reason="Stable 8.0/10",
            ),
        ],
        sequence=TimelineSequence(total_duration_sec=9, clips=["clip-low", "clip-high"]),
        metadata={"local": True, "model_used": "manual_rule_based"},
    )


def make_frames(tmp_path) -> list[FrameScore]:
    frames = []
    for timestamp in [0, 2, 4, 10, 12, 15]:
        frame_path = tmp_path / f"frame_{timestamp}.jpg"
        frame_path.write_bytes(b"fake image")
        frames.append(
            FrameScore(
                timestamp=timestamp,
                frame_path=str(frame_path),
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
        )
    return frames


def test_parse_pi_json_response_accepts_fenced_json():
    raw = '```json\n{"smoothness": 8, "visual_interest": 6, "reason": "calm"}\n```'

    parsed = _parse_pi_json_response(raw)

    assert parsed == {"smoothness": 8, "visual_interest": 6, "reason": "calm"}


def test_parse_pi_json_response_extracts_object_from_prose():
    raw = 'Here is the score:\n{"smoothness": 7, "visual_interest": 9} \nHope that helps!'

    parsed = _parse_pi_json_response(raw)

    assert parsed == {"smoothness": 7, "visual_interest": 9}


def test_enhance_clips_with_pi_cli_blends_scores_and_reranks(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)

    scores = iter(
        [
            {"smoothness": 6, "visual_interest": 4, "reason": "muted"},
            {"smoothness": 9, "visual_interest": 9.5, "reason": "great reveal"},
        ]
    )

    def fake_call(frame_paths, **kwargs):
        return next(scores)

    monkeypatch.setattr("src.pi_cli_harness._call_pi_cli", fake_call)

    # Pin the model: the module-level PI_MODEL default depends on the
    # developer's .env once src.api has loaded it, so tests must not rely on it.
    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames, model="gpt-5.4-mini")

    assert used_ai is True
    # clip-high blends to 0.7*7.5 + 0.3*9.5 = 8.1, clip-low to 0.7*7 + 0.3*4 = 6.1
    assert [clip.clip_id for clip in result.clips] == ["clip-high", "clip-low"]
    assert result.clips[0].visual_interest_score == 9.5
    assert result.clips[0].overall_score == 8.1
    assert "great reveal" in result.clips[0].ai_reason
    assert result.sequence.clips == ["clip-high", "clip-low"]
    assert result.metadata["model_used"] == "gpt-5.4-mini"
    assert result.metadata["local"] is False
    assert result.harness_id == "pi_agent"


def test_enhance_clips_with_pi_cli_falls_back_when_cli_fails(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)

    def failing_call(frame_paths, **kwargs):
        raise PiCliUnavailableError("pi missing")

    monkeypatch.setattr("src.pi_cli_harness._call_pi_cli", failing_call)

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

    assert used_ai is False
    assert [clip.clip_id for clip in result.clips] == ["clip-low", "clip-high"]
    assert "fallback" in result.metadata["warning"]
    assert result.harness_id == "pi_agent"


def test_enhance_clips_aborts_on_first_failure_without_scoring_the_rest(monkeypatch, tmp_path):
    # All-or-nothing: blended and unblended scores are not comparable, so one
    # failed clip must keep the entire manual ranking and stop calling pi.
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)
    calls = []

    def failing_call(frame_paths, **kwargs):
        calls.append(frame_paths)
        raise PiCliUnavailableError("first clip failed")

    monkeypatch.setattr("src.pi_cli_harness._call_pi_cli", failing_call)

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

    assert used_ai is False
    assert len(calls) == 1
    assert [clip.clip_id for clip in result.clips] == ["clip-low", "clip-high"]
    assert [clip.overall_score for clip in result.clips] == [7.0, 7.5]
    assert "manual ranking kept" in result.metadata["warning"]


def test_enhance_clips_aborts_when_score_is_unusable(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)

    monkeypatch.setattr(
        "src.pi_cli_harness._call_pi_cli",
        lambda frame_paths, **kwargs: {"unexpected": "shape"},
    )

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

    assert used_ai is False
    assert "unusable score" in result.metadata["warning"]


def test_enhance_clips_caches_scores_and_reuses_them(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)
    # Distinct content per frame: the cache is content-addressed, and the
    # fixture's identical bytes would (correctly) collapse both clips to one key.
    for i, frame in enumerate(frames):
        Path(frame.frame_path).write_bytes(f"frame-{i}".encode())
    cache_dir = tmp_path / "ai-scores"
    calls = []

    scores = {
        "clip-low": {"smoothness": 6, "visual_interest": 4, "reason": "muted"},
        "clip-high": {"smoothness": 9, "visual_interest": 9.5, "reason": "great reveal"},
    }
    answers = iter([scores["clip-low"], scores["clip-high"]])

    def counting_call(frame_paths, **kwargs):
        calls.append(frame_paths)
        return next(answers)

    monkeypatch.setattr("src.pi_cli_harness._call_pi_cli", counting_call)

    first, used_ai_first = enhance_clips_with_pi_cli(
        manual_result, frames, model="gpt-5.4-mini", cache_dir=cache_dir
    )
    # Second run: same frames/model/prompt must be served from cache, no calls.
    second, used_ai_second = enhance_clips_with_pi_cli(
        manual_result, frames, model="gpt-5.4-mini", cache_dir=cache_dir
    )

    assert used_ai_first is True and used_ai_second is True
    assert len(calls) == 2
    assert [c.clip_id for c in first.clips] == [c.clip_id for c in second.clips]
    assert [c.overall_score for c in first.clips] == [c.overall_score for c in second.clips]
    assert len(list(cache_dir.glob("*.json"))) == 2


def test_enhance_clips_records_per_clip_scoring_durations(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)
    answers = iter(
        [
            {"smoothness": 6, "visual_interest": 4, "reason": "muted"},
            {"smoothness": 9, "visual_interest": 9.5, "reason": "great reveal"},
        ]
    )
    monkeypatch.setattr(
        "src.pi_cli_harness._call_pi_cli", lambda frame_paths, **kwargs: next(answers)
    )

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

    assert used_ai is True
    durations = result.metadata["scoring_seconds_per_clip"]
    assert len(durations) == 2
    assert all(isinstance(d, float) and d >= 0 for d in durations)


def test_call_pi_cli_raises_clear_error_on_nonzero_exit(monkeypatch):
    def fake_run(command, **kwargs):
        assert command[0] == "pi"
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="not logged in")

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        _call_pi_cli(["/tmp/frame.jpg"], pi_bin="pi", timeout_sec=1)
    except PiCliUnavailableError as exc:
        assert "not logged in" in str(exc)
    else:
        raise AssertionError("Expected PiCliUnavailableError")


def test_call_pi_cli_parses_stdout_json(monkeypatch):
    captured = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='{"smoothness": 8, "visual_interest": 6, "reason": "ok"}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = _call_pi_cli(["/tmp/frame.jpg"], pi_bin="pi", timeout_sec=1)

    assert result == {"smoothness": 8, "visual_interest": 6, "reason": "ok"}
    assert "--tools" in captured["command"]
    assert "read" in captured["command"]
    assert "@/tmp/frame.jpg" in captured["command"]
    assert captured["kwargs"]["stdin"] == subprocess.DEVNULL
    assert captured["kwargs"]["cwd"] == str(REPO_ROOT)


def test_call_pi_cli_timeout_reports_diagnostics(monkeypatch):
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(
            cmd=command,
            timeout=12,
            output="partial stdout",
            stderr="partial stderr",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        _call_pi_cli(["/tmp/frame-a.jpg", "/tmp/frame-b.jpg"], pi_bin="pi", timeout_sec=12)
    except PiCliUnavailableError as exc:
        message = str(exc)
        assert "timed out after 12s" in message
        assert "frames=2" in message
        assert "frame-a.jpg" in message
        assert "partial stdout" in message
        assert "partial stderr" in message
    else:
        raise AssertionError("Expected PiCliUnavailableError")


def test_call_pi_cli_raises_when_binary_missing(monkeypatch):
    def fake_run(command, **kwargs):
        raise FileNotFoundError("pi")

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        _call_pi_cli(["/tmp/frame.jpg"], pi_bin="pi", timeout_sec=1)
    except PiCliUnavailableError as exc:
        assert "not found" in str(exc)
    else:
        raise AssertionError("Expected PiCliUnavailableError")
