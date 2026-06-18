"""Live-sync glue for the backend-authoritative Timeline Document.

A tiny in-process pub/sub broker. Each connected client (the GUI today, any
agent UI later) subscribes per project and receives a ``timeline-changed`` event
after every operation, so it reconciles from the authoritative document instead
of owning timeline state itself.

The broker stays transport-agnostic: the API layer turns a subscriber queue into
a Server-Sent Events stream, and the same broker can back other transports.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Dict, Set

from .models import TimelineDocument


TIMELINE_CHANGED = "timeline-changed"

OnChange = Callable[[TimelineDocument], Awaitable[None]]


class TimelineEventBroker:
    """Per-project fan-out of timeline events to subscriber queues."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set["asyncio.Queue[dict]"]] = {}

    def subscribe(self, project_id: str) -> "asyncio.Queue[dict]":
        queue: "asyncio.Queue[dict]" = asyncio.Queue()
        self._subscribers.setdefault(project_id, set()).add(queue)
        return queue

    def unsubscribe(self, project_id: str, queue: "asyncio.Queue[dict]") -> None:
        subscribers = self._subscribers.get(project_id)
        if subscribers is None:
            return
        subscribers.discard(queue)
        if not subscribers:
            self._subscribers.pop(project_id, None)

    async def publish(self, project_id: str, payload: dict) -> None:
        for queue in list(self._subscribers.get(project_id, ())):
            queue.put_nowait(payload)

    def publisher(self, project_id: str) -> OnChange:
        """An ``on_change`` hook for a :class:`TimelineController` that emits a
        ``timeline-changed`` event for ``project_id`` after each operation."""

        async def on_change(document: TimelineDocument) -> None:
            await self.publish(
                project_id,
                {"type": TIMELINE_CHANGED, "version": document.version},
            )

        return on_change
