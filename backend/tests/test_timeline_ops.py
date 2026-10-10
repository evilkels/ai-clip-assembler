"""Tests for the backend-authoritative Timeline Document + operations core.

Phase A1 of the agent-operable timeline. These cover the models
(`Transform` / `TimelineItem` / `TimelineDocument`), the single reversible
operations core (`apply_operation`), and the snapshot history + per-project
write lock (`TimelineController`).

The operations core is the *only* way a `TimelineDocument` is mutated; the GUI,
the in-app review agent, and external MCP agents all drive it.
"""

import uuid

import pytest
from pydantic import ValidationError

from src.models import Transform, TimelineDocument, TimelineItem
from src.review_state import review_context_fingerprint, sequence_fingerprint
from src.timeline_ops import (
    SourceClip,
    TimelineController,
    TimelineOpError,
    TimelinePersistError,
    TimelineRevisionConflict,
    _ITEM_ID_NAMESPACE,
    _new_item_id,
    apply_operation,
    seeded_item_ids,
)


# --- fixtures / helpers -----------------------------------------------------


def make_sources(*specs):
    """Build a {clip_id: SourceClip} registry from (clip_id, start, end, dur) tuples."""
    sources = {}
    for clip_id, start, end, duration in specs:
        sources[clip_id] = SourceClip(
            clip_id=clip_id,
            start_sec=start,
            end_sec=end,
            source_duration_sec=duration,
        )
    return sources


def make_item(item_id="item-1", clip_id="clip-a", start=2.0, end=5.0, speed=1.0):
    return TimelineItem(
        item_id=item_id,
        source_clip_id=clip_id,
        start_sec=start,
        end_sec=end,
        speed=speed,
    )


def empty_doc():
    return TimelineDocument()


# --- A1.1 models ------------------------------------------------------------


def test_transform_defaults_to_identity():
    transform = Transform()
    assert transform.scale == 1.0
    assert transform.x == 0.0
    assert transform.y == 0.0


def test_transform_rejects_non_positive_scale():
    with pytest.raises(ValidationError):
        Transform(scale=0.0)
    with pytest.raises(ValidationError):
        Transform(scale=-2.0)


def test_timeline_item_defaults_speed_and_identity_transform():
    item = make_item()
    assert item.speed == 1.0
    assert item.transform == Transform()


def test_timeline_item_effective_duration_accounts_for_speed():
    # 6 source seconds at 2x plays in 3 timeline seconds.
    item = make_item(start=0.0, end=6.0, speed=2.0)
    assert item.effective_duration_sec == pytest.approx(3.0)
    # 4 source seconds at 0.5x (slow-mo) plays in 8 timeline seconds.
    slow = make_item(start=0.0, end=4.0, speed=0.5)
    assert slow.effective_duration_sec == pytest.approx(8.0)


def test_timeline_item_rejects_inverted_bounds():
    with pytest.raises(ValidationError):
        TimelineItem(item_id="x", source_clip_id="c", start_sec=5.0, end_sec=2.0)


def test_timeline_item_rejects_non_positive_speed():
    with pytest.raises(ValidationError):
        TimelineItem(
            item_id="x", source_clip_id="c", start_sec=0.0, end_sec=2.0, speed=0.0
        )


def test_timeline_document_defaults():
    doc = TimelineDocument()
    assert doc.items == []
    assert doc.profile is None
    assert doc.target_duration_sec is None
    assert doc.version >= 2


# --- A1.2 operations core ---------------------------------------------------


def test_add_item_seeds_from_candidate_bounds():
    sources = make_sources(("clip-a", 1.0, 4.0, 30.0))
    doc = apply_operation(empty_doc(), sources, "add_item", source_clip_id="clip-a")
    assert len(doc.items) == 1
    item = doc.items[0]
    assert item.source_clip_id == "clip-a"
    assert item.start_sec == 1.0
    assert item.end_sec == 4.0
    assert item.speed == 1.0
    assert item.transform == Transform()
    assert item.item_id  # generated


