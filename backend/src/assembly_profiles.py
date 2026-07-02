from typing import Literal, Optional


AssemblyProfile = Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]

# Each profile parameterises four levers applied at draft time (candidate
# generation stays profile-agnostic, so switching profiles re-drafts instantly):
#   clip_lengths        — cut-length cycle (rhythm/pacing); cycled per clip, so a
#                         longer list yields more varied durations
#   max_clips_per_scene — scene density; low spreads the edit across scenes
#   max_clips           — hard cap on clip count, so density no longer depends
#                         solely on hitting target_duration_sec
#   speed_policy        — "none" or "slowmo_smooth" (0.5× on very-smooth clips)
#   ordering            — "score_desc" (punchy) or "chronological" (narrative)
PROFILE_DEFAULTS = {
    "short_social": {
        "clip_lengths": [7.0, 4.0, 6.0, 3.0, 5.0],
        "target_duration_sec": 60.0,
        "max_clips_per_scene": 99,
        "max_clips": 24,
        "speed_policy": "none",
        "ordering": "score_desc",
    },
    "cinematic_highlight": {
        "clip_lengths": [18.0, 10.0, 14.0, 7.0, 20.0, 12.0],
        "target_duration_sec": 240.0,
        "max_clips_per_scene": 4,
        "max_clips": 40,
        "speed_policy": "slowmo_smooth",
        "ordering": "chronological",
    },
    "long_scenic": {
        "clip_lengths": [35.0, 22.0, 28.0, 18.0, 30.0],
        "target_duration_sec": 480.0,
        "max_clips_per_scene": 3,
        "max_clips": 32,
        "speed_policy": "slowmo_smooth",
        "ordering": "chronological",
    },
    "custom": {
        "clip_lengths": [25.0, 12.0, 30.0, 18.0, 15.0],
        "target_duration_sec": 180.0,
        "max_clips_per_scene": 4,
        "max_clips": 40,
        "speed_policy": "none",
        "ordering": "chronological",
    },
}


def _capture_order_key(clip: dict) -> tuple:
    """Sort key for chronological (shooting-order) assembly.

    Prefers the source file's capture time; falls back to the filename so
    single-camera footage (whose names embed a sortable timestamp) still
    orders correctly when no container timestamp is present.
    """
    created_at = clip.get("source_created_at")
    primary = str(created_at) if created_at else str(clip.get("file_name", "")).casefold()
    return (primary, float(clip["start_sec"]))


def speed_for_clip(clip: dict, policy: str) -> float:
    """Per-profile suggested playback speed; overrides the raw candidate's."""
    if policy == "slowmo_smooth":
        very_smooth = float(clip.get("smoothness_score", 0.0)) >= 9.0
        low_turn = float(clip.get("max_turn_rate_deg_per_sec", 999.0)) <= 3.0
        if very_smooth and low_turn:
            return 0.5
    return 1.0


def recommend_assembly_profile(clips: list[dict]) -> dict:
    durations = [float(clip.get("duration_sec", 0)) for clip in clips]
    total = sum(durations)
    longest = max(durations, default=0)
    if longest >= 20 and total >= 60:
        profile: AssemblyProfile = "long_scenic"
        reason = "Sustained stable ranges support a slower scenic edit."
    elif longest >= 8 or total >= 45:
        profile = "cinematic_highlight"
        reason = "The footage supports balanced highlight pacing."
    else:
        profile = "short_social"
        reason = "Usable ranges are brief, so a compact edit will preserve quality."
    defaults = PROFILE_DEFAULTS[profile]
    return {
        "profile": profile,
        "target_duration_sec": defaults["target_duration_sec"],
        "reason": reason,
    }


def build_draft_timeline(
    clips: list[dict],
    *,
    profile: AssemblyProfile,
    target_duration_sec: Optional[float] = None,
) -> dict:
    defaults = PROFILE_DEFAULTS[profile]
    target = max(1.0, float(target_duration_sec or defaults["target_duration_sec"]))
    clip_lengths = defaults["clip_lengths"]
    max_per_scene = int(defaults.get("max_clips_per_scene", 2))
    max_clips = int(defaults.get("max_clips", 0))
    speed_policy = str(defaults.get("speed_policy", "none"))
    ordering = str(defaults.get("ordering", "chronological"))
    selected = []
    total = 0.0
    scene_counts: dict = {}
    index = 0
    for clip in sorted(clips, key=lambda item: float(item.get("overall_score", 0)), reverse=True):
        if max_clips and len(selected) >= max_clips:
            break
        scene_id = clip.get("scene_id", 0)
        if scene_counts.get(scene_id, 0) >= max_per_scene:
            continue
        available = max(0.0, float(clip["end_sec"]) - float(clip["start_sec"]))
        duration = min(available, float(clip_lengths[index % len(clip_lengths)]), target - total)
        if duration <= 0:
            continue
        selected.append(
            {
                **clip,
                "end_sec": round(float(clip["start_sec"]) + duration, 3),
                "duration_sec": round(duration, 3),
                "suggested_speed": speed_for_clip(clip, speed_policy),
                "included": True,
            }
        )
        total += duration
        scene_counts[scene_id] = scene_counts.get(scene_id, 0) + 1
        index += 1
        # Stop at the duration budget or the clip-count cap, whichever comes first.
        if total >= target or (max_clips and len(selected) >= max_clips):
            break

    # "score_desc" keeps the strongest-first order from selection; the narrative
    # profiles re-sort into shooting order — by true capture time when available,
    # falling back to filename so single-camera footage still sorts sensibly.
    if ordering != "score_desc":
        selected.sort(key=_capture_order_key)
    return {
        "source": "draft",
        "profile": profile,
        "clips": selected,
        "total_duration_sec": round(sum(clip["duration_sec"] for clip in selected), 3),
    }
