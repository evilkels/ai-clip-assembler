from typing import Literal, Optional


AssemblyProfile = Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]

# Each profile parameterises four levers applied at draft time (candidate
# generation stays profile-agnostic, so switching profiles re-drafts instantly):
#   clip_lengths        — alternating cut-length range (rhythm/pacing)
#   max_clips_per_scene — scene density; low spreads the edit across scenes
#   speed_policy        — "none" or "slowmo_smooth" (0.5× on very-smooth clips)
#   ordering            — "score_desc" (punchy) or "chronological" (narrative)
PROFILE_DEFAULTS = {
    "short_social": {
        "clip_lengths": [6.0, 3.0],
        "target_duration_sec": 45.0,
        "max_clips_per_scene": 99,
        "speed_policy": "none",
        "ordering": "score_desc",
    },
    "cinematic_highlight": {
        "clip_lengths": [15.0, 10.0],
        "target_duration_sec": 120.0,
        "max_clips_per_scene": 2,
        "speed_policy": "slowmo_smooth",
        "ordering": "chronological",
    },
    "long_scenic": {
        "clip_lengths": [30.0, 20.0],
        "target_duration_sec": 300.0,
        "max_clips_per_scene": 1,
        "speed_policy": "slowmo_smooth",
        "ordering": "chronological",
    },
    "custom": {
        "clip_lengths": [30.0, 15.0],
        "target_duration_sec": 120.0,
        "max_clips_per_scene": 2,
        "speed_policy": "none",
        "ordering": "chronological",
    },
}


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
    speed_policy = str(defaults.get("speed_policy", "none"))
    ordering = str(defaults.get("ordering", "chronological"))
    selected = []
    total = 0.0
    scene_counts: dict = {}
    index = 0
    for clip in sorted(clips, key=lambda item: float(item.get("overall_score", 0)), reverse=True):
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
        if total >= target:
            break

    # "score_desc" keeps the strongest-first order from selection; the narrative
    # profiles re-sort into shooting order.
    if ordering != "score_desc":
        selected.sort(key=lambda item: (str(item.get("file_name", "")).casefold(), float(item["start_sec"])))
    return {
        "source": "draft",
        "profile": profile,
        "clips": selected,
        "total_duration_sec": round(sum(clip["duration_sec"] for clip in selected), 3),
    }
