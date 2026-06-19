"""The Timeline Document operations core.

This module is the **only** way a :class:`TimelineDocument` is mutated. The GUI
(over HTTP), the in-app review agent, and external MCP agents all drive the same
named operations through :func:`apply_operation`, so the two adapters cannot
drift.

Operations are pure: each returns a *new* document (the input is never mutated),
which makes snapshot-based undo/redo trivial. :class:`TimelineController` wraps
the core with a bounded per-project history ring and a per-project async write
lock so a GUI edit and an external-agent edit cannot interleave mid-operation.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel

from .models import TimelineDocument, TimelineItem, Transform


DEFAULT_HISTORY_LIMIT = 50


class TimelineOpError(Exception):
    """Raised when an operation is invalid (unknown id, bad bounds, etc.)."""


class SourceClip(BaseModel):
    """What the operations core needs to know about a Candidate Clip.

    Carries the original candidate bounds (used to seed ``add_item`` / ``include``)
    and the full source video duration (used to clamp ``set_bounds``).
    """

    clip_id: str
    start_sec: float
    end_sec: float
    source_duration_sec: float


Sources = Dict[str, SourceClip]


# --- helpers ----------------------------------------------------------------


def _new_item_id() -> str:
    return uuid.uuid4().hex


def _find_index(doc: TimelineDocument, item_id: str) -> int:
    for index, item in enumerate(doc.items):
        if item.item_id == item_id:
            return index
    raise TimelineOpError(f"unknown timeline item: {item_id}")


def _require_source(sources: Sources, clip_id: str) -> SourceClip:
    source = sources.get(clip_id)
    if source is None:
        raise TimelineOpError(f"unknown candidate clip: {clip_id}")
    return source


# --- operations -------------------------------------------------------------
#
# Each handler mutates the already-deep-copied ``doc`` in place and returns it.
# Validation raises ``TimelineOpError`` before any mutation, so a rejected
# operation leaves the document untouched.


def _add_item(
    doc: TimelineDocument,
    sources: Sources,
    *,
    source_clip_id: str,
    at_index: Optional[int] = None,
) -> TimelineDocument:
    source = _require_source(sources, source_clip_id)
    item = TimelineItem(
        item_id=_new_item_id(),
        source_clip_id=source_clip_id,
        start_sec=source.start_sec,
        end_sec=source.end_sec,
    )
    if at_index is None:
        doc.items.append(item)
    else:
        doc.items.insert(at_index, item)
    return doc


def _remove_item(doc: TimelineDocument, sources: Sources, *, item_id: str) -> TimelineDocument:
    index = _find_index(doc, item_id)
    del doc.items[index]
    return doc


def _split_item(
    doc: TimelineDocument, sources: Sources, *, item_id: str, at_sec: float
) -> TimelineDocument:
    index = _find_index(doc, item_id)
    item = doc.items[index]
    if not (item.start_sec < at_sec < item.end_sec):
        raise TimelineOpError(
            f"split point {at_sec} must lie strictly within "
            f"[{item.start_sec}, {item.end_sec}]"
        )
    first = item.model_copy(deep=True, update={"item_id": _new_item_id(), "end_sec": at_sec})
    second = item.model_copy(deep=True, update={"item_id": _new_item_id(), "start_sec": at_sec})
    doc.items[index : index + 1] = [first, second]
    return doc


def _set_bounds(
    doc: TimelineDocument,
    sources: Sources,
    *,
    item_id: str,
    start_sec: float,
    end_sec: float,
) -> TimelineDocument:
    index = _find_index(doc, item_id)
    item = doc.items[index]
    source = _require_source(sources, item.source_clip_id)
    clamped_start = max(0.0, start_sec)
    clamped_end = min(source.source_duration_sec, end_sec)
    if clamped_end <= clamped_start:
        raise TimelineOpError(
            f"bounds [{start_sec}, {end_sec}] clamp to an empty span "
            f"within [0, {source.source_duration_sec}]"
        )
    doc.items[index] = item.model_copy(
        update={"start_sec": clamped_start, "end_sec": clamped_end}
    )
    return doc


def _reorder(doc: TimelineDocument, sources: Sources, *, item_id: str, to_index: int) -> TimelineDocument:
    index = _find_index(doc, item_id)
    if not (0 <= to_index < len(doc.items)):
        raise TimelineOpError(
            f"to_index {to_index} out of range [0, {len(doc.items) - 1}]"
        )
    item = doc.items.pop(index)
    doc.items.insert(to_index, item)
    return doc


def _set_speed(doc: TimelineDocument, sources: Sources, *, item_id: str, speed: float) -> TimelineDocument:
    index = _find_index(doc, item_id)
    if speed <= 0:
        raise TimelineOpError("speed must be > 0")
    doc.items[index] = doc.items[index].model_copy(update={"speed": speed})
    return doc


def _set_transform(doc: TimelineDocument, sources: Sources, *, item_id: str, transform) -> TimelineDocument:
    index = _find_index(doc, item_id)
    try:
        resolved = transform if isinstance(transform, Transform) else Transform.model_validate(transform)
    except Exception as exc:  # pydantic ValidationError → uniform op error
        raise TimelineOpError(f"invalid transform: {exc}") from exc
    doc.items[index] = doc.items[index].model_copy(update={"transform": resolved})
    return doc


def _include(doc: TimelineDocument, sources: Sources, *, clip_id: str) -> TimelineDocument:
    # Review-board accept: record the decision and seed an item if none exists.
    doc.decisions[clip_id] = "included"
    if any(item.source_clip_id == clip_id for item in doc.items):
        return doc
    return _add_item(doc, sources, source_clip_id=clip_id)


def _exclude(doc: TimelineDocument, sources: Sources, *, clip_id: str) -> TimelineDocument:
    # Review-board reject: record the decision and drop every placement.
    doc.decisions[clip_id] = "excluded"
    doc.items = [item for item in doc.items if item.source_clip_id != clip_id]
    return doc


def _reset_decision(doc: TimelineDocument, sources: Sources, *, clip_id: str) -> TimelineDocument:
    # Back to "not yet reviewed": clear the decision and any placements.
    doc.decisions.pop(clip_id, None)
    doc.items = [item for item in doc.items if item.source_clip_id != clip_id]
    return doc


def _set_profile(doc: TimelineDocument, sources: Sources, *, profile: Optional[str]) -> TimelineDocument:
    doc.profile = profile
    return doc


def _set_target_duration(
    doc: TimelineDocument, sources: Sources, *, target_duration_sec: Optional[float]
) -> TimelineDocument:
    if target_duration_sec is not None and target_duration_sec <= 0:
        raise TimelineOpError("target_duration_sec must be > 0")
    doc.target_duration_sec = target_duration_sec
    return doc


OPERATIONS: Dict[str, Callable[..., TimelineDocument]] = {
    "add_item": _add_item,
    "remove_item": _remove_item,
    "split_item": _split_item,
    "set_bounds": _set_bounds,
    "reorder": _reorder,
    "set_speed": _set_speed,
    "set_transform": _set_transform,
    "include": _include,
    "exclude": _exclude,
    "reset_decision": _reset_decision,
    "set_profile": _set_profile,
    "set_target_duration": _set_target_duration,
}


def apply_operation(
    document: TimelineDocument,
    sources: Sources,
    operation: str,
    **args,
) -> TimelineDocument:
    """Run a single named operation, returning a new document.

    The input ``document`` is never mutated. Raises :class:`TimelineOpError` for
    an unknown operation name or invalid arguments.
    """
    handler = OPERATIONS.get(operation)
    if handler is None:
        raise TimelineOpError(f"unknown operation: {operation}")
    working_copy = document.model_copy(deep=True)
    return handler(working_copy, sources, **args)


# --- history + write lock ---------------------------------------------------


OnChange = Callable[[TimelineDocument], Awaitable[None]]


class TimelineController:
    """Stateful per-project wrapper: operations + snapshot undo/redo + lock.

    ``apply`` / ``undo`` / ``redo`` each run under a per-project async write lock
    that serializes the whole mutate-and-notify critical section, so two writers
    (the GUI and an external agent) cannot interleave mid-operation. After every
    state change the optional ``on_change`` hook fires under the same lock — this
    is where A2 wires persistence + the SSE ``timeline-changed`` event.
    """

    def __init__(
        self,
        document: TimelineDocument,
        sources: Sources,
        *,
        history_limit: int = DEFAULT_HISTORY_LIMIT,
        on_change: Optional[OnChange] = None,
    ) -> None:
        self._document = document
        self._sources = sources
        self._history_limit = history_limit
        self._on_change = on_change
        self._undo: List[TimelineDocument] = []
        self._redo: List[TimelineDocument] = []
        self._lock = asyncio.Lock()

    @property
    def document(self) -> TimelineDocument:
        return self._document

    @property
    def sources(self) -> Sources:
        return self._sources

    def update_sources(self, sources: Sources) -> None:
        """Refresh the candidate registry (e.g. after re-analysis adds clips)."""
        self._sources = sources

    @property
    def lock(self) -> asyncio.Lock:
        return self._lock

    def _push_undo(self, snapshot: TimelineDocument) -> None:
        self._undo.append(snapshot)
        if len(self._undo) > self._history_limit:
            self._undo.pop(0)

    async def apply(self, operation: str, **args) -> TimelineDocument:
        async with self._lock:
            new_document = apply_operation(self._document, self._sources, operation, **args)
            self._push_undo(self._document)
            self._document = new_document
            self._redo.clear()
            await self._notify()
            return self._document

    async def undo(self) -> TimelineDocument:
        async with self._lock:
            if not self._undo:
                return self._document
            self._redo.append(self._document)
            self._document = self._undo.pop()
            await self._notify()
            return self._document

    async def redo(self) -> TimelineDocument:
        async with self._lock:
            if not self._redo:
                return self._document
            self._push_undo(self._document)
            self._document = self._redo.pop()
            await self._notify()
            return self._document

    async def _notify(self) -> None:
        if self._on_change is not None:
            await self._on_change(self._document)
