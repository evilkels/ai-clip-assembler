from unittest.mock import MagicMock

import httpx
import pytest

from src.local_qwen_harness import (
    OllamaUnavailableError,
    _call_ollama_for_batch,
    _encode_image,
    _parse_ollama_json_response,
    _sample_frames_for_clip,
    enhance_clips_with_local_qwen,
)
from src.models import ClipSuggestion, FrameScore, TimelineSequence
from src.clip_assembly import AssemblyResult


class TestParseOllamaJsonResponse:
    def test_parses_plain_json_array(self):
        raw = '[{"smoothness": 8, "visual_interest": 7, "reason": "good"}]'
        result = _parse_ollama_json_response(raw)
        assert result == [{"smoothness": 8, "visual_interest": 7, "reason": "good"}]

    def test_parses_markdown_fenced_json_array(self):
        raw = "```json\n[{\"smoothness\": 8, \"visual_interest\": 7, \"reason\": \"good\"}]\n```"
        result = _parse_ollama_json_response(raw)
        assert result == [{"smoothness": 8, "visual_interest": 7, "reason": "good"}]

    def test_parses_object_wrapped_array(self):
        raw = '{"results": [{"smoothness": 8, "visual_interest": 7, "reason": "good"}]}'
        result = _parse_ollama_json_response(raw)
        assert result == [{"smoothness": 8, "visual_interest": 7, "reason": "good"}]

    def test_parses_single_object_as_list(self):
        raw = '{"smoothness": 8, "visual_interest": 7, "reason": "good"}'
        result = _parse_ollama_json_response(raw)
        assert result == [{"smoothness": 8, "visual_interest": 7, "reason": "good"}]

    def test_raises_value_error_for_non_json(self):
        with pytest.raises(ValueError):
            _parse_ollama_json_response("not json at all")


class TestEncodeImage:
    def test_encodes_image_to_base64(self, tmp_path):
        image_path = tmp_path / "frame.jpg"
        image_path.write_bytes(b"fake image data")
        encoded = _encode_image(str(image_path))
        import base64
        assert base64.b64decode(encoded) == b"fake image data"


