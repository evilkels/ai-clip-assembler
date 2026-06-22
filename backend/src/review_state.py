"""Canonical state identity for the connected review pipeline.

Pure, FastAPI-independent helpers that turn Timeline content into stable
SHA-256 fingerprints. Two fingerprints answer two different questions:

* :func:`sequence_fingerprint` — does a playable sequence (a Version build
  recipe or the Working Timeline) contain exactly the same ordered, bounded,
  retimed, and transformed placements? It deliberately ignores live
  ``item_id`` values, because a Version recipe has no live item IDs.
* :func:`review_context_fingerprint` — was an agent VersionSet generated from
  the current review context (the normalized sequence, sorted Timeline
  decisions, profile/target duration, and the exact bounded Candidate Clip
  context handed to the producer)?

Revisions (see :class:`~src.timeline_ops.TimelineController`) are concurrency
tokens only; these fingerprints determine equality and staleness. The frontend
never computes a competing hash — both values are server-derived and returned.
"""

from __future__ import annotations

import hashlib
import json
from typing import Iterable, Mapping, Sequence

from .models import TimelineDocument


# Sequence floats (bounds, speed, transform) round to six decimals; candidate
# scores round to four. Both keep canonical JSON stable across float noise.
SEQUENCE_FLOAT_DECIMALS = 6
CANDIDATE_SCORE_DECIMALS = 4


def _get(obj: object, key: str) -> object:
    """Read ``key`` from a Mapping or an attribute-bearing object uniformly."""
    if isinstance(obj, Mapping):
        return obj.get(key)
    return getattr(obj, key, None)


def _transform_field(transform: object, key: str, default: float) -> float:
    if transform is None:
        return default
    value = _get(transform, key)
    return default if value is None else value


def _round(value: object, decimals: int) -> float:
    return round(float(value), decimals)


def _normalized_item(item: object) -> list:
    """Canonical, item-ID-free value list for one placement.

    Field order is fixed: ``source_clip_id``, ``start_sec``, ``end_sec``,
    ``speed``, ``transform.scale``, ``transform.x``, ``transform.y``. A list
    keeps that order regardless of JSON key sorting.
    """
    transform = _get(item, "transform")
    speed = _get(item, "speed")
    speed = 1.0 if speed is None else speed
    return [
        _get(item, "source_clip_id"),
        _round(_get(item, "start_sec"), SEQUENCE_FLOAT_DECIMALS),
        _round(_get(item, "end_sec"), SEQUENCE_FLOAT_DECIMALS),
        _round(speed, SEQUENCE_FLOAT_DECIMALS),
        _round(_transform_field(transform, "scale", 1.0), SEQUENCE_FLOAT_DECIMALS),
        _round(_transform_field(transform, "x", 0.0), SEQUENCE_FLOAT_DECIMALS),
        _round(_transform_field(transform, "y", 0.0), SEQUENCE_FLOAT_DECIMALS),
    ]


def _normalized_sequence(items: Iterable[object]) -> list:
    return [_normalized_item(item) for item in items]


def _digest(payload: object) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def sequence_fingerprint(items: Iterable[object]) -> str:
    """Return the canonical SHA-256 sequence digest."""
    return _digest(_normalized_sequence(items))


def _canonical_candidate(candidate: Mapping[str, object]) -> dict:
    """Round numeric candidate fields so float noise cannot change membership.

    Score-like fields round to four decimals; every other numeric field (bounds,
    speeds) rounds to six. Non-numeric values pass through unchanged.
    """
    canonical: dict = {}
    for key, value in candidate.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            canonical[key] = value
        elif "score" in key:
            canonical[key] = round(float(value), CANDIDATE_SCORE_DECIMALS)
        else:
            canonical[key] = round(float(value), SEQUENCE_FLOAT_DECIMALS)
    return canonical


def review_context_fingerprint(
    document: TimelineDocument,
    candidates: Sequence[Mapping[str, object]],
) -> str:
    """Hash the exact bounded agent inputs plus Timeline review state.

    The bounded ``candidates`` are the exact Candidate Clip context handed to
    the producer (in deterministic order); prompt-string truncation must not
    redefine that membership. Re-analysis that changes a consumed candidate
    therefore makes prior Versions stale even when the sequence is unchanged.
    """
    target = document.target_duration_sec
    payload = {
        "sequence": _normalized_sequence(document.items),
        "decisions": dict(sorted(document.decisions.items())),
        "profile": document.profile,
        "target_duration_sec": (
            None if target is None else round(float(target), SEQUENCE_FLOAT_DECIMALS)
        ),
        "candidates": [_canonical_candidate(candidate) for candidate in candidates],
    }
    return _digest(payload)
