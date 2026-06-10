from typing import Literal, Optional


AssemblyProfile = Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]

PROFILE_DEFAULTS = {
    "short_social": {"preferred_max_sec": 6.0, "target_duration_sec": 45.0},
    "cinematic_highlight": {"preferred_max_sec": 15.0, "target_duration_sec": 120.0},
    "long_scenic": {"preferred_max_sec": 30.0, "target_duration_sec": 300.0},
    "custom": {"preferred_max_sec": 30.0, "target_duration_sec": 120.0},
}


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
    preferred_max = float(defaults["preferred_max_sec"])
    selected = []
    total = 0.0
    for clip in sorted(clips, key=lambda item: float(item.get("overall_score", 0)), reverse=True):
        available = max(0.0, float(clip["end_sec"]) - float(clip["start_sec"]))
        duration = min(available, preferred_max, target - total)
        if duration <= 0:
            continue
        selected.append(
            {
                **clip,
                "end_sec": round(float(clip["start_sec"]) + duration, 3),
                "duration_sec": round(duration, 3),
                "included": True,
            }
        )
        total += duration
        if total >= target:
            break

    selected.sort(key=lambda item: (str(item.get("file_name", "")).casefold(), float(item["start_sec"])))
    return {
        "source": "draft",
        "profile": profile,
        "clips": selected,
        "total_duration_sec": round(sum(clip["duration_sec"] for clip in selected), 3),
    }
