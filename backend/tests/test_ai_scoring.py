from src.ai_engines.messages import make_failure
from src.ai_engines.types import AiReply
from src.ai_scoring import enhance_clips
from src.models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence


class RecordingEngine:
    provider = "chatgpt"
    cache_identity = "test/model"

    def __init__(self):
        self.requests = []

    def run(self, request):
        self.requests.append(request)
        return AiReply(
            provider="chatgpt",
            data={"scores": [
                {"k": i, "visual_interest": 8, "reason": "clear subject"}
                for i in range(1, len(request.text.splitlines()) // 2 + 1)
            ]},
            raw_text="",
            elapsed_sec=0.1,
        )


def _fixtures(tmp_path, count=12):
    clips, frames = [], []
    for index in range(count):
        name = f"DJI_{index:04}.MP4"
        clips.append(ClipSuggestion(
            clip_id=f"clip-{index}", file_id="file-1", file_name=name,
            start_sec=index * 10, end_sec=index * 10 + 4, duration_sec=4, smoothness_score=8,
            visual_interest_score=0, overall_score=7, ai_reason="Stable",
        ))
        samples = tmp_path / "samples"
        samples.mkdir(exist_ok=True)
        path = samples / f"frame-{index}.jpg"
        path.write_bytes(f"frame-{index}".encode())
        frames.append(FrameScore(
            timestamp=index * 10 + 1, frame_path=str(path), motion_stability=8,
            smoothness_score=8, sharpness_score=8, exposure_score=8,
            contrast_score=8, overall_score=8, blur_score=8, brightness=0.5,
            contrast=0.5,
        ))
    result = AssemblyResult(
        clips=clips, sequence=TimelineSequence(total_duration_sec=48, clips=[c.clip_id for c in clips]),
    )
    return result, frames


def test_twelve_clips_are_scored_in_three_batched_requests(tmp_path):
    result, frames = _fixtures(tmp_path)
    engine = RecordingEngine()

    outcome = enhance_clips(
        engine, result, frames, samples_dir=tmp_path, cache_dir=tmp_path / "cache"
    )

    assert outcome.used_ai is True
    assert [len(request.images) for request in engine.requests] == [5, 5, 2]
    assert [request.image_names for request in engine.requests] == [
        [f"clip-{i}-frame-1.jpg" for i in range(1, 6)],
        [f"clip-{i}-frame-1.jpg" for i in range(1, 6)],
        [f"clip-{i}-frame-1.jpg" for i in range(1, 3)],
    ]
    assert all("/" not in request.text for request in engine.requests)


def test_missing_score_is_retried_in_the_next_request(tmp_path):
    result, frames = _fixtures(tmp_path, 7)

    class MissingOnceEngine(RecordingEngine):
        def run(self, request):
            self.requests.append(request)
            replies = [
                {"scores": [
                    {"k": 1, "visual_interest": 1, "reason": "clip one"},
                    {"k": 2, "visual_interest": 2, "reason": "clip two"},
                    {"k": 4, "visual_interest": 4, "reason": "clip four"},
                    {"k": 5, "visual_interest": 5, "reason": "clip five"},
                ]},
                {"scores": [
                    {"k": 1, "visual_interest": 3, "reason": "clip three"},
                    {"k": 2, "visual_interest": 6, "reason": "clip six"},
                    {"k": 3, "visual_interest": 7, "reason": "clip seven"},
                ]},
            ]
            return AiReply(
                provider="chatgpt", data=replies[len(self.requests) - 1], raw_text="", elapsed_sec=0.1
            )

    engine = MissingOnceEngine()
    outcome = enhance_clips(engine, result, frames, samples_dir=tmp_path)

    assert outcome.used_ai is True
    assert len(engine.requests) == 2
    assert engine.requests[0].image_names == [f"clip-{index}-frame-1.jpg" for index in range(1, 6)]
    assert [line for line in engine.requests[0].text.splitlines() if "→" in line] == [
        f"{index} → DJI_{index - 1:04}.MP4 {((index - 1) * 10):.1f}–{((index - 1) * 10 + 4):.1f} s"
        for index in range(1, 6)
    ]
    assert engine.requests[1].image_names == [
        "clip-1-frame-1.jpg", "clip-2-frame-1.jpg", "clip-3-frame-1.jpg"
    ]
    assert [line for line in engine.requests[1].text.splitlines() if "→" in line] == [
        "1 → DJI_0002.MP4 20.0–24.0 s",
        "2 → DJI_0005.MP4 50.0–54.0 s",
        "3 → DJI_0006.MP4 60.0–64.0 s",
    ]
    assert {clip.clip_id: clip.visual_interest_score for clip in outcome.result.clips} == {
        f"clip-{index}": index + 1 for index in range(7)
    }


def test_second_batch_failure_keeps_first_batch_cached_and_manual(tmp_path):
    result, frames = _fixtures(tmp_path, 12)

    class FailingSecondEngine(RecordingEngine):
        def run(self, request):
            self.requests.append(request)
            if len(self.requests) == 2:
                return make_failure("usage_limit", "chatgpt")
            return AiReply(
                provider="chatgpt",
                data={"scores": [
                    {"k": index, "visual_interest": 8, "reason": "clear subject"}
                    for index in range(1, 6)
                ]},
                raw_text="",
                elapsed_sec=0.1,
            )

    engine = FailingSecondEngine()
    cache = tmp_path / "cache"
    outcome = enhance_clips(engine, result, frames, samples_dir=tmp_path, cache_dir=cache)

    assert outcome.used_ai is False
    assert outcome.failure.kind == "usage_limit"
    assert [clip.overall_score for clip in outcome.result.clips] == [7] * 12
    assert len(list(cache.glob("*.json"))) == 5

    resumed_engine = RecordingEngine()
    resumed = enhance_clips(
        resumed_engine, result, frames, samples_dir=tmp_path, cache_dir=cache
    )
    assert resumed.used_ai is True
    assert [len(request.images) for request in resumed_engine.requests] == [5, 2]
    assert resumed.result.clips[0].visual_interest_score == 8

    cached_engine = RecordingEngine()
    cached = enhance_clips(
        cached_engine, result, frames, samples_dir=tmp_path, cache_dir=cache
    )
    assert cached.used_ai is True
    assert cached_engine.requests == []