def test_add_item_is_multi_instance_with_distinct_ids():
    sources = make_sources(("clip-a", 1.0, 4.0, 30.0))
    doc = apply_operation(empty_doc(), sources, "add_item", source_clip_id="clip-a")
    doc = apply_operation(doc, sources, "add_item", source_clip_id="clip-a")
    assert len(doc.items) == 2
    a, b = doc.items
    assert a.source_clip_id == b.source_clip_id == "clip-a"
    assert a.item_id != b.item_id


def test_add_item_at_index_inserts():
    sources = make_sources(("a", 0.0, 2.0, 10.0), ("b", 0.0, 2.0, 10.0))
    doc = apply_operation(empty_doc(), sources, "add_item", source_clip_id="a")
    doc = apply_operation(doc, sources, "add_item", source_clip_id="b", at_index=0)
    assert [i.source_clip_id for i in doc.items] == ["b", "a"]


def test_add_item_unknown_clip_raises():
    with pytest.raises(TimelineOpError):
        apply_operation(empty_doc(), {}, "add_item", source_clip_id="missing")


def test_remove_item():
    doc = TimelineDocument(items=[make_item("i1"), make_item("i2")])
    doc = apply_operation(doc, {}, "remove_item", item_id="i1")
    assert [i.item_id for i in doc.items] == ["i2"]


def test_remove_unknown_item_raises():
    with pytest.raises(TimelineOpError):
        apply_operation(empty_doc(), {}, "remove_item", item_id="nope")


def test_split_item_at_source_timestamp():
    doc = TimelineDocument(items=[make_item("i1", start=2.0, end=8.0, speed=2.0)])
    doc = apply_operation(doc, {}, "split_item", item_id="i1", at_sec=5.0)
    assert len(doc.items) == 2
    first, second = doc.items
    assert (first.start_sec, first.end_sec) == (2.0, 5.0)
    assert (second.start_sec, second.end_sec) == (5.0, 8.0)
    # speed/transform preserved on both halves; ids are fresh + distinct.
    assert first.speed == second.speed == 2.0
    assert first.item_id != second.item_id


def test_split_item_out_of_bounds_raises():
    doc = TimelineDocument(items=[make_item("i1", start=2.0, end=8.0)])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "split_item", item_id="i1", at_sec=2.0)
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "split_item", item_id="i1", at_sec=8.0)
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "split_item", item_id="i1", at_sec=12.0)


def test_set_bounds_trims_within_source():
    sources = make_sources(("clip-a", 2.0, 5.0, 30.0))
    doc = TimelineDocument(items=[make_item("i1", clip_id="clip-a", start=2.0, end=5.0)])
    doc = apply_operation(doc, sources, "set_bounds", item_id="i1", start_sec=3.0, end_sec=4.0)
    assert (doc.items[0].start_sec, doc.items[0].end_sec) == (3.0, 4.0)


def test_set_bounds_extends_past_candidate_and_clamps_to_source():
    sources = make_sources(("clip-a", 2.0, 5.0, 10.0))
    doc = TimelineDocument(items=[make_item("i1", clip_id="clip-a", start=2.0, end=5.0)])
    # Request extends beyond [0, 10]; clamp to the source duration.
    doc = apply_operation(
        doc, sources, "set_bounds", item_id="i1", start_sec=-3.0, end_sec=100.0
    )
    assert (doc.items[0].start_sec, doc.items[0].end_sec) == (0.0, 10.0)


def test_set_bounds_rejects_empty_span():
    sources = make_sources(("clip-a", 2.0, 5.0, 10.0))
    doc = TimelineDocument(items=[make_item("i1", clip_id="clip-a", start=2.0, end=5.0)])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, sources, "set_bounds", item_id="i1", start_sec=4.0, end_sec=4.0)


