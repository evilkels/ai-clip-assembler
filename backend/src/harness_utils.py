"""Shared helpers for AI harness implementations.

Frame sampling and score clamping are identical across every harness; keeping
one copy here avoids the drift that creeps in when each new harness
copy-pastes its own. See ``HARNESS_SPEC.md`` for the harness contract.
"""

from typing import List

from .models import ClipSuggestion, FrameScore

DEFAULT_MAX_FRAMES_PER_CLIP = 4


def sample_frames_for_clip(
    clip: ClipSuggestion,
    all_frames: List[FrameScore],
    max_frames: int = DEFAULT_MAX_FRAMES_PER_CLIP,
) -> List[str]:
    """Pick up to *max_frames* representative frame paths inside *clip*."""
    clip_frames = [
        f for f in all_frames if clip.start_sec <= f.timestamp <= clip.end_sec
    ]
    if not clip_frames:
        return []
    if len(clip_frames) <= max_frames:
        return [f.frame_path for f in clip_frames]
    indices = [int(i * (len(clip_frames) - 1) / (max_frames - 1)) for i in range(max_frames)]
    return [clip_frames[i].frame_path for i in indices]


def clamp_score(value) -> float:
    """Clamp a model-provided score into the supported 0–10 range."""
    try:
        return max(0.0, min(10.0, float(value)))
    except (TypeError, ValueError):
        return 0.0
