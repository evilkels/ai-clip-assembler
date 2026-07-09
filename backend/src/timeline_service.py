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
from typing import Awaitable, Callable, Dict, Mapping, Optional, Set

from .models import TimelineDocument
from .review_state import review_context_fingerprint, sequence_fingerprint
from .timeline_ops import SourceClip, TimelineController


TIMELINE_CHANGED = "timeline-changed"

OnChange = Callable[[TimelineDocument], Awaitable[None]]
ProjectLookup = Callable[[str], Optional[dict]]
SourceBuilder = Callable[[dict], Mapping[str, SourceClip]]
DocumentLoader = Callable[[dict, Mapping[str, SourceClip]], Optional[TimelineDocument]]
DocumentWriter = Callable[[dict, TimelineDocument], None]
CandidateLister = Callable[[str], list]


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


class TimelineLifecycle:
    """Own per-project Timeline Document controllers and publication."""

    def __init__(
        self,
        *,
        project_lookup: ProjectLookup,
        source_builder: SourceBuilder,
        document_loader: DocumentLoader,
        document_writer: DocumentWriter,
        candidate_lister: CandidateLister,
    ) -> None:
        self._project_lookup = project_lookup
        self._source_builder = source_builder
        self._document_loader = document_loader
        self._document_writer = document_writer
        self._candidate_lister = candidate_lister
        self._controllers: Dict[str, TimelineController] = {}
        self._broker = TimelineEventBroker()

    def get_controller(self, project_id: str) -> TimelineController:
        project = self._project_lookup(project_id)
        if project is None:
            raise KeyError(project_id)
        sources = self._source_builder(project)
        controller = self._controllers.get(project_id)
        if controller is None:
            document = self._document_loader(project, sources) or TimelineDocument()
            controller = TimelineController(
                document,
                sources,
                on_change=self._make_on_change(project_id),
            )
            self._controllers[project_id] = controller
        else:
            controller.update_sources(sources)
        return controller

    def invalidate(self, project_id: str) -> None:
        self._controllers.pop(project_id, None)
        project = self._project_lookup(project_id)
        if project is not None:
            project.pop("timeline_document", None)

    def snapshot(self, project_id: str, document: TimelineDocument) -> dict:
        candidates = self._candidate_lister(project_id)
        return {
            "project_id": project_id,
            "document": document.model_dump(),
            "sequence_fingerprint": sequence_fingerprint(document.items),
            "review_context_fingerprint": review_context_fingerprint(document, candidates),
        }

    def subscribe(self, project_id: str) -> "asyncio.Queue[dict]":
        return self._broker.subscribe(project_id)

    def unsubscribe(self, project_id: str, queue: "asyncio.Queue[dict]") -> None:
        self._broker.unsubscribe(project_id, queue)

    def _make_on_change(self, project_id: str) -> OnChange:
        async def on_change(document: TimelineDocument) -> None:
            project = self._project_lookup(project_id)
            if project is not None:
                self._document_writer(project, document)
            await self._broker.publish(
                project_id,
                {"type": TIMELINE_CHANGED, "version": document.version},
            )

        return on_change