def test_reorder_moves_item():
    doc = TimelineDocument(items=[make_item("a"), make_item("b"), make_item("c")])
    doc = apply_operation(doc, {}, "reorder", item_id="a", to_index=2)
    assert [i.item_id for i in doc.items] == ["b", "c", "a"]


def test_reorder_out_of_range_raises():
    doc = TimelineDocument(items=[make_item("a"), make_item("b")])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "reorder", item_id="a", to_index=5)


def test_set_speed_changes_effective_duration():
    doc = TimelineDocument(items=[make_item("i1", start=0.0, end=6.0)])
    doc = apply_operation(doc, {}, "set_speed", item_id="i1", speed=2.0)
    assert doc.items[0].speed == 2.0
    assert doc.items[0].effective_duration_sec == pytest.approx(3.0)


def test_set_speed_rejects_non_positive():
    doc = TimelineDocument(items=[make_item("i1")])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "set_speed", item_id="i1", speed=0.0)


def test_set_transform_sets_zoom_and_pan():
    doc = TimelineDocument(items=[make_item("i1")])
    doc = apply_operation(
        doc, {}, "set_transform", item_id="i1", transform={"scale": 1.5, "x": 0.1, "y": -0.2}
    )
    assert doc.items[0].transform == Transform(scale=1.5, x=0.1, y=-0.2)


def test_set_transform_rejects_invalid_scale():
    doc = TimelineDocument(items=[make_item("i1")])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "set_transform", item_id="i1", transform={"scale": 0.0})


def test_include_adds_item_for_candidate():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "include", clip_id="clip-a")
    assert [i.source_clip_id for i in doc.items] == ["clip-a"]


def test_include_is_idempotent_when_item_exists():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "include", clip_id="clip-a")
    doc = apply_operation(doc, sources, "include", clip_id="clip-a")
    assert len(doc.items) == 1


def test_exclude_removes_all_items_for_candidate():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "add_item", source_clip_id="clip-a")
    doc = apply_operation(doc, sources, "add_item", source_clip_id="clip-a")
    doc = apply_operation(doc, sources, "exclude", clip_id="clip-a")
    assert doc.items == []


def test_include_records_included_decision():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "include", clip_id="clip-a")
    assert doc.decisions["clip-a"] == "included"


def test_exclude_records_excluded_decision():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "include", clip_id="clip-a")
    doc = apply_operation(doc, sources, "exclude", clip_id="clip-a")
    assert doc.decisions["clip-a"] == "excluded"
    assert doc.items == []


def test_reset_decision_clears_decision_and_items():
    sources = make_sources(("clip-a", 1.0, 3.0, 20.0))
    doc = apply_operation(empty_doc(), sources, "include", clip_id="clip-a")
    doc = apply_operation(doc, sources, "reset_decision", clip_id="clip-a")
    assert "clip-a" not in doc.decisions
    assert doc.items == []


def test_timeline_document_decisions_default_empty():
    assert TimelineDocument().decisions == {}


def test_set_profile_and_target_duration():
    doc = apply_operation(empty_doc(), {}, "set_profile", profile="cinematic")
    doc = apply_operation(doc, {}, "set_target_duration", target_duration_sec=42.0)
    assert doc.profile == "cinematic"
    assert doc.target_duration_sec == 42.0


def test_replace_timeline_swaps_all_items():
    sources = make_sources(("c1", 0.0, 10.0, 10.0))
    doc = TimelineDocument(
        items=[make_item("old", clip_id="c1", start=0.0, end=2.0)]
    )

    result = apply_operation(
        doc,
        sources,
        "replace_timeline",
        items=[
            {
                "source_clip_id": "c1",
                "start_sec": 1.0,
                "end_sec": 3.0,
                "speed": 2.0,
            },
            {"source_clip_id": "c1", "start_sec": 4.0, "end_sec": 5.0},
        ],
    )

    assert [item.source_clip_id for item in result.items] == ["c1", "c1"]
    assert (result.items[0].start_sec, result.items[0].end_sec) == (1.0, 3.0)
    assert result.items[0].speed == 2.0
    assert result.items[1].speed == 1.0
    assert result.items[0].item_id != "old"
    assert len({item.item_id for item in result.items}) == 2
    assert doc.items[0].item_id == "old"


