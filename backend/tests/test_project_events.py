import asyncio
import threading

import pytest

from remote_support import LiveServer, RemoteHarness, SSEClient, live_headers
from src import api
from src.project_events import (
    ANALYSIS_PROGRESS,
    SOURCES_CHANGED,
    TIMELINE_CHANGED,
    ProgressGate,
    analysis_percent,
)
from src.timeline_service import OVERFLOW, TimelineEventBroker


@pytest.fixture
def world(tmp_path):
    harness = RemoteHarness(tmp_path / "state")
    project_uuid, folder, runtime_id = harness.make_project(tmp_path, files=("A.MP4", "B.MP4"))
    phone = harness.paired_phone()
    live = LiveServer(harness.app)
    clients = []

    def open_events(project=None, device=None):
        client = SSEClient(
            f"http://127.0.0.1:{live.port}/{harness.runtime.ingress}/api/projects/{project or project_uuid}/events",
            live_headers(device or phone),
        )
        clients.append(client)
        return client

    yield type("World", (), {
        "h": harness, "phone": phone, "project": project_uuid, "runtime_id": runtime_id,
        "folder": folder, "live": live, "open": staticmethod(open_events),
    })
    for client in clients:
        client.stop()
    harness.runtime.close_lease()
    live.stop()
    harness.close()


# --- remote stream ------------------------------------------------------------------


def test_stream_starts_with_the_current_now_on_the_mac_summary(world):
    events = world.open()
    assert events.next() == ("comment", "connected")
    name, data = events.next()
    assert name == "now-on-mac" and data["state"] == "idle"
    assert world.h.auth.connected_count() == 1


def test_an_analysis_threads_progress_reaches_a_remote_subscriber(world):
    events = world.open()
    events.next_matching("now-on-mac")

    def analysis_worker():
        api.set_analysis_progress(
            world.runtime_id, phase="analyzing", step="frame_extraction",
            video_index=1, video_total=2, message="Video 1/2: extracting frame samples",
        )

    thread = threading.Thread(target=analysis_worker)
    thread.start()
    thread.join()

    data = events.next_matching("now-on-mac")
    assert data["state"] == "analyzing"
    assert data["phase"] == "Sampling frames"
    assert data["percent"] == pytest.approx(17.5)
    assert data["message"] == "Video 1/2: extracting frame samples"

    api.set_analysis_progress(world.runtime_id, phase="complete", step="complete", message="done")
    assert events.next_matching("now-on-mac")["state"] == "idle"
    api.set_analysis_progress(world.runtime_id, phase="error", error="FFmpeg crashed")
    failed = events.next_matching("now-on-mac")
    assert failed["state"] == "failed" and failed["message"] == "FFmpeg crashed"


def test_sources_changed_and_timeline_changed_are_forwarded_as_remote_events(world):
    events = world.open()
    events.next_matching("now-on-mac")
    api.publish_project_event(world.runtime_id, {"type": SOURCES_CHANGED})
    assert events.next_matching("sources-changed") == {}
    api.publish_project_event(world.runtime_id, {"type": TIMELINE_CHANGED, "version": 2})
    assert events.next_matching("timeline-changed") == {"version": 2}


def test_events_of_other_projects_are_not_delivered(world, tmp_path):
    other_uuid, _, other_runtime = world.h.make_project(tmp_path, "other")
    events = world.open()
    events.next_matching("now-on-mac")
    api.publish_project_event(other_runtime, {"type": SOURCES_CHANGED})
    events.expect_quiet()


def test_ping_comments_keep_the_stream_alive(world):
    world.h.runtime.sse_ping_sec = 0.15
    events = world.open()
    events.next_matching("now-on-mac")
    assert events.next_matching("comment", timeout=2) == "ping"


def test_revoke_closes_that_devices_stream_with_a_final_revoked_event(world):
    events = world.open()
    events.next_matching("now-on-mac")
    device_id = world.h.auth.list_devices()[0]["device_id"]

    world.h.auth.revoke(device_id)

    assert events.next_matching("revoked") == {}
    assert events.closed.wait(3)
    assert world.h.auth.connected_count() == 0
    # ...and the same cookies cannot open it again.
    again = world.open()
    assert again.next()[0] == "error" and again.status == 401


def test_revoking_one_device_leaves_other_devices_streams_open(world):
    second = world.h.paired_phone("iPad")
    mine = world.open()
    theirs = world.open(device=second)
    mine.next_matching("now-on-mac")
    theirs.next_matching("now-on-mac")
    assert world.h.auth.connected_count() == 2

    world.h.auth.revoke(world.h.auth.list_devices()[0]["device_id"])
    assert mine.next_matching("revoked") == {}
    theirs.expect_quiet()
    assert not theirs.closed.is_set()


def test_disabling_remote_view_ends_streams_with_remote_off(world):
    events = world.open()
    events.next_matching("now-on-mac")
    world.h.runtime.close_lease()
    assert events.next_matching("remote-off") == {}
    assert events.closed.wait(3)


def test_disconnect_closes_the_stream(world):
    events = world.open()
    events.next_matching("now-on-mac")
    assert world.phone.post("/api/disconnect").status_code == 200
    assert events.next_matching("revoked") == {}


def test_events_need_a_session_and_an_exposed_project(world, tmp_path):
    hidden, _, _ = world.h.make_project(tmp_path, "hidden", shown=False)
    forbidden = world.open(project=hidden)
    assert forbidden.next()[0] == "error" and forbidden.status == 404
    anonymous = world.h.phone()
    nobody = SSEClient(
        f"http://127.0.0.1:{world.live.port}/{world.h.runtime.ingress}/api/projects/{world.project}/events",
        anonymous.headers(),
    )
    assert nobody.next()[0] == "error" and nobody.status == 401


