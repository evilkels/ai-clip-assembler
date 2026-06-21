"""Tests for the in-app review agent in propose mode (Phase C).

The in-app agent never applies edits directly: its mutating tool calls are
captured as a Proposal (staged operations + a diff). Accepting replays the
operations through the operations core (so they land in Undo History); rejecting
discards them. Read access is provided as context, so reads "run normally".
"""

import pytest

from src.models import TimelineDocument
from src.timeline_ops import SourceClip, TimelineController
from src.timeline_service import TimelineEventBroker
from src.review_agent import ProposalStore, _parse_agent_json, _validate_versions, run_review_turn


def _sources():
    return {
        "clip-a": SourceClip(clip_id="clip-a", start_sec=1.0, end_sec=7.0, source_duration_sec=30.0),
        "clip-b": SourceClip(clip_id="clip-b", start_sec=2.0, end_sec=5.0, source_duration_sec=30.0),
    }


def _controller(broker=None):
    return TimelineController(
        TimelineDocument(),
        _sources(),
        on_change=broker.publisher("p1") if broker else None,
    )


def test_create_proposal_does_not_touch_live_document():
    controller = _controller()
    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="I'd add the orbit shot.",
        operations=[{"operation": "include", "args": {"clip_id": "clip-a"}}],
    )
    assert proposal.status == "pending"
    assert proposal.operations[0]["operation"] == "include"
    # Live document is untouched until accepted.
    assert controller.document.items == []
    # The diff describes the staged result.
    assert proposal.before_item_count == 0
    assert proposal.after_item_count == 1
    assert proposal.summary  # human-readable lines


def test_create_proposal_rejects_invalid_operations():
    controller = _controller()
    store = ProposalStore()
    with pytest.raises(Exception):
        store.create(
            "p1",
            controller,
            message="bad",
            operations=[{"operation": "remove_item", "args": {"item_id": "missing"}}],
        )


@pytest.mark.asyncio
async def test_accept_replays_operations_through_the_core():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    controller = _controller(broker)
    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="Add and slow the orbit.",
        operations=[
            {"operation": "include", "args": {"clip_id": "clip-a"}},
        ],
    )

    document = await store.accept(proposal.proposal_id, controller)

    assert store.get(proposal.proposal_id).status == "accepted"
    assert [i.source_clip_id for i in document.items] == ["clip-a"]
    # Replayed through the core => emitted an event and is undoable.
    assert queue.get_nowait()["type"] == "timeline-changed"
    await controller.undo()
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_reject_discards_without_changing_the_document():
    controller = _controller()
    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="maybe",
        operations=[{"operation": "include", "args": {"clip_id": "clip-a"}}],
    )

    store.reject(proposal.proposal_id)

    assert store.get(proposal.proposal_id).status == "rejected"
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_accept_after_reject_is_an_error():
    controller = _controller()
    store = ProposalStore()
    proposal = store.create(
        "p1", controller, message="x",
        operations=[{"operation": "include", "args": {"clip_id": "clip-a"}}],
    )
    store.reject(proposal.proposal_id)
    with pytest.raises(Exception):
        await store.accept(proposal.proposal_id, controller)


@pytest.mark.asyncio
async def test_run_review_turn_captures_agent_tool_calls_as_a_proposal():
    controller = _controller()
    store = ProposalStore()

    # Stub agent: given read context, returns a message + mutating tool calls.
    def stub_agent(context):
        assert "candidates" in context and "timeline" in context
        return {
            "message": "I'd accept the orbit and slow it to 0.5x.",
            "operations": [
                {"operation": "include", "args": {"clip_id": "clip-a"}},
            ],
        }

    result = await run_review_turn(
        "p1",
        user_message="Make it cinematic",
        controller=controller,
        candidates=[{"clip_id": "clip-a", "overall_score": 8.0}],
        store=store,
        agent=stub_agent,
    )

    assert result["message"].startswith("I'd accept")
    assert result["proposal"]["status"] == "pending"
    # Nothing applied yet — it is a proposal.
    assert controller.document.items == []
    assert store.get(result["proposal"]["proposal_id"]) is not None


@pytest.mark.asyncio
async def test_run_review_turn_with_no_operations_returns_message_only():
    controller = _controller()
    store = ProposalStore()

    def chatty_agent(context):
        return {"message": "Looks great already!", "operations": []}

    result = await run_review_turn(
        "p1",
        user_message="thoughts?",
        controller=controller,
        candidates=[],
        store=store,
        agent=chatty_agent,
    )
    assert result["message"] == "Looks great already!"
    assert result["proposal"] is None


def test_parse_agent_json_preserves_creative_versions():
    parsed = _parse_agent_json(
        '''{"message":"Three directions.","operations":[],"versions":[{"version_id":"v1","title":"Calm","vibe":"slow","rationale":"Let it breathe.","profile":"long_scenic","items":[]}]}'''
    )

    assert parsed["versions"][0]["title"] == "Calm"


def test_validate_versions_rejects_unknown_sources_and_recomputes_duration():
    candidates = [
        {
            "clip_id": "clip-a",
            "file_id": "file-a",
            "file_name": "A.MOV",
            "start_sec": 1.0,
            "end_sec": 7.0,
        }
    ]
    raw = [
        {
            "version_id": "valid",
            "title": "Calm",
            "vibe": "slow",
            "rationale": "One clean beat.",
            "profile": "long_scenic",
            "total_duration_sec": 999,
            "items": [
                {
                    "source_clip_id": "clip-a",
                    "file_id": "file-a",
                    "file_name": "A.MOV",
                    "start_sec": 1.0,
                    "end_sec": 7.0,
                    "speed": 0.5,
                    "transform": {"scale": 1, "x": 0, "y": 0},
                }
            ],
        },
        {
            "version_id": "bad",
            "title": "Bad",
            "vibe": "bad",
            "rationale": "Unknown source.",
            "profile": "short_social",
            "items": [{"source_clip_id": "missing"}],
        },
    ]

    versions = _validate_versions(raw, candidates)

    assert [version["version_id"] for version in versions] == ["valid"]
    assert versions[0]["total_duration_sec"] == 12.0


def test_validate_versions_rejects_invalid_transform():
    candidates = [
        {
            "clip_id": "clip-a",
            "file_id": "file-a",
            "file_name": "A.MOV",
            "start_sec": 0,
            "end_sec": 4,
        }
    ]
    raw = [
        {
            "version_id": "bad-transform",
            "title": "Bad",
            "vibe": "broken",
            "rationale": "Invalid transform.",
            "profile": "short_social",
            "items": [
                {
                    "source_clip_id": "clip-a",
                    "start_sec": 0,
                    "end_sec": 4,
                    "speed": 1,
                    "transform": {"scale": 0, "x": 0, "y": 0},
                }
            ],
        }
    ]

    assert _validate_versions(raw, candidates) == []


@pytest.mark.asyncio
async def test_run_review_turn_persists_versions_and_history_in_agent_message():
    controller = _controller()
    store = ProposalStore()

    def creative_agent(context):
        assert [message["role"] for message in context["history"]] == ["editor"]
        return {
            "message": "I made a calm version.",
            "operations": [],
            "versions": [{"version_id": "v1", "title": "Calm"}],
        }

    result = await run_review_turn(
        "p1",
        user_message="Make it calm",
        controller=controller,
        candidates=[],
        store=store,
        agent=creative_agent,
    )

    assert result["agent_message"]["payload"]["versions"][0]["title"] == "Calm"
