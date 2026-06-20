"""Tests for the SSE event broker that live-syncs Timeline Document changes.

Phase A2: an operation through the core must emit a ``timeline-changed`` event
so the GUI (and any other connected client) reconciles from the authoritative
document.
"""

import pytest

from src.models import TimelineDocument
from src.timeline_ops import SourceClip, TimelineController
from src.timeline_service import TimelineEventBroker


def _sources():
    return {
        "clip-a": SourceClip(
            clip_id="clip-a", start_sec=1.0, end_sec=4.0, source_duration_sec=30.0
        )
    }


@pytest.mark.asyncio
async def test_subscriber_receives_published_event():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    await broker.publish("p1", {"type": "timeline-changed"})
    assert queue.get_nowait() == {"type": "timeline-changed"}


@pytest.mark.asyncio
async def test_publish_only_reaches_matching_project():
    broker = TimelineEventBroker()
    q1 = broker.subscribe("p1")
    q2 = broker.subscribe("p2")
    await broker.publish("p1", {"type": "timeline-changed"})
    assert q1.qsize() == 1
    assert q2.qsize() == 0


@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    broker.unsubscribe("p1", queue)
    await broker.publish("p1", {"type": "timeline-changed"})
    assert queue.qsize() == 0


@pytest.mark.asyncio
async def test_operation_through_controller_emits_timeline_changed():
    broker = TimelineEventBroker()
    queue = broker.subscribe("p1")
    controller = TimelineController(
        TimelineDocument(), _sources(), on_change=broker.publisher("p1")
    )

    await controller.apply("add_item", source_clip_id="clip-a")

    event = queue.get_nowait()
    assert event["type"] == "timeline-changed"
