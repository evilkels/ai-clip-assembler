import math
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .models import AssemblyResult, ClipSuggestion, FrameScore, TimelineSequence
from .scoring_weights import DRONE_SCORE_WEIGHTS

# Overall-score points (0-10 scale) a longer window may trail the best one by
# and still be preferred: one smoothness point moves the overall score by 0.54.
LONGER_WINDOW_SCORE_TOLERANCE = 0.5
# A Scene keeps max_clips_per_scene candidates per started minute of footage.
SCENE_CAP_WINDOW_SEC = 60.0


@dataclass(frozen=True)
class AssemblyPreferences:
    min_clip_duration_sec: float = 3.0
    max_clip_duration_sec: float = 15.0
    smoothness_threshold: float = 6.0
    target_duration_sec: float = 120.0
    max_turn_rate_deg_per_sec: float = 16.0
    max_clips_per_scene: int = 4
    max_candidates_per_video: int = 30


@dataclass(frozen=True)
class CandidateWindow:
    frames: List[FrameScore]
    start_sec: float
    end_sec: float


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
    scene_end_sec: Optional[float] = None,
) -> List[CandidateWindow]:
    windows = []
    timestamps = [frame.timestamp for frame in frames]
    gaps = [b - a for a, b in zip(timestamps, timestamps[1:]) if b > a]
    sample_interval = median(gaps) if gaps else 1.0
    for start_index, start_frame in enumerate(frames):
        for end_index in range(start_index + 1, len(frames)):
            end_sec = frames[end_index].timestamp
            duration = end_sec - start_frame.timestamp
            if duration < min_duration and scene_end_sec is not None:
                end_sec = min(scene_end_sec, end_sec + sample_interval)
                duration = end_sec - start_frame.timestamp
            if duration > max_duration:
                break
            if duration >= min_duration:
                windows.append(
                    CandidateWindow(
                        frames=frames[start_index : end_index + 1],
                        start_sec=start_frame.timestamp,
                        end_sec=end_sec,
                    )
                )
    return windows


def select_windows(
    windows: List[CandidateWindow],
    *,
    limit: int,
    exclude: Sequence[Tuple[float, float]] = (),
    score_tolerance: float = LONGER_WINDOW_SCORE_TOLERANCE,
) -> List[CandidateWindow]:
    """Up to `limit` non-overlapping windows, sorted by start. Each pick is the
    longest free window scoring within `score_tolerance` of the best free one.
    Windows may not overlap `exclude` ranges; touching is allowed."""
    claimed = list(exclude)
    scored = [(window, weighted_overall(window.frames)) for window in windows]
    picked: List[CandidateWindow] = []
    while len(picked) < limit:
        free = [
            (window, score)
            for window, score in scored
            if not any(window.start_sec < c_end and window.end_sec > c_start for c_start, c_end in claimed)
        ]
        if not free:
            break
        best = max(score for _, score in free)
        window, _ = min(
            (item for item in free if item[1] >= best - score_tolerance),
            key=lambda item: (-(item[0].end_sec - item[0].start_sec), -item[1], item[0].start_sec),
        )
        picked.append(window)
        claimed.append((window.start_sec, window.end_sec))
    return sorted(picked, key=lambda window: window.start_sec)


def scene_cap(preferences: AssemblyPreferences, scene_duration_sec: float) -> int:
    """Candidates one Scene may keep: the per-scene cap for every started
    minute of footage, bounded by the per-video cap."""
    minutes = max(1, math.ceil(scene_duration_sec / SCENE_CAP_WINDOW_SEC))
    return min(preferences.max_clips_per_scene * minutes, preferences.max_candidates_per_video)


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


def make_clip(
    file_id: str,
    file_name: str,
    window: CandidateWindow,
    *,
    fallback: bool = False,
) -> ClipSuggestion:
    frames = window.frames
    start = window.start_sec
    end = window.end_sec
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
        ai_reason=(f"{build_reason(frames)}; fallback for scene coverage" if fallback else build_reason(frames)),
        suggested_speed=0.5
        if average(frame.smoothness_score for frame in frames) >= 9.0
        and max(frame.turn_rate_deg_per_sec for frame in frames) <= 3.0
        else 1.0,
        suggested_transition=None,
        tags=["drone", "fallback"] if fallback else ["drone", "smooth"],
    )


def _rank_clips(clips: List[ClipSuggestion]) -> List[ClipSuggestion]:
    return sorted(
        clips,
        key=lambda clip: (clip.overall_score, clip.duration_sec),
        reverse=True,
    )


