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
    max_turn_rate_deg_per_sec: float = 12.0
    max_clips_per_scene: int = 2


def average(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return round(sum(values_list) / len(values_list), 2)


def weighted_overall(frames: List[FrameScore]) -> float:
    technical = (
        average(frame.smoothness_score for frame in frames) * DRONE_SCORE_WEIGHTS["smoothness"]
        + average(frame.sharpness_score for frame in frames) * DRONE_SCORE_WEIGHTS["sharpness"]
        + average(frame.exposure_score for frame in frames) * DRONE_SCORE_WEIGHTS["exposure"]
        + average(frame.contrast_score for frame in frames) * DRONE_SCORE_WEIGHTS["contrast"]
    )
    visual = average(frame.visual_interest_score for frame in frames)
    return round(technical * 0.9 + visual * 0.1, 2)


def candidate_windows(
    frames: List[FrameScore],
    min_duration: float,
    max_duration: float,
) -> List[List[FrameScore]]:
    windows = []
    for start_index, start_frame in enumerate(frames):
        for end_index in range(start_index + 1, len(frames)):
            duration = frames[end_index].timestamp - start_frame.timestamp
            if duration > max_duration:
                break
            if duration >= min_duration:
                windows.append(frames[start_index : end_index + 1])
    return windows


def candidate_runs(
    frames: List[FrameScore],
    threshold: float,
    max_turn_rate_deg_per_sec: float = 12.0,
) -> List[List[FrameScore]]:
    runs = []
    current = []
    for frame in sorted(frames, key=lambda item: item.timestamp):
        scene_changed = current and frame.scene_id != current[-1].scene_id
        if scene_changed:
            runs.append(current)
            current = []
        if (
            frame.smoothness_score >= threshold
            and frame.turn_rate_deg_per_sec <= max_turn_rate_deg_per_sec
        ):
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
        f", max turn {max(frame.turn_rate_deg_per_sec for frame in frames):.1f}°/s"
    )


def make_clip(file_id: str, file_name: str, frames: List[FrameScore]) -> ClipSuggestion:
    start = frames[0].timestamp
    end = frames[-1].timestamp
    clip_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{file_id}:{start:.3f}:{end:.3f}"))
    return ClipSuggestion(
        clip_id=clip_id,
        file_id=file_id,
        file_name=file_name,
        scene_id=frames[0].scene_id,
        start_sec=start,
        end_sec=end,
        duration_sec=round(end - start, 3),
        smoothness_score=average(frame.smoothness_score for frame in frames),
        sharpness_score=average(frame.sharpness_score for frame in frames),
        exposure_score=average(frame.exposure_score for frame in frames),
        contrast_score=average(frame.contrast_score for frame in frames),
        max_turn_rate_deg_per_sec=round(max(frame.turn_rate_deg_per_sec for frame in frames), 2),
        visual_interest_score=average(frame.visual_interest_score for frame in frames),
        overall_score=weighted_overall(frames),
        ai_reason=build_reason(frames),
        suggested_speed=0.5
        if average(frame.smoothness_score for frame in frames) >= 9.0
        and max(frame.turn_rate_deg_per_sec for frame in frames) <= 3.0
        else 1.0,
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
    for run in candidate_runs(
        frames,
        preferences.smoothness_threshold,
        preferences.max_turn_rate_deg_per_sec,
    ):
        for window in candidate_windows(
            run,
            preferences.min_clip_duration_sec,
            preferences.max_clip_duration_sec,
        ):
            clips.append(make_clip(file_id, file_name, window))

    ranked = sorted(
        clips,
        key=lambda clip: (clip.overall_score, clip.duration_sec),
        reverse=True,
    )
    selected = []
    total = 0.0
    scene_counts = {}
    for clip in ranked:
        if total >= preferences.target_duration_sec:
            break
        if scene_counts.get(clip.scene_id, 0) >= preferences.max_clips_per_scene:
            continue
        if any(
            selected_clip.file_id == clip.file_id
            and selected_clip.start_sec < clip.end_sec
            and clip.start_sec < selected_clip.end_sec
            for selected_clip in selected
        ):
            continue
        selected.append(clip)
        total += clip.duration_sec
        scene_counts[clip.scene_id] = scene_counts.get(clip.scene_id, 0) + 1

    return AssemblyResult(
        clips=selected,
        sequence=TimelineSequence(
            total_duration_sec=round(sum(clip.duration_sec for clip in selected), 3),
            clips=[clip.clip_id for clip in selected],
        ),
        metadata={"local": True, "model_used": "manual_rule_based"},
    )
