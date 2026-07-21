from typing import Literal, Optional


AssemblyProfile = Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]
FormatName = Literal["short", "medium", "long"]

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

# Short/Medium/Long length formats exposed to the user, each mapping onto one
# of the profiles above. A separate map (rather than reusing profile names
# directly) keeps the user-facing vocabulary stable if profiles are ever
# renamed or split.
FORMATS: dict[str, dict] = {
    "short": {
        "label": "Short",
        "profile": "short_social",
        "target_duration_sec": PROFILE_DEFAULTS["short_social"]["target_duration_sec"],
    },
    "medium": {
        "label": "Medium",
        "profile": "cinematic_highlight",
        "target_duration_sec": PROFILE_DEFAULTS["cinematic_highlight"]["target_duration_sec"],
    },
    "long": {
        "label": "Long",
        "profile": "long_scenic",
        "target_duration_sec": PROFILE_DEFAULTS["long_scenic"]["target_duration_sec"],
    },
}

# Slow motion is a special-occasion effect, not a blanket treatment: cap how
# many clips in a single edit can carry it, even when more clips qualify.
MAX_SLOWMO_CLIPS = 2


def _capture_order_key(clip: dict) -> tuple:
    """Sort key for chronological (shooting-order) assembly.

    Prefers the source file's capture time; falls back to the filename so
    single-camera footage (whose names embed a sortable timestamp) still
    orders correctly when no container timestamp is present.
    """
    created_at = clip.get("source_created_at")
    primary = str(created_at) if created_at else str(clip.get("file_name", "")).casefold()
    return (primary, float(clip["start_sec"]))


def _slowmo_eligible(clip: dict) -> bool:
    very_smooth = float(clip.get("smoothness_score", 0.0)) >= 9.0
    low_turn = float(clip.get("max_turn_rate_deg_per_sec", 999.0)) <= 3.0
    return very_smooth and low_turn


def _slowmo_rank_key(clip: dict) -> tuple:
    """Deterministic tie-break for capping slow-mo to the smoothest, steadiest
    clips: smoothest first, then lowest turn rate, then clip_id for stability."""
    return (
        -float(clip.get("smoothness_score", 0.0)),
        float(clip.get("max_turn_rate_deg_per_sec", 999.0)),
        str(clip.get("clip_id", "")),
    )


def speed_for_clip(clip: dict, policy: str) -> float:
    """Per-profile suggested playback speed; overrides the raw candidate's."""
    if policy == "slowmo_smooth" and _slowmo_eligible(clip):
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


def recommend_format(clips: list[dict]) -> FormatName:
    """The Short/Medium/Long format matching `recommend_assembly_profile`'s pick."""
    profile = recommend_assembly_profile(clips)["profile"]
    for format_name, info in FORMATS.items():
        if info["profile"] == profile:
            return format_name
    raise AssertionError(f"no format maps to profile {profile!r}")  # pragma: no cover


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
    # The profile's shortest intended cut. We never emit a clip below this,
    # so the budget remainder can't truncate the final clip into an unusable
    # sliver (e.g. a 1s tail just to hit target_duration_sec).
    min_clip_sec = min(clip_lengths) if clip_lengths else 1.0
    selected = []
    total = 0.0
    scene_counts: dict = {}
    # Source ranges already claimed per file, so we never stack overlapping
    # windows of the same footage (candidate generation emits many overlapping
    # windows over a single smooth run; without this they read as duplicates).
    claimed_spans: dict = {}
    # Look Groups already claimed, so the edit never stacks two look-alike
    # clips. Clips without a look_group (pre-Phase-B data, or a degraded
    # embedding pass) are unconstrained.
    claimed_look_groups: set = set()
    index = 0
    for clip in sorted(clips, key=lambda item: float(item.get("overall_score", 0)), reverse=True):
        if max_clips and len(selected) >= max_clips:
            break
        scene_id = clip.get("scene_id", 0)
        if scene_counts.get(scene_id, 0) >= max_per_scene:
            continue
        look_group = clip.get("look_group")
        if look_group is not None and look_group in claimed_look_groups:
            # Look-alike of a clip already selected — skip so the edit doesn't
            # stack two near-identical shots.
            continue
        start = float(clip["start_sec"])
        end = float(clip["end_sec"])
        file_id = clip.get("file_id")
        spans = claimed_spans.setdefault(file_id, [])
        if any(start < span_end and end > span_start for span_start, span_end in spans):
            # Overlaps footage already used from this file — replaying it would
            # look like a duplicate cut, so skip.
            continue
        remaining = target - total
        # Once the budget can't hold the profile's shortest intended cut, stop
        # rather than appending a truncated sliver. (First clip is exempt so a
        # tiny target still yields one clip instead of an empty timeline.)
        if selected and remaining < min_clip_sec:
            break
        available = max(0.0, end - start)
        duration = min(available, float(clip_lengths[index % len(clip_lengths)]), remaining)
        if duration <= 0:
            continue
        selected.append(
            {
                **clip,
                "end_sec": round(start + duration, 3),
                "duration_sec": round(duration, 3),
                "suggested_speed": speed_for_clip(clip, speed_policy),
                "included": True,
            }
        )
        total += duration
        scene_counts[scene_id] = scene_counts.get(scene_id, 0) + 1
        spans.append((start, end))
        if look_group is not None:
            claimed_look_groups.add(look_group)
        index += 1
        # Stop at the duration budget or the clip-count cap, whichever comes first.
        if total >= target or (max_clips and len(selected) >= max_clips):
            break

    if speed_policy == "slowmo_smooth":
        slowed = [item for item in selected if item["suggested_speed"] != 1.0]
        if len(slowed) > MAX_SLOWMO_CLIPS:
            keep_ids = {
                item["clip_id"]
                for item in sorted(slowed, key=_slowmo_rank_key)[:MAX_SLOWMO_CLIPS]
            }
            for item in slowed:
                if item["clip_id"] not in keep_ids:
                    item["suggested_speed"] = 1.0

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
