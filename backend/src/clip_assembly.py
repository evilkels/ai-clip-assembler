import uuid
from dataclasses import dataclass
from typing import Iterable, List

from .models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence
from .scoring_weights import DRONE_SCORE_WEIGHTS


@dataclass(frozen=True)
class AssemblyPreferences:
    min_clip_duration_sec: float = 3.0
    max_clip_duration_sec: float = 15.0
    smoothness_threshold: float = 7.0
    target_duration_sec: float = 120.0


def average(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return round(sum(values_list) / len(values_list), 2)


def weighted_overall(frames: List[FrameScore]) -> float:
    return round(
        average(frame.smoothness_score for frame in frames) * DRONE_SCORE_WEIGHTS["smoothness"]
        + average(frame.sharpness_score for frame in frames) * DRONE_SCORE_WEIGHTS["sharpness"]
        + average(frame.exposure_score for frame in frames) * DRONE_SCORE_WEIGHTS["exposure"]
        + average(frame.contrast_score for frame in frames) * DRONE_SCORE_WEIGHTS["contrast"],
        2,
    )


def split_by_duration(frames: List[FrameScore], max_duration: float) -> List[List[FrameScore]]:
    chunks = []
    current = []
    chunk_start = None
    for frame in frames:
        if chunk_start is None:
            chunk_start = frame.timestamp
        current.append(frame)
        if frame.timestamp - chunk_start >= max_duration:
            chunks.append(current)
            current = []
            chunk_start = None
    if current:
        chunks.append(current)
    return chunks


def candidate_runs(frames: List[FrameScore], threshold: float) -> List[List[FrameScore]]:
    runs = []
    current = []
    for frame in sorted(frames, key=lambda item: item.timestamp):
        if frame.smoothness_score >= threshold:
            current.append(frame)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return runs


def build_reason(frames: List[FrameScore]) -> str:
    return (
        f"Stable {average(frame.smoothness_score for frame in frames):.1f}/10, "
        f"sharp {average(frame.sharpness_score for frame in frames):.1f}/10, "
        f"exposure {average(frame.exposure_score for frame in frames):.1f}/10"
    )


def make_clip(file_id: str, file_name: str, frames: List[FrameScore]) -> ClipSuggestion:
    start = frames[0].timestamp
    end = frames[-1].timestamp
    return ClipSuggestion(
        clip_id=str(uuid.uuid4()),
        file_id=file_id,
        file_name=file_name,
        start_sec=start,
        end_sec=end,
        duration_sec=round(end - start, 3),
        smoothness_score=average(frame.smoothness_score for frame in frames),
        visual_interest_score=0.0,
        overall_score=weighted_overall(frames),
        ai_reason=build_reason(frames),
        suggested_speed=1.0,
        suggested_transition=None,
        tags=["drone", "smooth"],
    )


def assemble_smooth_clips(
    file_id: str,
    file_name: str,
    frames: List[FrameScore],
    preferences: AssemblyPreferences = AssemblyPreferences(),
) -> AssemblyResult:
    clips = []
    for run in candidate_runs(frames, preferences.smoothness_threshold):
        for chunk in split_by_duration(run, preferences.max_clip_duration_sec):
            duration = chunk[-1].timestamp - chunk[0].timestamp
            if duration >= preferences.min_clip_duration_sec:
                clips.append(make_clip(file_id, file_name, chunk))

    ranked = sorted(clips, key=lambda clip: clip.overall_score, reverse=True)
    selected = []
    total = 0.0
    for clip in ranked:
        if total >= preferences.target_duration_sec:
            break
        selected.append(clip)
        total += clip.duration_sec

    return AssemblyResult(
        clips=selected,
        sequence=TimelineSequence(
            total_duration_sec=round(sum(clip.duration_sec for clip in selected), 3),
            clips=[clip.clip_id for clip in selected],
        ),
        metadata={"local": True, "model_used": "manual_rule_based"},
    )