def test_sse_responses_carry_the_security_headers(world):
    import httpx

    with httpx.stream(
        "GET",
        f"http://127.0.0.1:{world.live.port}/{world.h.runtime.ingress}/api/projects/{world.project}/events",
        headers=live_headers(world.phone),
        timeout=5,
    ) as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"


# --- broker -----------------------------------------------------------------------------------


def test_slow_subscribers_are_dropped_with_an_overflow_marker():
    async def scenario():
        broker = TimelineEventBroker()
        slow = broker.subscribe_bounded("p", maxsize=2)
        healthy = broker.subscribe_bounded("p", maxsize=100)
        for n in range(5):
            await broker.publish("p", {"type": SOURCES_CHANGED, "n": n})
        assert slow.queue.get_nowait() == {"type": OVERFLOW}
        assert slow.queue.empty()
        assert broker.subscriber_count("p") == 1  # the slow one was removed
        assert healthy.queue.qsize() == 5

    asyncio.run(scenario())


def test_publish_from_another_thread_reaches_a_subscriber_on_its_loop():
    async def scenario():
        broker = TimelineEventBroker()
        subscription = broker.subscribe_bounded("p", maxsize=10)
        threading.Thread(
            target=broker.publish_threadsafe, args=("p", {"type": ANALYSIS_PROGRESS})
        ).start()
        assert await asyncio.wait_for(subscription.queue.get(), 2) == {"type": ANALYSIS_PROGRESS}

    asyncio.run(scenario())


def test_unsubscribe_stops_delivery_and_is_idempotent():
    async def scenario():
        broker = TimelineEventBroker()
        subscription = broker.subscribe_bounded("p", maxsize=10)
        broker.unsubscribe("p", subscription)
        broker.unsubscribe("p", subscription)
        await broker.publish("p", {"type": SOURCES_CHANGED})
        assert subscription.queue.empty()

    asyncio.run(scenario())


# --- throttling and the desktop stream -----------------------------------------------------------


def test_progress_gate_allows_one_per_second_plus_every_phase_change():
    now = {"t": 100.0}
    gate = ProgressGate(clock=lambda: now["t"])
    assert gate.allow("p", "analyzing") is True
    now["t"] += 0.4
    assert gate.allow("p", "analyzing") is False
    now["t"] += 0.4
    assert gate.allow("p", "analyzing") is False
    now["t"] += 0.3  # 1.1 s since the last published one
    assert gate.allow("p", "analyzing") is True
    assert gate.allow("p", "complete") is True  # a phase change is never throttled
    assert gate.allow("other", "analyzing") is True  # per project


def test_analysis_progress_events_are_throttled_on_the_wire(tmp_path):
    api.projects.clear()
    now = {"t": 0.0}
    original = api._progress_gate
    api._progress_gate = ProgressGate(clock=lambda: now["t"])
    try:
        harness = RemoteHarness(tmp_path / "state")
        _uuid, _folder, runtime_id = harness.make_project(tmp_path)

        async def scenario():
            subscription = api.project_events.subscribe_bounded(runtime_id, 100)
            for _ in range(20):
                api.set_analysis_progress(runtime_id, phase="analyzing", step="starting", video_total=1)
            now["t"] += 1.2
            api.set_analysis_progress(runtime_id, phase="analyzing", step="scene_detection", video_total=1)
            api.set_analysis_progress(runtime_id, phase="complete", step="complete")
            events = []
            while not subscription.queue.empty():
                events.append(subscription.queue.get_nowait())
            return events

        events = asyncio.run(scenario())
        assert [e["type"] for e in events] == [ANALYSIS_PROGRESS] * 3
        assert [e["phase"] for e in events] == ["analyzing", "analyzing", "complete"]
        assert events[1]["step"] == "scene_detection"
        harness.close()
    finally:
        api._progress_gate = original


def test_the_desktop_event_stream_carries_all_three_event_types(tmp_path):
    harness = RemoteHarness(tmp_path / "state")
    _uuid, _folder, runtime_id = harness.make_project(tmp_path)

    async def scenario():
        queue = api._timeline_lifecycle.subscribe(runtime_id)
        api.set_analysis_progress(runtime_id, phase="analyzing", step="starting", video_total=1)
        api.publish_project_event(runtime_id, {"type": SOURCES_CHANGED})
        api.projects[runtime_id]["clips"] = [
            {"clip_id": "c1", "file_id": "A.MP4", "file_name": "A.MP4", "start_sec": 0.0,
             "end_sec": 2.0, "duration_sec": 2.0, "overall_score": 8}
        ]
        controller = api.get_timeline_controller(runtime_id)
        await controller.apply("add_item", source_clip_id="c1")
        types = []
        while not queue.empty():
            types.append(queue.get_nowait()["type"])
        return types

    assert set(asyncio.run(scenario())) == {ANALYSIS_PROGRESS, SOURCES_CHANGED, TIMELINE_CHANGED}
    harness.close()


def test_analysis_percent_follows_the_macs_counters():
    assert analysis_percent({}) is None
    assert analysis_percent({"video_total": 4, "video_index": 1, "step": "starting"}) == 0.0
    assert analysis_percent({"video_total": 4, "video_index": 3, "step": "starting"}) == 50.0
    scoring = {"video_total": 1, "video_index": 1, "step": "scoring_clips", "clip_total": 4, "clip_index": 2}
    assert analysis_percent(scoring) == 87.5
    assert analysis_percent({"video_total": 1, "video_index": 9, "step": "scoring_clips"}) <= 100.0