def test_replace_timeline_clamps_bounds_to_source():
    sources = make_sources(("c1", 0.0, 10.0, 10.0))
    result = apply_operation(
        empty_doc(),
        sources,
        "replace_timeline",
        items=[{"source_clip_id": "c1", "start_sec": -5.0, "end_sec": 99.0}],
    )

    assert (result.items[0].start_sec, result.items[0].end_sec) == (0.0, 10.0)


def test_replace_timeline_unknown_source_raises():
    with pytest.raises(TimelineOpError):
        apply_operation(
            empty_doc(),
            {},
            "replace_timeline",
            items=[
                {"source_clip_id": "missing", "start_sec": 0.0, "end_sec": 1.0}
            ],
        )


def test_replace_timeline_empty_clears():
    doc = TimelineDocument(
        items=[make_item("old", clip_id="c1", start=0.0, end=2.0)]
    )

    result = apply_operation(doc, {}, "replace_timeline", items=[])

    assert result.items == []


@pytest.mark.parametrize(
    "items",
    [
        None,
        "bad",
        [42],
        [{"start_sec": 0.0, "end_sec": 1.0}],
        [{"source_clip_id": "c1", "end_sec": 1.0}],
        [{"source_clip_id": "c1", "start_sec": "bad", "end_sec": 1.0}],
        [{"source_clip_id": "c1", "start_sec": 0.0, "end_sec": float("nan")}],
        [
            {
                "source_clip_id": "c1",
                "start_sec": 0.0,
                "end_sec": 1.0,
                "speed": float("inf"),
            }
        ],
    ],
)
def test_replace_timeline_rejects_malformed_specs_as_operation_errors(items):
    sources = make_sources(("c1", 0.0, 10.0, 10.0))

    with pytest.raises(TimelineOpError):
        apply_operation(empty_doc(), sources, "replace_timeline", items=items)


def test_replace_timeline_invalid_later_spec_does_not_mutate_input():
    sources = make_sources(("c1", 0.0, 10.0, 10.0))
    doc = TimelineDocument(
        items=[make_item("old", clip_id="c1", start=0.0, end=2.0)]
    )

    with pytest.raises(TimelineOpError):
        apply_operation(
            doc,
            sources,
            "replace_timeline",
            items=[
                {"source_clip_id": "c1", "start_sec": 1.0, "end_sec": 3.0},
                {"source_clip_id": "c1", "start_sec": 4.0},
            ],
        )

    assert [item.item_id for item in doc.items] == ["old"]


def test_unknown_operation_raises():
    with pytest.raises(TimelineOpError):
        apply_operation(empty_doc(), {}, "frobnicate", item_id="x")


def test_apply_operation_does_not_mutate_input_document():
    sources = make_sources(("clip-a", 1.0, 4.0, 30.0))
    original = empty_doc()
    apply_operation(original, sources, "add_item", source_clip_id="clip-a")
    # Operations return a new document; the input is untouched (snapshot-friendly).
    assert original.items == []


# --- A1.3 undo/redo history + write lock ------------------------------------