class TestCallOllamaForBatch:
    def test_returns_parsed_scores_on_success(self, monkeypatch):
        monkeypatch.setattr(
            "src.local_qwen_harness._encode_image", lambda path: "fakebase64"
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": '[{"smoothness": 8, "visual_interest": 7, "reason": "nice"}]'}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        monkeypatch.setattr("httpx.Client", lambda **kwargs: mock_client)

        result = _call_ollama_for_batch(["/tmp/frame.jpg"])
        assert result == [{"smoothness": 8, "visual_interest": 7, "reason": "nice"}]

    def test_raises_ollama_unavailable_on_connect_error(self, monkeypatch):
        monkeypatch.setattr(
            "src.local_qwen_harness._encode_image", lambda path: "fakebase64"
        )
        def raise_connect_error(*args, **kwargs):
            raise httpx.ConnectError("Connection refused")

        mock_client = MagicMock()
        mock_client.post = raise_connect_error
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        monkeypatch.setattr("httpx.Client", lambda **kwargs: mock_client)

        with pytest.raises(OllamaUnavailableError):
            _call_ollama_for_batch(["/tmp/frame.jpg"])

    def test_raises_ollama_unavailable_on_empty_response(self, monkeypatch):
        monkeypatch.setattr(
            "src.local_qwen_harness._encode_image", lambda path: "fakebase64"
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": ""}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        monkeypatch.setattr("httpx.Client", lambda **kwargs: mock_client)

        with pytest.raises(OllamaUnavailableError):
            _call_ollama_for_batch(["/tmp/frame.jpg"])

    def test_raises_ollama_unavailable_on_invalid_json(self, monkeypatch):
        monkeypatch.setattr(
            "src.local_qwen_harness._encode_image", lambda path: "fakebase64"
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": "not json"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        monkeypatch.setattr("httpx.Client", lambda **kwargs: mock_client)

        with pytest.raises(OllamaUnavailableError):
            _call_ollama_for_batch(["/tmp/frame.jpg"])


class TestSampleFramesForClip:
    def test_samples_all_frames_when_fewer_than_max(self):
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=5,
            duration_sec=5,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8,
            ai_reason="stable",
        )
        frames = [
            FrameScore(timestamp=0, frame_path="/tmp/0.jpg", motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
            FrameScore(timestamp=2, frame_path="/tmp/2.jpg", motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        result = _sample_frames_for_clip(clip, frames, max_frames=4)
        assert result == ["/tmp/0.jpg", "/tmp/2.jpg"]

    def test_evenly_samples_when_more_than_max(self):
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=10,
            duration_sec=10,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8,
            ai_reason="stable",
        )
        frames = [
            FrameScore(timestamp=i, frame_path=f"/tmp/{i}.jpg", motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5)
            for i in range(11)
        ]
        result = _sample_frames_for_clip(clip, frames, max_frames=4)
        assert len(result) == 4
        assert result[0] == "/tmp/0.jpg"
        assert result[-1] == "/tmp/10.jpg"

    def test_returns_empty_when_no_frames_in_range(self):
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=5,
            end_sec=10,
            duration_sec=5,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8,
            ai_reason="stable",
        )
        frames = [
            FrameScore(timestamp=0, frame_path="/tmp/0.jpg", motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        result = _sample_frames_for_clip(clip, frames, max_frames=4)
        assert result == []


class TestEnhanceClipsWithLocalQwen:
    def test_enhances_clips_and_re_ranks(self, monkeypatch, tmp_path):
        # Create fake frame images on disk so _encode_image works
        for i in range(6):
            (tmp_path / f"frame_{i}.jpg").write_bytes(b"fake")

        frames = [
            FrameScore(timestamp=i, frame_path=str(tmp_path / f"frame_{i}.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5)
            for i in range(6)
        ]

        clip_low = ClipSuggestion(
            clip_id="low",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=7.0,
            ai_reason="Stable 8.0/10",
        )
        clip_high = ClipSuggestion(
            clip_id="high",
            file_id="f1",
            file_name="test.mp4",
            start_sec=3,
            end_sec=5,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )

        manual_result = AssemblyResult(
            clips=[clip_low, clip_high],
            sequence=TimelineSequence(total_duration_sec=4, clips=["low", "high"]),
            metadata={"local": True, "model_used": "manual_rule_based"},
        )

        def fake_call(batch_paths, **kwargs):
            # Return high visual interest for frames in clip_high, low for clip_low
            scores = []
            for path in batch_paths:
                if "frame_3" in path or "frame_4" in path or "frame_5" in path:
                    scores.append({"smoothness": 8, "visual_interest": 9.5, "reason": "great composition"})
                else:
                    scores.append({"smoothness": 8, "visual_interest": 2.0, "reason": "boring"})
            return scores

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", fake_call)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames, batch_size=8)

        assert used_ai is True
        assert len(result.clips) == 2
        # high should now outrank low even more due to visual interest
        high_clip = next(c for c in result.clips if c.clip_id == "high")
        low_clip = next(c for c in result.clips if c.clip_id == "low")
        assert high_clip.overall_score > low_clip.overall_score
        assert high_clip.visual_interest_score == 9.5
        assert low_clip.visual_interest_score == 2.0
        assert "AI: great composition" in high_clip.ai_reason
        assert "AI: boring" in low_clip.ai_reason
        assert result.metadata["model_used"] == "qwen3-vl:8b"

    def test_fallback_when_ollama_unavailable(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def raise_unavailable(*args, **kwargs):
            raise OllamaUnavailableError("Connection refused")

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", raise_unavailable)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is False
        assert len(result.clips) == 1
        assert result.clips[0].clip_id == "c1"
        assert result.clips[0].overall_score == 8.0
        assert result.metadata["warning"] == "Local Qwen fallback: Ollama/model unavailable"

    def test_returns_manual_when_no_frames_for_clips(self):
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=5,
            end_sec=10,
            duration_sec=5,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=5, clips=["c1"]),
            metadata={},
        )
        frames = [
            FrameScore(timestamp=0, frame_path="/tmp/0.jpg", motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is False
        assert len(result.clips) == 1
        assert result.metadata["warning"] == "Local Qwen fallback: no frames available for analysis"

    def test_score_count_mismatch_falls_back(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        (tmp_path / "frame_1.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
            FrameScore(timestamp=1, frame_path=str(tmp_path / "frame_1.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def return_too_many_scores(batch_paths, **kwargs):
            return [{"smoothness": 8, "visual_interest": 7, "reason": "ok"}] * (len(batch_paths) + 2)

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", return_too_many_scores)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is False
        assert result.clips[0].overall_score == 8.0

    def test_score_count_too_few_falls_back(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        (tmp_path / "frame_1.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
            FrameScore(timestamp=1, frame_path=str(tmp_path / "frame_1.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def return_too_few_scores(batch_paths, **kwargs):
            return [{"smoothness": 8, "visual_interest": 7, "reason": "ok"}]

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", return_too_few_scores)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is False

    def test_no_usable_ai_scores_returns_used_ai_false(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def return_empty_scores(batch_paths, **kwargs):
            return [{} for _ in batch_paths]

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", return_empty_scores)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is False
        assert result.metadata["used_ai"] is False
        assert "no usable scores" in result.metadata["warning"]

    def test_partial_invalid_scores_still_enhances_valid_ones(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        (tmp_path / "frame_1.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
            FrameScore(timestamp=1, frame_path=str(tmp_path / "frame_1.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def return_mixed_scores(batch_paths, **kwargs):
            return [
                {"smoothness": 8, "visual_interest": 9, "reason": "nice"},
                {},  # invalid score object
            ]

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", return_mixed_scores)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is True
        assert result.metadata["partial_enhancement"] is True

    def test_metadata_includes_used_ai_on_success(self, monkeypatch, tmp_path):
        (tmp_path / "frame_0.jpg").write_bytes(b"fake")
        frames = [
            FrameScore(timestamp=0, frame_path=str(tmp_path / "frame_0.jpg"), motion_stability=8, smoothness_score=8, sharpness_score=8, exposure_score=8, contrast_score=8, overall_score=8, blur_score=8, brightness=0.5, contrast=0.5),
        ]
        clip = ClipSuggestion(
            clip_id="c1",
            file_id="f1",
            file_name="test.mp4",
            start_sec=0,
            end_sec=2,
            duration_sec=2,
            smoothness_score=8,
            visual_interest_score=0,
            overall_score=8.0,
            ai_reason="Stable 8.0/10",
        )
        manual_result = AssemblyResult(
            clips=[clip],
            sequence=TimelineSequence(total_duration_sec=2, clips=["c1"]),
            metadata={},
        )

        def fake_call(batch_paths, **kwargs):
            return [{"smoothness": 8, "visual_interest": 7, "reason": "ok"} for _ in batch_paths]

        monkeypatch.setattr("src.local_qwen_harness._call_ollama_for_batch", fake_call)

        result, used_ai = enhance_clips_with_local_qwen(manual_result, frames)

        assert used_ai is True
        assert result.metadata["used_ai"] is True
        assert result.metadata["clips_enhanced"] >= 1