def _bounded_scene_pool(
    clips: List[ClipSuggestion],
    preferences: AssemblyPreferences,
    scene_caps: Dict[int, int],
) -> List[ClipSuggestion]:
    by_scene: Dict[int, List[ClipSuggestion]] = {}
    for clip in _rank_clips(clips):
        by_scene.setdefault(clip.scene_id, []).append(clip)

    selected: List[ClipSuggestion] = []
    selected_ids = set()
    scene_counts: Dict[int, int] = {}

    # Preserve scene coverage before filling the remaining quality-ranked slots.
    for scene_id in sorted(by_scene):
        if len(selected) >= preferences.max_candidates_per_video:
            break
        clip = by_scene[scene_id][0]
        selected.append(clip)
        selected_ids.add(clip.clip_id)
        scene_counts[scene_id] = 1

    for clip in _rank_clips(clips):
        if len(selected) >= preferences.max_candidates_per_video:
            break
        if clip.clip_id in selected_ids:
            continue
        if scene_counts.get(clip.scene_id, 0) >= scene_caps[clip.scene_id]:
            continue
        selected.append(clip)
        selected_ids.add(clip.clip_id)
        scene_counts[clip.scene_id] = scene_counts.get(clip.scene_id, 0) + 1

    return _rank_clips(selected)


def assemble_smooth_clips(
    file_id: str,
    file_name: str,
    frames: List[FrameScore],
    preferences: AssemblyPreferences = AssemblyPreferences(),  # noqa: B008 - frozen value object
    *,
    scene_bounds: Optional[Dict[int, Tuple[float, float]]] = None,
    source_duration_sec: Optional[float] = None,
) -> AssemblyResult:
    bounds = scene_bounds or {}
    frames_by_scene: Dict[int, List[FrameScore]] = {}
    for frame in sorted(frames, key=lambda item: item.timestamp):
        frames_by_scene.setdefault(frame.scene_id, []).append(frame)

    def scene_span(scene_id: int) -> Tuple[float, float]:
        scene_frames = frames_by_scene[scene_id]
        scene_start, scene_end = bounds.get(
            scene_id,
            (scene_frames[0].timestamp, source_duration_sec or scene_frames[-1].timestamp),
        )
        if source_duration_sec is not None:
            scene_end = min(scene_end, source_duration_sec)
        return scene_start, scene_end

    scene_caps = {}
    for scene_id in frames_by_scene:
        scene_start, scene_end = scene_span(scene_id)
        scene_caps[scene_id] = scene_cap(preferences, scene_end - scene_start)

    clips: List[ClipSuggestion] = []
    scenes_truncated_by_cap = set()
    for run in candidate_runs(
        frames,
        preferences.smoothness_threshold,
        preferences.max_turn_rate_deg_per_sec,
    ):
        scene_end = bounds.get(run[0].scene_id, (0.0, source_duration_sec or float("inf")))[1]
        if source_duration_sec is not None:
            scene_end = min(scene_end, source_duration_sec)
        windows = candidate_windows(
            run,
            preferences.min_clip_duration_sec,
            preferences.max_clip_duration_sec,
            scene_end_sec=scene_end if scene_end != float("inf") else None,
        )
        limit = scene_caps[run[0].scene_id]
        selected_windows = select_windows(windows, limit=limit)
        if len(selected_windows) >= limit and any(
            not any(
                window.start_sec < chosen.end_sec and window.end_sec > chosen.start_sec
                for chosen in selected_windows
            )
            for window in windows
        ):
            scenes_truncated_by_cap.add(run[0].scene_id)
        for chosen in selected_windows:
            clips.append(make_clip(file_id, file_name, chosen))

    scenes_with_candidates = {clip.scene_id for clip in clips}
    for scene_id, scene_frames in frames_by_scene.items():
        if scene_id in scenes_with_candidates:
            continue
        scene_start, scene_end = scene_span(scene_id)
        if scene_end - scene_start < preferences.min_clip_duration_sec:
            continue
        fallback_windows = candidate_windows(
            scene_frames,
            preferences.min_clip_duration_sec,
            preferences.max_clip_duration_sec,
            scene_end_sec=scene_end,
        )
        for chosen in select_windows(fallback_windows, limit=1):
            clips.append(make_clip(file_id, file_name, chosen, fallback=True))

    selected = _bounded_scene_pool(clips, preferences, scene_caps)
    kept_by_scene: Dict[int, int] = {}
    generated_by_scene: Dict[int, int] = {}
    for clip in clips:
        generated_by_scene[clip.scene_id] = generated_by_scene.get(clip.scene_id, 0) + 1
    for clip in selected:
        kept_by_scene[clip.scene_id] = kept_by_scene.get(clip.scene_id, 0) + 1
    scenes_at_cap = len(
        scenes_truncated_by_cap
        | {
            scene_id
            for scene_id, kept_count in kept_by_scene.items()
            if kept_count >= scene_caps[scene_id]
            and generated_by_scene.get(scene_id, 0) > kept_count
        }
    )

    return AssemblyResult(
        clips=selected,
        sequence=TimelineSequence(
            total_duration_sec=round(sum(clip.duration_sec for clip in selected), 3),
            clips=[clip.clip_id for clip in selected],
        ),
        metadata={
            "local": True,
            "model_used": "manual_rule_based",
            "generation_stats": {
                "candidates_generated": len(clips),
                "candidates_kept": len(selected),
                "scenes_total": len(frames_by_scene),
                "scenes_at_cap": scenes_at_cap,
                "preferences": asdict(preferences),
            },
        },
    )
