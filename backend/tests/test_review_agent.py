"""Tests for the in-app review agent in propose mode (Phase C).

The in-app agent never applies edits directly: its mutating tool calls are
captured as a Proposal (staged operations + a diff). Accepting replays the
operations through the operations core (so they land in Undo History); rejecting
discards them. Read access is provided as context, so reads "run normally".
"""

import pytest

from src.models import TimelineDocument, VersionSet
from src.review_state import review_context_fingerprint, sequence_fingerprint
from src.timeline_ops import SourceClip, TimelineController
from src.timeline_service import TimelineEventBroker
from src.review_agent import (
    ProposalStore,
    _parse_agent_json,
    _validate_versions,
    deterministic_versions,
    run_review_turn,
)


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
async def test_accept_is_one_atomic_revision_event_and_undo_snapshot():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    controller = _controller(broker)
    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="Add both clips.",
        operations=[
            {"operation": "include", "args": {"clip_id": "clip-a"}},
            {"operation": "include", "args": {"clip_id": "clip-b"}},
        ],
        baseline_document=controller.document.model_copy(deep=True),
    )

    document = await store.accept(proposal.proposal_id, controller)

    assert document.revision == 1
    assert queue.qsize() == 1
    await controller.undo()
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_accept_rejects_a_proposal_prepared_against_an_older_revision():
    controller = _controller()
    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="Add clip A.",
        operations=[{"operation": "include", "args": {"clip_id": "clip-a"}}],
        baseline_document=controller.document.model_copy(deep=True),
    )
    await controller.apply("include", clip_id="clip-b")
    before = controller.document

    with pytest.raises(Exception, match="revision"):
        await store.accept(proposal.proposal_id, controller)

    assert controller.document is before
    assert proposal.status == "pending"


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
            "versions": [
                {
                    "version_id": "v1",
                    "title": "Calm",
                    "vibe": "slow",
                    "rationale": "Let it breathe.",
                    "profile": "long_scenic",
                    "items": [
                        {
                            "source_clip_id": "clip-a",
                            "start_sec": 1,
                            "end_sec": 7,
                        }
                    ],
                }
            ],
        }

    result = await run_review_turn(
        "p1",
        user_message="Make it calm",
        controller=controller,
        candidates=[
            {
                "clip_id": "clip-a",
                "file_id": "file-a",
                "file_name": "A.MOV",
                "start_sec": 1,
                "end_sec": 7,
                "overall_score": 8,
            }
        ],
        store=store,
        agent=creative_agent,
    )

    version_set = VersionSet.model_validate(result["agent_message"]["payload"]["version_set"])
    assert version_set.versions[0].title == "Calm"
    assert version_set.versions[0].sequence_fingerprint == sequence_fingerprint(
        version_set.versions[0].items
    )
    assert version_set.based_on_timeline_revision == 0


@pytest.mark.asyncio
async def test_run_review_turn_uses_one_captured_snapshot_for_context_and_proposal():
    controller = _controller()
    store = ProposalStore()

    def agent(context):
        assert context["timeline"]["revision"] == 0
        controller._document = controller.document.model_copy(update={"revision": 9})
        return {
            "message": "Add clip A.",
            "operations": [{"operation": "include", "args": {"clip_id": "clip-a"}}],
        }

    result = await run_review_turn(
        "p1",
        user_message="Go",
        controller=controller,
        candidates=[
            {
                "clip_id": "clip-a",
                "file_id": "file-a",
                "file_name": "A.MOV",
                "start_sec": 1.0,
                "end_sec": 7.0,
                "overall_score": 8.0,
            }
        ],
        store=store,
        agent=agent,
    )

    assert result["proposal"]["based_on_timeline_revision"] == 0
    assert result["agent_message"]["payload"]["version_set"][
        "based_on_timeline_revision"
    ] == 0


@pytest.mark.asyncio
async def test_run_review_turn_fingerprints_the_candidate_context_given_to_the_agent():
    candidates = [
        {
            "clip_id": "clip-a",
            "file_id": "file-a",
            "file_name": "A.MOV",
            "start_sec": 1.0,
            "end_sec": 7.0,
            "overall_score": 8.0,
        }
    ]
    expected = review_context_fingerprint(TimelineDocument(), candidates)

    def mutating_agent(context):
        context["candidates"][0]["overall_score"] = 1.0
        return {"message": "No model versions.", "operations": []}

    result = await run_review_turn(
        "p1",
        user_message="Go",
        controller=_controller(),
        candidates=candidates,
        store=ProposalStore(),
        agent=mutating_agent,
    )

    assert result["agent_message"]["payload"]["version_set"][
        "based_on_review_context_fingerprint"
    ] == expected


def test_deterministic_versions_produce_backend_fingerprinted_recipes():
    versions = deterministic_versions(
        [
            {
                "clip_id": "clip-a",
                "file_id": "file-a",
                "file_name": "A.MOV",
                "start_sec": 1.0,
                "end_sec": 7.0,
                "overall_score": 8.0,
            }
        ]
    )

    assert [version.title for version in versions] == [
        "Punchy Social Cut",
        "Cinematic Highlight",
        "Long Scenic",
    ]
    assert all(version.sequence_fingerprint == sequence_fingerprint(version.items) for version in versions)


@pytest.mark.asyncio
async def test_empty_model_versions_use_deterministic_backend_fallback():
    candidates = [
        {
            "clip_id": "clip-a",
            "file_id": "file-a",
            "file_name": "A.MOV",
            "start_sec": 1.0,
            "end_sec": 7.0,
            "overall_score": 8.0,
        }
    ]
    result = await run_review_turn(
        "p1",
        user_message="Make versions",
        controller=_controller(),
        candidates=candidates,
        store=ProposalStore(),
        agent=lambda _context: {"message": "Model unavailable", "operations": []},
    )

    version_set = result["agent_message"]["payload"]["version_set"]
    assert len(version_set["versions"]) == 3
    assert version_set["based_on_review_context_fingerprint"] == review_context_fingerprint(
        TimelineDocument(), candidates
    )


@pytest.mark.asyncio
async def test_retry_resumes_an_incomplete_turn_without_duplicate_editor_message():
    store = ProposalStore()
    message_id = "98e7804a-8128-4389-a283-15e9b482c323b"
    calls = 0

    def interrupted_then_completed(_context):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("interrupted after editor persistence")
        return {"message": "Recovered reply.", "operations": []}

    with pytest.raises(RuntimeError, match="interrupted"):
        await run_review_turn(
            "p1",
            user_message="Faster",
            client_message_id=message_id,
            controller=_controller(),
            candidates=[],
            store=store,
            agent=interrupted_then_completed,
        )

    result = await run_review_turn(
        "p1",
        user_message="Faster",
        client_message_id=message_id,
        controller=_controller(),
        candidates=[],
        store=store,
        agent=interrupted_then_completed,
    )

    assert result["message"] == "Recovered reply."
    assert [message.message_id for message in store.session("p1").messages].count(
        message_id
    ) == 1
