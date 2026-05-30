import subprocess

from src.models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence
from src.pi_cli_harness import (
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

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

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


def test_enhance_clips_with_pi_cli_partial_when_one_clip_fails(monkeypatch, tmp_path):
    manual_result = make_manual_result()
    frames = make_frames(tmp_path)

    calls = iter(
        [
            PiCliUnavailableError("first clip failed"),
            {"smoothness": 9, "visual_interest": 9.5, "reason": "great reveal"},
        ]
    )

    def flaky_call(frame_paths, **kwargs):
        outcome = next(calls)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("src.pi_cli_harness._call_pi_cli", flaky_call)

    result, used_ai = enhance_clips_with_pi_cli(manual_result, frames)

    assert used_ai is True
    assert result.metadata["partial_enhancement"] is True
    assert result.metadata["clips_enhanced"] == 1
    assert result.metadata["clips_total"] == 2


def test_call_pi_cli_raises_clear_error_on_nonzero_exit(monkeypatch):
    def fake_run(command, **kwargs):
        assert command[0] == "pi"
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="not logged in")

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        _call_pi_cli(["/tmp/frame.jpg"], timeout_sec=1)
    except PiCliUnavailableError as exc:
        assert "not logged in" in str(exc)
    else:
        raise AssertionError("Expected PiCliUnavailableError")


def test_call_pi_cli_parses_stdout_json(monkeypatch):
    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='{"smoothness": 8, "visual_interest": 6, "reason": "ok"}',
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = _call_pi_cli(["/tmp/frame.jpg"], timeout_sec=1)

    assert result == {"smoothness": 8, "visual_interest": 6, "reason": "ok"}


def test_call_pi_cli_raises_when_binary_missing(monkeypatch):
    def fake_run(command, **kwargs):
        raise FileNotFoundError("pi")

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        _call_pi_cli(["/tmp/frame.jpg"], timeout_sec=1)
    except PiCliUnavailableError as exc:
        assert "not found" in str(exc)
    else:
        raise AssertionError("Expected PiCliUnavailableError")
