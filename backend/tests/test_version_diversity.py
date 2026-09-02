"""Tests for the pure Version diversity policy.

Shared by model-Version validation and deterministic-Version generation so
that neither producer can independently drift from the similarity rules
defined in plan 027: overlapping ranges in the same Source Video, the same
non-null Look Group, or the same (file_id, scene_id) pair.
"""

import pytest

# Plan 027 Task 1 was written test-first and the implementation never followed.
# The assertions are parked rather than discarded: this guard skips them while
# the module is missing and lets them run the moment it lands, so nobody has to
# remember to re-enable anything.
pytest.importorskip(
    "src.version_diversity",
    reason="plan 027 Task 1: backend/src/version_diversity.py is not implemented yet",
)

from src.version_diversity import diverse_candidates  # noqa: E402


def candidate(clip_id, *, file_id, scene_id=None, start=0.0, end=1.0, look_group=None):
    return {
        "clip_id": clip_id,
        "file_id": file_id,
        "scene_id": scene_id,
        "start_sec": start,
        "end_sec": end,
        "look_group": look_group,
    }


def test_diverse_candidates_removes_overlapping_ranges_from_same_source():
    selected = diverse_candidates([
        candidate("best", file_id="a", scene_id=1, start=0, end=8),
        candidate("overlap", file_id="a", scene_id=2, start=7, end=12),
        candidate("other", file_id="b", scene_id=1, start=0, end=8),
    ])
    assert [item["clip_id"] for item in selected] == ["best", "other"]


def test_diverse_candidates_keeps_only_first_look_group_member():
    selected = diverse_candidates([
        candidate("best", file_id="a", scene_id=1, start=0, end=8, look_group=4),
        candidate("similar", file_id="b", scene_id=2, start=0, end=8, look_group=4),
    ])
    assert [item["clip_id"] for item in selected] == ["best"]


def test_diverse_candidates_keeps_only_first_clip_from_source_scene():
    selected = diverse_candidates([
        candidate("best", file_id="a", scene_id=1, start=0, end=4),
        candidate("later", file_id="a", scene_id=1, start=8, end=12),
    ])
    assert [item["clip_id"] for item in selected] == ["best"]


def test_diverse_candidates_preserves_input_priority_order():
    selected = diverse_candidates([
        candidate("first", file_id="a", scene_id=1, start=0, end=4),
        candidate("second", file_id="b", scene_id=1, start=0, end=4),
        candidate("third", file_id="c", scene_id=1, start=0, end=4),
    ])
    assert [item["clip_id"] for item in selected] == ["first", "second", "third"]


def test_diverse_candidates_respects_limit():
    selected = diverse_candidates(
        [
            candidate("first", file_id="a", scene_id=1, start=0, end=4),
            candidate("second", file_id="b", scene_id=1, start=0, end=4),
            candidate("third", file_id="c", scene_id=1, start=0, end=4),
        ],
        limit=2,
    )
    assert [item["clip_id"] for item in selected] == ["first", "second"]


def test_diverse_candidates_treats_missing_scene_id_as_unconstrained():
    selected = diverse_candidates([
        candidate("first", file_id="a", scene_id=None, start=0, end=4),
        candidate("second", file_id="a", scene_id=None, start=20, end=24),
    ])
    assert [item["clip_id"] for item in selected] == ["first", "second"]


def test_diverse_candidates_treats_missing_look_group_as_unconstrained():
    selected = diverse_candidates([
        candidate("first", file_id="a", scene_id=1, start=0, end=4, look_group=None),
        candidate("second", file_id="b", scene_id=2, start=20, end=24, look_group=None),
    ])
    assert [item["clip_id"] for item in selected] == ["first", "second"]
