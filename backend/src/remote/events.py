"""``GET /api/projects/{id}/events``: the phone's live view of the Mac (Server-Sent Events).

The stream carries remote DTOs, never raw desktop payloads: ``now-on-mac`` (the
Mac Job summary), ``sources-changed`` and ``timeline-changed`` hints, ``: ping``
every 15 s, and a final ``remote-off`` or ``revoked`` event before the stream
closes. Each device has a bounded queue; one that falls behind gets ``resync``
and is dropped so it refetches.
"""

import asyncio
import json
from typing import Annotated, AsyncIterator

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from ..project_events import ANALYSIS_PROGRESS, SOURCES_CHANGED, TIMELINE_CHANGED
from ..timeline_service import OVERFLOW
from . import summary
from .app import Authed, open_exposed_project, require_session, runtime_of
from .runtime import RemoteRuntime

QUEUE_LIMIT = 64
DEFAULT_PING_SEC = 15.0


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def register_event_routes(app: FastAPI, runtime: RemoteRuntime) -> None:
    @app.get("/api/projects/{project_id}/events")
    async def project_events(
        project_id: str, request: Request, authed: Annotated[Authed, Depends(require_session)]
    ):
        rt = runtime_of(request)
        runtime_id, project = await run_in_threadpool(open_exposed_project, rt, project_id)
        device_id = authed.device.device_id
        subscription = rt.events.subscribe_bounded(runtime_id, QUEUE_LIMIT)
        handle = rt.register_stream(device_id)
        rt.auth.stream_opened(device_id)

        def now_on_mac() -> str:
            return sse("now-on-mac", summary.now_on_mac(project).model_dump())

        def final_event() -> str:
            if handle.reason == "remote-off":
                return sse("remote-off", {})
            return sse("revoked", {})

        async def stream() -> AsyncIterator[str]:
            try:
                yield ": connected\n\n"
                yield now_on_mac()
                while True:
                    if handle.is_closed:
                        yield final_event()
                        return
                    get_task = asyncio.ensure_future(subscription.queue.get())
                    closed_task = asyncio.ensure_future(handle.wait())
                    done, pending = await asyncio.wait(
                        {get_task, closed_task},
                        timeout=rt.sse_ping_sec,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in pending:
                        task.cancel()
                    if closed_task in done:
                        yield final_event()
                        return
                    if get_task not in done:
                        yield ": ping\n\n"
                        continue
                    payload = get_task.result()
                    kind = payload.get("type")
                    if kind == OVERFLOW:
                        yield sse("resync", {})
                        return
                    if kind == ANALYSIS_PROGRESS:
                        yield now_on_mac()
                    elif kind == SOURCES_CHANGED:
                        yield sse("sources-changed", {})
                    elif kind == TIMELINE_CHANGED:
                        yield sse("timeline-changed", {"version": payload.get("version")})
            finally:
                rt.events.unsubscribe(runtime_id, subscription)
                rt.unregister_stream(handle)
                rt.auth.stream_closed(device_id)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )
