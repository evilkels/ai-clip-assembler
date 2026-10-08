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


def _reply(request, omit=None):
    count = len(request.text.splitlines()) // 2
    return AiReply(
        provider="chatgpt",
        data={"scores": [
            {"k": i, "visual_interest": 8, "reason": "clear subject"}
            for i in range(1, count + 1) if i != omit
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
    result, frames = _fixtures(tmp_path, 6)

    class MissingOnceEngine(RecordingEngine):
        def run(self, request):
            self.requests.append(request)
            return _reply(request, omit=3 if len(self.requests) == 1 else None)

    engine = MissingOnceEngine()
    outcome = enhance_clips(engine, result, frames, samples_dir=tmp_path)

    assert outcome.used_ai is True
    assert len(engine.requests) == 2
    assert "1 → DJI_0002.MP4" in engine.requests[1].text
    assert "1 → DJI_0002.MP4" not in engine.requests[0].text


def test_second_batch_failure_keeps_first_batch_cached_and_manual(tmp_path):
    result, frames = _fixtures(tmp_path, 12)

    class FailingSecondEngine(RecordingEngine):
        def run(self, request):
            self.requests.append(request)
            if len(self.requests) == 2:
                return make_failure("usage_limit", "chatgpt")
            return _reply(request)

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