@pytest.mark.asyncio
async def test_controller_undo_restores_previous_document():
    sources = make_sources(("clip-a", 1.0, 4.0, 30.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="clip-a")
    assert len(controller.document.items) == 1
    await controller.undo()
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_replace_timeline_is_one_undoable_step():
    sources = make_sources(("c1", 0.0, 10.0, 10.0))
    doc = TimelineDocument(
        items=[make_item("old", clip_id="c1", start=0.0, end=2.0)]
    )
    controller = TimelineController(doc, sources)

    await controller.apply(
        "replace_timeline",
        items=[
            {"source_clip_id": "c1", "start_sec": 1.0, "end_sec": 3.0},
            {"source_clip_id": "c1", "start_sec": 4.0, "end_sec": 6.0},
        ],
    )

    assert len(controller.document.items) == 2
    reverted = await controller.undo()
    assert [item.item_id for item in reverted.items] == ["old"]


@pytest.mark.asyncio
async def test_controller_redo_reapplies_undone_operation():
    sources = make_sources(("clip-a", 1.0, 4.0, 30.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="clip-a")
    await controller.undo()
    await controller.redo()
    assert len(controller.document.items) == 1


@pytest.mark.asyncio
async def test_controller_undo_redo_across_operations():
    sources = make_sources(("clip-a", 0.0, 6.0, 30.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="clip-a")
    item_id = controller.document.items[0].item_id
    await controller.apply("set_speed", item_id=item_id, speed=2.0)
    await controller.apply("split_item", item_id=item_id, at_sec=3.0)
    assert len(controller.document.items) == 2

    await controller.undo()  # undo split
    assert len(controller.document.items) == 1
    assert controller.document.items[0].speed == 2.0
    await controller.undo()  # undo set_speed
    assert controller.document.items[0].speed == 1.0
    await controller.undo()  # undo add_item
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_controller_new_operation_clears_redo():
    sources = make_sources(("a", 0.0, 2.0, 10.0), ("b", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a")
    await controller.undo()
    await controller.apply("add_item", source_clip_id="b")
    # The redo of "add a" is gone; redo is a no-op.
    await controller.redo()
    assert [i.source_clip_id for i in controller.document.items] == ["b"]


@pytest.mark.asyncio
async def test_controller_history_is_bounded():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources, history_limit=3)
    for _ in range(6):
        await controller.apply("add_item", source_clip_id="a")
    assert len(controller.document.items) == 6
    # Only the last 3 operations can be undone.
    for _ in range(3):
        await controller.undo()
    assert len(controller.document.items) == 3
    # Further undo is a no-op (history exhausted, oldest snapshots dropped).
    await controller.undo()
    assert len(controller.document.items) == 3


@pytest.mark.asyncio
async def test_controller_undo_with_empty_history_is_noop():
    controller = TimelineController(empty_doc(), {})
    await controller.undo()
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_controller_lock_serializes_mutate_and_notify():
    """The per-project write lock must serialize the whole mutate+notify
    critical section so two writers (GUI + agent) cannot interleave mid-op."""
    import asyncio

    sources = make_sources(("a", 0.0, 2.0, 10.0))
    events = []

    async def on_change(document):
        events.append(("enter", len(document.items)))
        await asyncio.sleep(0)  # yield: a non-serialized writer would interleave here
        events.append(("exit", len(document.items)))

    controller = TimelineController(empty_doc(), sources, on_change=on_change)
    await asyncio.gather(
        *(controller.apply("add_item", source_clip_id="a") for _ in range(5))
    )

    # All five ops landed.
    assert len(controller.document.items) == 5
    # enter/exit strictly alternate — no interleaving across the await point.
    assert len(events) == 10
    for i in range(0, len(events), 2):
        assert events[i][0] == "enter"
        assert events[i + 1][0] == "exit"
        # The document seen on exit is the same one seen on enter (no writer
        # slipped a mutation in across the yield).
        assert events[i][1] == events[i + 1][1]


# --- Task 1: canonical sequence + review-context fingerprints ----------------


def _seq_item(
    clip="clip-a", start=1.0, end=3.0, speed=1.0, item_id="item-x", **transform
):
    kwargs = {}
    if transform:
        kwargs["transform"] = Transform(**transform)
    return TimelineItem(
        item_id=item_id,
        source_clip_id=clip,
        start_sec=start,
        end_sec=end,
        speed=speed,
        **kwargs,
    )


def test_sequence_fingerprint_ignores_live_item_ids():
    left = TimelineItem(item_id="left", source_clip_id="clip-a", start_sec=1, end_sec=3)
    right = left.model_copy(update={"item_id": "right"})
    assert sequence_fingerprint([left]) == sequence_fingerprint([right])


def test_sequence_fingerprint_changes_with_order():
    a = _seq_item(clip="clip-a")
    b = _seq_item(clip="clip-b")
    assert sequence_fingerprint([a, b]) != sequence_fingerprint([b, a])


def test_sequence_fingerprint_changes_with_bounds():
    assert sequence_fingerprint([_seq_item(end=3.0)]) != sequence_fingerprint(
        [_seq_item(end=4.0)]
    )


def test_sequence_fingerprint_changes_with_speed():
    assert sequence_fingerprint([_seq_item(speed=1.0)]) != sequence_fingerprint(
        [_seq_item(speed=2.0)]
    )


def test_sequence_fingerprint_changes_with_transform():
    assert sequence_fingerprint([_seq_item()]) != sequence_fingerprint(
        [_seq_item(scale=1.5)]
    )


def test_sequence_fingerprint_rounds_floats_to_six_decimals():
    # A sub-micro difference below the sixth decimal is canonically equal.
    assert sequence_fingerprint([_seq_item(start=1.0)]) == sequence_fingerprint(
        [_seq_item(start=1.0 + 1e-9)]
    )


def test_review_context_fingerprint_changes_with_candidate_context():
    doc = TimelineDocument(items=[_seq_item()])
    candidates_a = [{"clip_id": "clip-a", "overall_score": 0.5}]
    candidates_b = [{"clip_id": "clip-a", "overall_score": 0.9}]
    assert review_context_fingerprint(doc, candidates_a) != review_context_fingerprint(
        doc, candidates_b
    )


def test_review_context_fingerprint_stable_for_equal_inputs():
    doc = TimelineDocument(items=[_seq_item()])
    candidates = [{"clip_id": "clip-a", "overall_score": 0.5}]
    assert review_context_fingerprint(doc, candidates) == review_context_fingerprint(
        doc, list(candidates)
    )


def test_review_context_fingerprint_rounds_scores_to_four_decimals():
    doc = TimelineDocument()
    a = [{"clip_id": "c", "overall_score": 0.5000001}]
    b = [{"clip_id": "c", "overall_score": 0.5000002}]
    assert review_context_fingerprint(doc, a) == review_context_fingerprint(doc, b)


def test_review_context_fingerprint_changes_with_decisions():
    doc_a = TimelineDocument(decisions={"clip-a": "included"})
    doc_b = TimelineDocument(decisions={"clip-a": "excluded"})
    assert review_context_fingerprint(doc_a, []) != review_context_fingerprint(doc_b, [])


# --- Task 1: persisted revision + atomic concurrency ------------------------


def test_timeline_document_defaults_revision_zero():
    assert TimelineDocument().revision == 0


@pytest.mark.asyncio
async def test_controller_apply_increments_revision_monotonically():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    assert controller.document.revision == 0
    await controller.apply("add_item", source_clip_id="a")
    assert controller.document.revision == 1
    await controller.apply("add_item", source_clip_id="a")
    assert controller.document.revision == 2


@pytest.mark.asyncio
async def test_controller_undo_redo_keep_revision_monotonic():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a")  # rev 1
    reverted = await controller.undo()  # content empty, but revision advances
    assert reverted.items == []
    assert reverted.revision == 2
    redone = await controller.redo()  # content restored, revision advances again
    assert len(redone.items) == 1
    assert redone.revision == 3


@pytest.mark.asyncio
async def test_controller_sequence_fingerprint_matches_after_undo_despite_newer_revision():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a")
    fingerprint_one_item = sequence_fingerprint(controller.document.items)
    await controller.apply("add_item", source_clip_id="a")
    await controller.undo()
    # Newer revision, identical content → identical sequence fingerprint.
    assert controller.document.revision == 3
    assert sequence_fingerprint(controller.document.items) == fingerprint_one_item


@pytest.mark.asyncio
async def test_controller_apply_rejects_stale_expected_revision_without_mutation():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a")  # rev 1
    before = controller.document
    with pytest.raises(TimelineRevisionConflict) as excinfo:
        await controller.apply("add_item", source_clip_id="a", expected_revision=0)
    assert controller.document is before
    assert excinfo.value.expected_revision == 0
    assert excinfo.value.current_revision == 1


@pytest.mark.asyncio
async def test_controller_apply_accepts_matching_expected_revision():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a", expected_revision=0)
    assert controller.document.revision == 1


@pytest.mark.asyncio
async def test_controller_apply_batch_is_one_revision_notify_and_undo():
    sources = make_sources(("a", 0.0, 2.0, 10.0), ("b", 0.0, 2.0, 10.0))
    notified_revisions = []

    async def on_change(document):
        notified_revisions.append(document.revision)

    controller = TimelineController(empty_doc(), sources, on_change=on_change)
    result = await controller.apply_batch(
        [
            {"operation": "add_item", "args": {"source_clip_id": "a"}},
            {"operation": "add_item", "args": {"source_clip_id": "b"}},
        ],
        expected_revision=0,
    )

    assert [i.source_clip_id for i in result.items] == ["a", "b"]
    # Two operations, but a single revision bump and a single notification.
    assert result.revision == 1
    assert notified_revisions == [1]
    # And a single undo snapshot restoring the pre-batch document.
    reverted = await controller.undo()
    assert reverted.items == []


@pytest.mark.asyncio
async def test_controller_apply_batch_rejects_stale_revision_without_mutation():
    sources = make_sources(("a", 0.0, 2.0, 10.0))
    controller = TimelineController(empty_doc(), sources)
    await controller.apply("add_item", source_clip_id="a")  # rev 1
    before = controller.document
    with pytest.raises(TimelineRevisionConflict):
        await controller.apply_batch(
            [{"operation": "add_item", "args": {"source_clip_id": "a"}}],
            expected_revision=0,
        )
    assert controller.document is before


# --- deterministic ids inside a prepared batch -------------------------------


def _split_then_slow(second_half_id):
    return [
        {"operation": "split_item", "args": {"item_id": "item-1", "at_sec": 3.5}},
        {"operation": "set_speed", "args": {"item_id": second_half_id, "speed": 2.0}},
    ]


def _simulate_batch(document, sources, operations, seed):
    working = document
    with seeded_item_ids(seed):
        for operation in operations:
            working = apply_operation(
                working, sources, operation["operation"], **operation.get("args", {})
            )
    return working


def _second_half_id(document, sources, seed):
    split = _simulate_batch(document, sources, _split_then_slow("unused")[:1], seed)
    return split.items[1].item_id


def _batch_fixture():
    sources = make_sources(("clip-a", 0.0, 10.0, 30.0))
    return TimelineDocument(items=[make_item("item-1", "clip-a", 2.0, 5.0)]), sources


def _item_facts(document):
    return [(i.item_id, i.start_sec, i.end_sec, i.speed) for i in document.items]


@pytest.mark.asyncio
async def test_apply_batch_with_matching_seed_reproduces_simulated_item_ids():
    document, sources = _batch_fixture()
    operations = _split_then_slow(_second_half_id(document, sources, "S"))
    simulated = _simulate_batch(document, sources, operations, "S")
    assert simulated.items[1].speed == 2.0

    controller = TimelineController(document, sources)
    result = await controller.apply_batch(operations, expected_revision=0, id_seed="S")

    assert _item_facts(result) == _item_facts(simulated)
    assert result.revision == 1


@pytest.mark.asyncio
async def test_apply_batch_without_seed_cannot_replay_ids_minted_in_the_batch():
    document, sources = _batch_fixture()
    operations = _split_then_slow(_second_half_id(document, sources, "S"))

    controller = TimelineController(document, sources)
    with pytest.raises(TimelineOpError):
        await controller.apply_batch(operations, expected_revision=0)
    assert controller.document is document


def test_seeded_item_ids_are_a_deterministic_uuid5_hex_sequence():
    with seeded_item_ids("S"):
        first = [_new_item_id() for _ in range(3)]
    with seeded_item_ids("S"):
        second = [_new_item_id() for _ in range(3)]
    assert first == second
    assert len(set(first)) == 3
    assert first[0] == uuid.uuid5(_ITEM_ID_NAMESPACE, "S:0").hex
    assert first[2] == uuid.uuid5(_ITEM_ID_NAMESPACE, "S:2").hex
    with seeded_item_ids("T"):
        assert _new_item_id() != first[0]


def test_item_ids_are_random_again_after_leaving_the_seeded_context():
    with seeded_item_ids("S"):
        seeded = _new_item_id()
    after = [_new_item_id(), _new_item_id()]
    assert after[0] != after[1]
    assert seeded not in after
    assert after[0] != uuid.uuid5(_ITEM_ID_NAMESPACE, "S:1").hex


def test_seeded_item_ids_restores_the_allocator_when_the_body_raises():
    with pytest.raises(RuntimeError):
        with seeded_item_ids("S"):
            raise RuntimeError("boom")
    assert _new_item_id() != uuid.uuid5(_ITEM_ID_NAMESPACE, "S:0").hex


def test_nested_seeded_item_ids_restore_the_outer_seed():
    with seeded_item_ids("outer"):
        first = _new_item_id()
        with seeded_item_ids("inner"):
            inner = _new_item_id()
        second = _new_item_id()
    assert first == uuid.uuid5(_ITEM_ID_NAMESPACE, "outer:0").hex
    assert inner == uuid.uuid5(_ITEM_ID_NAMESPACE, "inner:0").hex
    # The outer sequence resumes where it left off rather than restarting.
    assert second == uuid.uuid5(_ITEM_ID_NAMESPACE, "outer:1").hex


# --- commit before acknowledging (plan 041 task 1.2) --------------------------


def _failing_persist(document):
    raise OSError("disk full")


@pytest.mark.asyncio
async def test_failed_persist_leaves_document_history_and_events_untouched():
    sources = make_sources(("a", 0.0, 2.0, 10.0), ("b", 0.0, 2.0, 10.0))
    published = []
    saved = []
    fail = {"on": False}

    def persist(document):
        if fail["on"]:
            raise TimelinePersistError()
        saved.append(document.revision)

    async def on_change(document):
        published.append(document.revision)

    controller = TimelineController(
        empty_doc(), sources, on_change=on_change, persist=persist
    )
    await controller.apply("add_item", source_clip_id="a")
    await controller.apply("add_item", source_clip_id="b")
    await controller.undo()  # leaves one redo entry
    before = (
        controller.document,
        list(controller._undo),
        list(controller._redo),
        list(published),
    )

    fail["on"] = True
    with pytest.raises(TimelinePersistError, match="Couldn't save the Timeline"):
        await controller.apply("add_item", source_clip_id="a")
    with pytest.raises(TimelinePersistError):
        await controller.apply_batch(
            [{"operation": "add_item", "args": {"source_clip_id": "a"}}],
            expected_revision=controller.document.revision,
        )
    with pytest.raises(TimelinePersistError):
        await controller.undo()
    with pytest.raises(TimelinePersistError):
        await controller.redo()

    after = (
        controller.document,
        list(controller._undo),
        list(controller._redo),
        list(published),
    )
    assert after == before
    assert saved == [1, 2, 3]


@pytest.mark.asyncio
async def test_persist_sees_the_stamped_document_before_it_goes_live():
    seen = []
    controller_holder = {}

    def persist(document):
        seen.append((document.revision, controller_holder["c"].document.revision))

    controller = TimelineController(
        empty_doc(), make_sources(("a", 0.0, 2.0, 10.0)), persist=persist
    )
    controller_holder["c"] = controller
    await controller.apply("add_item", source_clip_id="a")
    assert seen == [(1, 0)]
    assert controller.document.revision == 1
