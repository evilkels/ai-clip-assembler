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
import threading
from typing import Awaitable, Callable, Dict, Mapping, Optional, Set

from .models import TimelineDocument
from .review_state import review_context_fingerprint, sequence_fingerprint
from .timeline_ops import SourceClip, TimelineController, TimelinePersistError


TIMELINE_CHANGED = "timeline-changed"

OnChange = Callable[[TimelineDocument], Awaitable[None]]
ProjectLookup = Callable[[str], Optional[dict]]
SourceBuilder = Callable[[dict], Mapping[str, SourceClip]]
DocumentLoader = Callable[[dict, Mapping[str, SourceClip]], Optional[TimelineDocument]]
DocumentWriter = Callable[[dict, TimelineDocument], None]
CandidateLister = Callable[[str], list]


class Subscription:
    """One subscriber's queue, bound to the event loop that will consume it."""

    def __init__(
        self,
        queue: "asyncio.Queue[dict]",
        loop: Optional[asyncio.AbstractEventLoop],
        bounded: bool,
    ) -> None:
        self.queue = queue
        self.loop = loop
        self.bounded = bounded


OVERFLOW = "overflow"


class TimelineEventBroker:
    """Per-project fan-out of Project events to subscriber queues.

    Despite the historical name it carries every Project event
    (``timeline-changed``, ``analysis-progress``, ``sources-changed``).
    ``publish_threadsafe`` may be called from any thread (an analysis worker, an
    upload finalizer); delivery hops onto each subscriber's own loop with
    ``call_soon_threadsafe``. A bounded subscriber that falls behind is dropped:
    its queue is replaced by a single ``overflow`` marker so its consumer closes
    the stream and refetches instead of buffering without limit.
    """

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[Subscription]] = {}
        self._lock = threading.Lock()

    def subscribe(self, project_id: str) -> "asyncio.Queue[dict]":
        return self.subscribe_bounded(project_id, maxsize=0).queue

    def subscribe_bounded(self, project_id: str, maxsize: int = 0) -> Subscription:
        try:
            loop: Optional[asyncio.AbstractEventLoop] = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        subscription = Subscription(asyncio.Queue(maxsize=maxsize), loop, bounded=maxsize > 0)
        with self._lock:
            self._subscribers.setdefault(project_id, set()).add(subscription)
        return subscription

    def unsubscribe(self, project_id: str, queue_or_subscription) -> None:
        with self._lock:
            subscribers = self._subscribers.get(project_id)
            if subscribers is None:
                return
            for subscription in list(subscribers):
                if subscription is queue_or_subscription or subscription.queue is queue_or_subscription:
                    subscribers.discard(subscription)
            if not subscribers:
                self._subscribers.pop(project_id, None)

    def subscriber_count(self, project_id: str) -> int:
        with self._lock:
            return len(self._subscribers.get(project_id, ()))

    async def publish(self, project_id: str, payload: dict) -> None:
        self.publish_threadsafe(project_id, payload)

    def publish_threadsafe(self, project_id: str, payload: dict) -> None:
        with self._lock:
            targets = list(self._subscribers.get(project_id, ()))
        try:
            running: Optional[asyncio.AbstractEventLoop] = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        for subscription in targets:
            loop = subscription.loop
            if loop is None or loop is running:
                self._deliver(project_id, subscription, payload)
            else:
                try:
                    loop.call_soon_threadsafe(self._deliver, project_id, subscription, payload)
                except RuntimeError:  # its loop is gone: nobody is listening any more
                    self.unsubscribe(project_id, subscription)

    def _deliver(self, project_id: str, subscription: Subscription, payload: dict) -> None:
        try:
            subscription.queue.put_nowait(payload)
        except asyncio.QueueFull:
            self.unsubscribe(project_id, subscription)
            while not subscription.queue.empty():
                subscription.queue.get_nowait()
            subscription.queue.put_nowait({"type": OVERFLOW})

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
                persist=self._make_persist(project_id),
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

    def reset(self) -> None:
        """Drop all cached controllers (used by test/QA teardown)."""
        self._controllers.clear()

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

    def subscribe_bounded(self, project_id: str, maxsize: int) -> Subscription:
        return self._broker.subscribe_bounded(project_id, maxsize)

    def unsubscribe(self, project_id: str, queue_or_subscription) -> None:
        self._broker.unsubscribe(project_id, queue_or_subscription)

    def publish_threadsafe(self, project_id: str, payload: dict) -> None:
        """Publish a Project event from any thread."""
        self._broker.publish_threadsafe(project_id, payload)

    def _make_persist(self, project_id: str):
        def persist(document: TimelineDocument) -> None:
            project = self._project_lookup(project_id)
            if project is None:
                return
            try:
                self._document_writer(project, document)
            except OSError as exc:
                raise TimelinePersistError() from exc

        return persist

    def _make_on_change(self, project_id: str) -> OnChange:
        async def on_change(document: TimelineDocument) -> None:
            await self._broker.publish(
                project_id,
                {"type": TIMELINE_CHANGED, "version": document.version},
            )

        return on_change
