"""Tests for the in-app review agent in propose mode (Phase C).

The in-app agent never applies edits directly: its mutating tool calls are
captured as a Proposal (staged operations + a diff). Accepting replays the
operations through the operations core (so they land in Undo History); rejecting
discards them. Read access is provided as context, so reads "run normally".
"""

import subprocess
import uuid

import pytest

from src import review_agent
from src.models import TimelineDocument, VersionSet
from src.review_state import review_context_fingerprint, sequence_fingerprint
from src.timeline_ops import SourceClip, TimelineController, apply_operation, seeded_item_ids
from src.timeline_script import API_REFERENCE
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
        "clip-a": SourceClip(
            clip_id="clip-a", start_sec=1.0, end_sec=7.0, source_duration_sec=30.0, file_name="A.MOV"
        ),
        "clip-b": SourceClip(
            clip_id="clip-b", start_sec=2.0, end_sec=5.0, source_duration_sec=30.0, file_name="B.MOV"
        ),
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
    assert proposal.summary == ["Accept A.MOV 1.0–7.0 s"]


@pytest.mark.asyncio
async def test_proposal_change_list_names_items_by_position_and_file_as_each_step_finds_them():
    controller = _controller()
    await controller.apply("include", clip_id="clip-a")
    orbit = controller.document.items[0].item_id

    proposal = ProposalStore().create(
        "p1",
        controller,
        message="Tighten the orbit.",
        operations=[
            {"operation": "add_item", "args": {"source_clip_id": "clip-b", "at_index": 0}},
            {"operation": "set_bounds", "args": {"item_id": orbit, "start_sec": 4, "end_sec": 7}},
            {"operation": "reorder", "args": {"item_id": orbit, "to_index": 0}},
            {"operation": "set_speed", "args": {"item_id": orbit, "speed": 2}},
            {"operation": "split_item", "args": {"item_id": orbit, "at_sec": 5.5}},
            {"operation": "set_target_duration", "args": {"target_duration_sec": 40}},
            {"operation": "exclude", "args": {"clip_id": "clip-b"}},
        ],
    )

    assert proposal.summary == [
        "Add B.MOV 2.0–5.0 s at position 1",
        "Trim item 2 (A.MOV) to 4.0–7.0 s",
        "Move item 2 (A.MOV) to position 1",
        "Set speed 2× on item 1 (A.MOV)",
        "Split item 1 (A.MOV) at 5.5 s",
        "Set target duration to 40.0 s",
        "Reject B.MOV 2.0–5.0 s",
    ]
    assert proposal.before_duration_sec == 6.0
    assert proposal.after_duration_sec == 1.5


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
async def test_accept_replays_items_created_earlier_in_the_same_proposal(monkeypatch):
    controller = _controller()
    await controller.apply("include", clip_id="clip-a")
    original_id = controller.document.items[0].item_id
    revision = controller.document.revision
    undo_baseline = controller.document

    # Pin the Proposal id so the test can name the item its split will create.
    pinned = uuid.UUID(int=42)
    monkeypatch.setattr(review_agent.uuid, "uuid4", lambda: pinned)
    split = {"operation": "split_item", "args": {"item_id": original_id, "at_sec": 3.0}}
    with seeded_item_ids(pinned.hex):
        second_half_id = apply_operation(
            controller.document, controller.sources, "split_item", **split["args"]
        ).items[1].item_id

    store = ProposalStore()
    proposal = store.create(
        "p1",
        controller,
        message="Split the orbit and slow the second half.",
        operations=[
            split,
            {"operation": "set_speed", "args": {"item_id": second_half_id, "speed": 0.5}},
        ],
    )
    assert proposal.proposal_id == pinned.hex
    assert proposal.after_item_count == 2

    document = await store.accept(proposal.proposal_id, controller)

    # One atomic transition: a single revision bump and a single undo snapshot.
    assert document.revision == revision + 1
    assert [i.item_id for i in document.items][1] == second_half_id
    assert [i.speed for i in document.items] == [1.0, 0.5]
    await controller.undo()
    assert controller.document.items == undo_baseline.items


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
            "versions": [
                {
                    "version_id": "v1",
                    "profile": "long_scenic",
                    "items": [{"source_clip_id": "clip-a", "start_sec": 1.0, "end_sec": 7.0}],
                }
            ],
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


_CANDIDATES = [
    {
        "clip_id": "clip-a",
        "file_id": "file-a",
        "file_name": "A.MOV",
        "start_sec": 1.0,
        "end_sec": 7.0,
        "overall_score": 8.0,
    },
    {
        "clip_id": "clip-b",
        "file_id": "file-a",
        "file_name": "A.MOV",
        "start_sec": 2.0,
        "end_sec": 5.0,
        "overall_score": 9.0,
    },
]


def test_default_agent_offers_the_script_api_and_returns_the_model_script(monkeypatch):
    prompts = []

    def fake_pi(command, **_kwargs):
        prompts.append(command[-1])
        return subprocess.CompletedProcess(
            command, 0, stdout='{"message":"Sorted.","script":"timeline:clear()"}', stderr=""
        )

    monkeypatch.setattr(review_agent.subprocess, "run", fake_pi)

    reply = review_agent.default_review_agent({"user_message": "Sort by score", "candidates": []})

    assert API_REFERENCE in prompts[0]
    assert reply["script"] == "timeline:clear()"


@pytest.mark.asyncio
async def test_agent_script_reply_becomes_a_proposal_on_the_agent_message_without_versions():
    controller = _controller()
    store = ProposalStore()
    script = (
        "local clips = library:clips()\n"
        "table.sort(clips, function(a, b) return a.score > b.score end)\n"
        "for _, clip in ipairs(clips) do timeline:add(clip) end"
    )

    result = await run_review_turn(
        "p1",
        user_message="Best first",
        controller=controller,
        candidates=_CANDIDATES,
        store=store,
        agent=lambda _context: {
            "message": "Best first.",
            "script": script,
            # Ignored: the script wins.
            "operations": [{"operation": "include", "args": {"clip_id": "clip-a"}}],
        },
    )

    agent_message = result["agent_message"]
    assert agent_message["script"]["author"] == "agent"
    assert agent_message["script"]["source"] == script
    assert agent_message["script"]["error"] is None
    assert agent_message["script"]["proposal_id"] == result["proposal"]["proposal_id"]
    assert [op["args"]["source_clip_id"] for op in result["proposal"]["operations"]] == [
        "clip-b",
        "clip-a",
    ]
    assert "version_set" not in agent_message["payload"]
    assert controller.document.items == []


@pytest.mark.asyncio
async def test_agent_operations_without_versions_attach_no_fabricated_versions():
    result = await run_review_turn(
        "p1",
        user_message="Add the orbit",
        controller=_controller(),
        candidates=_CANDIDATES,
        store=ProposalStore(),
        agent=lambda _context: {
            "message": "Adding the orbit.",
            "operations": [{"operation": "include", "args": {"clip_id": "clip-a"}}],
        },
    )

    assert result["proposal"]["status"] == "pending"
    assert "version_set" not in result["agent_message"]["payload"]


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
