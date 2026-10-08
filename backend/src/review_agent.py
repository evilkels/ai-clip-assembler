"""In-app review agent — propose mode (Phase C).

The in-app agent is an MCP client of our own server, but unlike an External
Agent it **proposes** rather than applies. Its mutating tool calls are captured
as a :class:`Proposal` — staged operations plus a human-readable diff — instead
of mutating the live Timeline Document. Accepting **replays** the operations
through the operations core (so they land in Undo History); rejecting discards
them. Read access runs normally (provided here as context).

The actual model call is injected as an ``agent`` callable so the loop is
deterministic and testable; the default implementation uses the configured
provider and model.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import uuid
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .models import (
    CreativeVersion,
    CreativeVersionItem,
    Proposal,
    ReviewMessage,
    ReviewSession,
    ScriptRun,
    ScriptRunError,
    TimelineDocument,
    TimelineItem,
    VersionSet,
)
from .app_settings import get_settings
from .project_store import read_review_session, write_review_session
from .review_state import review_context_fingerprint, sequence_fingerprint
from .timeline_ops import (
    OPERATIONS,
    Sources,
    TimelineController,
    TimelineOpError,
    apply_operation_in_place,
    seeded_item_ids,
)
from .timeline_script import API_REFERENCE, run_script


logger = logging.getLogger("uvicorn.error")
REPO_ROOT = Path(__file__).resolve().parents[2]


class ReviewAgentError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clip_label(sources: Sources, clip_id: str) -> str:
    source = sources.get(clip_id)  # exclude/reset_decision accept unknown clip ids
    if source is None or source.file_name is None:
        return clip_id
    return f"{source.file_name} {source.start_sec:.1f}–{source.end_sec:.1f} s"


def _locate(document: TimelineDocument, item_id: str) -> Tuple[int, TimelineItem]:
    """The item's 1-based position in ``document``, and the item."""
    for position, item in enumerate(document.items, start=1):
        if item.item_id == item_id:
            return position, item
    # Most steps are described before they apply, so the core has not rejected this yet.
    raise TimelineOpError(f"unknown timeline item: {item_id}")


def _describe(document: TimelineDocument, sources: Sources, operation: str, args: dict) -> str:
    """A short human-readable line for one staged operation, as it applies to ``document``."""
    if operation in ("include", "exclude", "reset_decision"):
        verb = {"include": "Accept", "exclude": "Reject", "reset_decision": "Clear the decision on"}
        return f"{verb[operation]} {_clip_label(sources, args['clip_id'])}"
    if operation == "add_item":
        at_index = args.get("at_index")
        where = "at the end" if at_index is None else f"at position {at_index + 1}"
        return f"Add {_clip_label(sources, args['source_clip_id'])} {where}"
    if operation == "set_profile":
        return f"Set profile to {args.get('profile')}"
    if operation == "set_target_duration":
        target = args.get("target_duration_sec")
        if target is None:
            return "Clear the target duration"
        return f"Set target duration to {target:.1f} s"
    if "item_id" not in args:
        return f"{operation} {args}"
    position, target = _locate(document, args["item_id"])
    source = sources.get(target.source_clip_id)
    item = f"item {position} ({source.file_name if source and source.file_name else target.source_clip_id})"
    if operation == "remove_item":
        return f"Remove {item}"
    if operation == "split_item":
        return f"Split {item} at {args['at_sec']:.1f} s"
    if operation == "set_bounds":
        return f"Trim {item} to {target.start_sec:.1f}–{target.end_sec:.1f} s"
    if operation == "reorder":
        return f"Move {item} to position {args['to_index'] + 1}"
    if operation == "set_speed":
        return f"Set speed {args['speed']:g}× on {item}"
    if operation == "set_transform":
        return f"Reframe {item}"
    return f"{operation} {args}"


def _effective_duration(document: TimelineDocument) -> float:
    return sum(item.effective_duration_sec for item in document.items)


def _simulate(
    document: TimelineDocument,
    sources: Sources,
    operations: List[dict],
    id_seed: Optional[str] = None,
) -> Tuple[TimelineDocument, List[str]]:
    """Apply the staged operations to a throwaway copy to compute the diff.

    Returns the resulting document and one change-list line per operation,
    each describing the document that operation applied to. Raises
    ``TimelineOpError`` if any staged operation is invalid, so a bad
    proposal is rejected at creation time rather than on accept. With
    ``id_seed`` the items the operations create get deterministic ids, so later
    operations in the batch can refer to them (see ``seeded_item_ids``).
    """
    working = document.model_copy(deep=True)
    summary = []
    with seeded_item_ids(id_seed) if id_seed is not None else nullcontext():
        for op in operations:
            operation, args = op["operation"], op.get("args", {})
            # A trim is described after it lands, so the line shows the clamped bounds;
            # it never moves the item, so the position is the pre-step one.
            if operation != "set_bounds":
                summary.append(_describe(working, sources, operation, args))
            apply_operation_in_place(working, sources, operation, **args)
            if operation == "set_bounds":
                summary.append(_describe(working, sources, operation, args))
    return working, summary


class ProposalStore:
    """Backend-authoritative Review Sessions and staged Proposals."""

    def __init__(self) -> None:
        self._sessions: Dict[str, ReviewSession] = {}
        self._folders: Dict[str, Path] = {}

    def configure_project(self, project_id: str, project_folder: Optional[Path] = None) -> None:
        if project_folder is not None:
            self._folders[project_id] = project_folder
            saved = read_review_session(project_folder)
            if saved is not None:
                for message in saved.messages:
                    if message.proposal is not None:
                        message.proposal.project_id = project_id
                self._sessions[project_id] = saved
                return
        self._sessions.setdefault(
            project_id,
            ReviewSession(session_id=uuid.uuid4().hex, updated_at=_now()),
        )

    def session(self, project_id: str) -> ReviewSession:
        if project_id not in self._sessions:
            self.configure_project(project_id)
        return self._sessions[project_id]

    def clear_session(self, project_id: str) -> ReviewSession:
        """Discard the conversation and staged proposals, starting a fresh session.

        Keeps the project's configured folder so the empty session persists,
        replacing any saved transcript on disk.
        """
        fresh = ReviewSession(session_id=uuid.uuid4().hex, updated_at=_now())
        self._sessions[project_id] = fresh
        self._save(project_id)
        return fresh

    def append_message(
        self,
        project_id: str,
        *,
        role: str,
        text: str,
        proposal: Optional[Proposal] = None,
        script: Optional[ScriptRun] = None,
        payload: Optional[dict] = None,
        message_id: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
    ) -> ReviewMessage:
        timestamp = _now()
        message = ReviewMessage(
            message_id=message_id or uuid.uuid4().hex,
            role=role,
            text=text,
            created_at=timestamp,
            reply_to_message_id=reply_to_message_id,
            proposal=proposal,
            script=script,
            payload=payload or {},
        )
        session = self.session(project_id)
        session.messages.append(message)
        session.updated_at = timestamp
        self._save(project_id)
        return message

    def _save(self, project_id: str) -> None:
        folder = self._folders.get(project_id)
        if folder is not None:
            write_review_session(folder, self.session(project_id))

    def create(
        self,
        project_id: str,
        controller: TimelineController,
        *,
        message: str,
        operations: List[dict],
        record_message: bool = True,
        baseline_document: Optional[TimelineDocument] = None,
        proposal_id: Optional[str] = None,
    ) -> Proposal:
        baseline = baseline_document or controller.document.model_copy(deep=True)
        # Validate by simulating on the captured document (no live mutation).
        # The id is minted first because it seeds the item ids of the simulation;
        # accept() replays with the same seed so both runs agree. A script run
        # passes the id it already seeded its recording with.
        proposal_id = proposal_id or uuid.uuid4().hex
        resulting, summary = _simulate(baseline, controller.sources, operations, id_seed=proposal_id)
        proposal = Proposal(
            proposal_id=proposal_id,
            project_id=project_id,
            message=message,
            operations=operations,
            summary=summary,
            before_item_count=len(baseline.items),
            after_item_count=len(resulting.items),
            before_duration_sec=_effective_duration(baseline),
            after_duration_sec=_effective_duration(resulting),
            based_on_timeline_revision=baseline.revision,
        )
        if record_message:
            self.append_message(
                project_id,
                role="agent",
                text=message,
                proposal=proposal,
            )
        return proposal

    def get(self, proposal_id: str, project_id: Optional[str] = None) -> Optional[Proposal]:
        project_ids = [project_id] if project_id is not None else list(self._sessions)
        for candidate_project_id in project_ids:
            for message in self.session(candidate_project_id).messages:
                if message.proposal and message.proposal.proposal_id == proposal_id:
                    return message.proposal
        return None

    def list_for_project(self, project_id: str) -> List[Proposal]:
        return [
            message.proposal
            for message in self.session(project_id).messages
            if message.proposal is not None
        ]

    async def accept(
        self,
        proposal_id: str,
        controller: TimelineController,
        project_id: Optional[str] = None,
    ) -> TimelineDocument:
        proposal = self._require(proposal_id, project_id)
        if proposal.status != "pending":
            raise ReviewAgentError(f"proposal {proposal_id} is {proposal.status}, not pending")
        # Seeding with the proposal id reproduces the ids the simulation minted.
        # Proposals saved before this seeding existed only reference pre-existing
        # items, so seeding them here is harmless.
        document = await controller.apply_batch(
            proposal.operations,
            expected_revision=proposal.based_on_timeline_revision,
            id_seed=proposal.proposal_id,
        )
        proposal.status = "accepted"
        self._save(proposal.project_id)
        return document

    def reject(self, proposal_id: str, project_id: Optional[str] = None) -> Proposal:
        proposal = self._require(proposal_id, project_id)
        if proposal.status == "accepted":
            raise ReviewAgentError(f"proposal {proposal_id} already accepted")
        proposal.status = "rejected"
        self._save(proposal.project_id)
        return proposal

    def supersede(self, proposal_id: str, project_id: Optional[str] = None) -> Proposal:
        """Retire a pending Proposal that a re-run replaced; any other status stays."""
        proposal = self._require(proposal_id, project_id)
        if proposal.status == "pending":
            proposal.status = "superseded"
            self._save(proposal.project_id)
        return proposal

    def _require(self, proposal_id: str, project_id: Optional[str] = None) -> Proposal:
        proposal = self.get(proposal_id, project_id)
        if proposal is None:
            raise ReviewAgentError(f"unknown proposal: {proposal_id}")
        return proposal


async def _run_script_proposal(
    project_id: str,
    source: str,
    *,
    author: str,
    controller: TimelineController,
    baseline: TimelineDocument,
    library: List[dict],
    store: ProposalStore,
    message: str = "",
) -> Tuple[ScriptRun, Optional[Proposal]]:
    """Run a Script against ``baseline`` and stage what it recorded as a Proposal.

    The Proposal id is minted first because it seeds the ids of the Items the
    script creates, so the Proposal's simulation and its accept replay the
    recording exactly. A fault or an empty recording stages nothing.
    """
    proposal_id = uuid.uuid4().hex
    result = await asyncio.to_thread(
        run_script,
        source,
        document=baseline,
        sources=controller.sources,
        library=library,
        id_seed=proposal_id,
    )
    proposal = None
    if result.error is None and result.operations:
        # Simulating a long recording is CPU work too; keep it off the event loop.
        # Nothing is persisted here: the caller appends the message under its lock.
        proposal = await asyncio.to_thread(
            store.create,
            project_id,
            controller,
            message=message,
            operations=result.operations,
            record_message=False,
            baseline_document=baseline,
            proposal_id=proposal_id,
        )
    error = result.error
    script = ScriptRun(
        source=source,
        author=author,
        log=result.log,
        error=ScriptRunError(kind=error.kind, message=error.message, line=error.line) if error else None,
        proposal_id=proposal.proposal_id if proposal else None,
        operation_count=len(result.operations),
        based_on_timeline_revision=baseline.revision,
        ran_at=_now(),
    )
    return script, proposal


async def run_editor_script(
    project_id: str,
    *,
    source: str,
    controller: TimelineController,
    library: List[dict],
    store: ProposalStore,
    client_message_id: Optional[str] = None,
    rerun_of_proposal_id: Optional[str] = None,
) -> dict:
    """Run the Editor's Script and record it as an Editor message.

    Local only: no model call, so no cloud consent. Retrying with the same
    ``client_message_id`` and source returns the stored run. With
    ``rerun_of_proposal_id``, a run without an error supersedes the old Proposal,
    even when it records nothing; a faulted run leaves it pending.
    """
    session = store.session(project_id)
    if client_message_id:
        existing = next(
            (message for message in session.messages if message.message_id == client_message_id),
            None,
        )
        if existing is not None:
            if existing.script is None or existing.script.source != source:
                raise ReviewAgentError(
                    f"client message id {client_message_id} was already used for another message"
                )
            return _script_result(existing, session)
    if rerun_of_proposal_id and store.get(rerun_of_proposal_id, project_id) is None:
        raise ReviewAgentError(f"unknown proposal: {rerun_of_proposal_id}")
    baseline = controller.document.model_copy(deep=True)
    script, proposal = await _run_script_proposal(
        project_id,
        source,
        author="editor",
        controller=controller,
        baseline=baseline,
        library=library,
        store=store,
    )
    if script.error is None and rerun_of_proposal_id:
        store.supersede(rerun_of_proposal_id, project_id)
    message = store.append_message(
        project_id,
        role="editor",
        text="",
        proposal=proposal,
        script=script,
        message_id=client_message_id,
    )
    return _script_result(message, store.session(project_id))


def _script_result(message: ReviewMessage, session: ReviewSession) -> dict:
    return {
        "message": message.model_dump(),
        "proposal": message.proposal.model_dump() if message.proposal else None,
        "session": session.model_dump(),
    }


# Signature of the injectable model call: given read context, return a message
# and the mutating operations to stage.
ReviewAgent = Callable[[dict], dict]


async def run_review_turn(
    project_id: str,
    *,
    user_message: str,
    controller: TimelineController,
    candidates: List[dict],
    store: ProposalStore,
    agent: ReviewAgent,
    record_user_message: bool = True,
    candidate_frames: Optional[List[dict]] = None,
    client_message_id: Optional[str] = None,
    library: Optional[List[dict]] = None,
) -> dict:
    """Run one agent turn in propose mode.

    Builds the read context (candidates + current timeline), asks the injected
    ``agent`` for an assistant message and staged operations, and — if it
    proposes any — captures them as a pending Proposal. Returns
    ``{"message", "proposal"}`` (``proposal`` is ``None`` for a chat-only turn).
    An agent script reads ``library``, the complete Candidate Clip library
    (``candidates`` may leave excluded clips out); it defaults to ``candidates``.
    """
    session = store.session(project_id)
    editor_message = None
    if record_user_message and client_message_id:
        editor_message = next(
            (message for message in session.messages if message.message_id == client_message_id),
            None,
        )
        if editor_message is not None:
            if editor_message.role != "editor" or editor_message.text != user_message:
                raise ReviewAgentError(
                    f"client message id {client_message_id} was already used for another message"
                )
            completed = next(
                (
                    message
                    for message in session.messages
                    if message.role == "agent"
                    and message.reply_to_message_id == client_message_id
                ),
                None,
            )
            if completed is not None:
                return _turn_result(completed, session)
        else:
            editor_message = store.append_message(
                project_id,
                role="editor",
                text=user_message,
                message_id=client_message_id,
            )
    elif record_user_message:
        editor_message = store.append_message(project_id, role="editor", text=user_message)

    baseline = controller.document.model_copy(deep=True)
    bounded_candidates = deepcopy(candidates)
    context = {
        "user_message": user_message,
        "candidates": deepcopy(bounded_candidates),
        "timeline": baseline.model_dump(),
        "history": [message.model_dump() for message in store.session(project_id).messages],
        "candidate_frames": candidate_frames or [],
    }
    reply = agent(context)
    message = reply.get("message", "")
    source = reply.get("script")
    operations = reply.get("operations") or []
    proposal = None
    script = None
    if source:
        # A script wins over any operations in the same reply.
        script, proposal = await _run_script_proposal(
            project_id,
            source,
            author="agent",
            message=message,
            controller=controller,
            baseline=baseline,
            library=candidates if library is None else library,
            store=store,
        )
    elif operations:
        proposal = store.create(
            project_id,
            controller,
            message=message,
            operations=operations,
            record_message=False,
            baseline_document=baseline,
        )
    validated_versions = _validate_versions(
        reply.get("versions") or [], bounded_candidates
    )
    payload = dict(reply.get("payload") or {})
    payload.pop("versions", None)
    # A turn that edits and brings no valid Versions gets none fabricated (plan 034 D8).
    if validated_versions or not (source or operations):
        if not validated_versions:
            validated_versions = [
                version.model_dump() for version in deterministic_versions(bounded_candidates)
            ]
        payload["version_set"] = VersionSet(
            version_set_id=uuid.uuid4().hex,
            versions=validated_versions,
            created_at=_now(),
            based_on_timeline_revision=baseline.revision,
            based_on_sequence_fingerprint=sequence_fingerprint(baseline.items),
            based_on_review_context_fingerprint=review_context_fingerprint(
                baseline, bounded_candidates
            ),
        ).model_dump()
    agent_message = store.append_message(
        project_id,
        role="agent",
        text=message,
        proposal=proposal,
        script=script,
        payload=payload,
        reply_to_message_id=editor_message.message_id if editor_message else None,
    )
    return _turn_result(agent_message, store.session(project_id))


def _turn_result(agent_message: ReviewMessage, session: ReviewSession) -> dict:
    proposal = agent_message.proposal
    return {
        "message": agent_message.text,
        "proposal": proposal.model_dump() if proposal else None,
        "agent_message": agent_message.model_dump(),
        "session": session.model_dump(),
    }


# --- Default model-backed agent -----------------------------------------------
#
# Not unit-tested (needs the pi CLI + network); tests inject a stub `agent`.
# Degrades gracefully to a chat-only reply on any failure so the app never
# crashes and never silently edits the timeline.

OPERATION_CATALOGUE = ", ".join(OPERATIONS.keys())

_AGENT_PROMPT = (
    "You are a creative video editor reviewing local drone footage. Compare the "
    "labelled frame samples and technical scores. Technical smoothness is "
    "authoritative; use images for subject, composition, progression, and "
    "redundancy. You PROPOSE edits; the editor accepts or rejects them.\n\n"
    "Available timeline operations (and their args): {catalogue}.\n"
    "include/exclude take {{clip_id}}; add_item takes {{source_clip_id}}; "
    "set_speed takes {{item_id, speed}}; split_item takes {{item_id, at_sec}}; "
    "set_bounds takes {{item_id, start_sec, end_sec}}; set_transform takes "
    "{{item_id, transform:{{scale,x,y}}}}.\n\n"
    "When an edit needs loops, sorting or arithmetic, put a Lua script in "
    '"script" instead of listing "operations"; the editor sees what it changes '
    "before applying it. A reply with a script ignores its operations. The script "
    "API:\n\n{api_reference}\n"
    "Candidates (JSON): {candidates}\n"
    "Labelled frame samples (JSON): {candidate_frames}\n"
    "Current timeline (JSON): {timeline}\n"
    "Recent conversation (JSON): {history}\n"
    "Editor said: {user_message}\n\n"
    "Reply with ONLY a JSON object: "
    '{{"message":"<concise rationale>","operations":[],"versions":['
    '{{"version_id":"...","title":"...","vibe":"...","rationale":"...",'
    '"profile":"short_social|cinematic_highlight|long_scenic","items":['
    '{{"source_clip_id":"...","file_id":"...","file_name":"...",'
    '"start_sec":N,"end_sec":N,"speed":N,"transform":{{"scale":1,"x":0,"y":0}}}}]}}]}}. '
    "Return 2-4 distinct complete versions when enough candidates exist. Mention "
    "filenames and timecodes, not UUIDs, in prose."
)


def _parse_agent_json(raw: str) -> dict:
    raw = raw.strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in agent output")
    parsed = json.loads(raw[start : end + 1])
    message = str(parsed.get("message", "")).strip()
    operations = parsed.get("operations") or []
    cleaned = [
        {"operation": op["operation"], "args": op.get("args", {})}
        for op in operations
        if isinstance(op, dict) and op.get("operation") in OPERATIONS
    ]
    versions = parsed.get("versions") or []
    reply = {"message": message, "operations": cleaned, "versions": versions}
    script = parsed.get("script")
    if isinstance(script, str) and script.strip():
        reply["script"] = script
    return reply


def _validate_versions(raw_versions: list, candidates: List[dict]) -> List[dict]:
    candidate_by_id = {candidate.get("clip_id"): candidate for candidate in candidates}
    validated = []
    for raw in raw_versions[:4]:
        if not isinstance(raw, dict):
            continue
        items = []
        valid = True
        for raw_item in raw.get("items") or []:
            if not isinstance(raw_item, dict):
                valid = False
                break
            candidate = candidate_by_id.get(raw_item.get("source_clip_id"))
            if candidate is None:
                valid = False
                break
            try:
                start = float(raw_item.get("start_sec"))
                end = float(raw_item.get("end_sec"))
                speed = float(raw_item.get("speed", 1.0))
            except (TypeError, ValueError):
                valid = False
                break
            if (
                start < float(candidate.get("start_sec", 0.0))
                or end > float(candidate.get("end_sec", 0.0))
                or end <= start
                or speed < 0.25
                or speed > 4.0
            ):
                valid = False
                break
            transform = raw_item.get("transform") or {"scale": 1.0, "x": 0.0, "y": 0.0}
            try:
                transform = {
                    "scale": float(transform.get("scale", 1.0)),
                    "x": float(transform.get("x", 0.0)),
                    "y": float(transform.get("y", 0.0)),
                }
            except (AttributeError, TypeError, ValueError):
                valid = False
                break
            if transform["scale"] <= 0:
                valid = False
                break
            try:
                item = CreativeVersionItem(
                    source_clip_id=candidate["clip_id"],
                    file_id=candidate["file_id"],
                    file_name=candidate["file_name"],
                    start_sec=start,
                    end_sec=end,
                    speed=speed,
                    transform=transform,
                )
            except (KeyError, ValueError):
                valid = False
                break
            items.append(item)
        if not valid or not items:
            continue
        total = round(sum((item.end_sec - item.start_sec) / item.speed for item in items), 1)
        try:
            version = CreativeVersion(
                version_id=str(raw.get("version_id") or uuid.uuid4().hex),
                title=str(raw.get("title") or "Creative cut"),
                vibe=str(raw.get("vibe") or "editorial"),
                rationale=str(raw.get("rationale") or "Selected from the strongest moments."),
                profile=raw.get("profile") or "cinematic_highlight",
                total_duration_sec=total,
                items=items,
                sequence_fingerprint=sequence_fingerprint(items),
            )
        except ValueError:
            continue
        validated.append(version.model_dump())
    return validated


_FALLBACK_RECIPES = (
    {
        "version_id": "v-social",
        "title": "Punchy Social Cut",
        "vibe": "fast & upbeat",
        "profile": "short_social",
        "count": 4,
        "segment_duration": 3.0,
        "speed": 1.0,
        "rationale": "Quick 3s hits for a vertical-friendly social edit.",
    },
    {
        "version_id": "v-cinematic",
        "title": "Cinematic Highlight",
        "vibe": "slow & sweeping",
        "profile": "cinematic_highlight",
        "count": 3,
        "segment_duration": 6.0,
        "speed": 0.5,
        "rationale": "Fewer, longer beats at half-speed for a cinematic feel.",
    },
    {
        "version_id": "v-scenic",
        "title": "Long Scenic",
        "vibe": "relaxed & wide",
        "profile": "long_scenic",
        "count": 5,
        "segment_duration": 6.0,
        "speed": 1.0,
        "rationale": "A longer establishing montage that lets each location breathe.",
    },
)


def deterministic_versions(candidates: List[dict]) -> List[CreativeVersion]:
    """Build the backend-owned deterministic Manual/model-failure Versions."""
    usable = [
        candidate
        for candidate in candidates
        if candidate.get("clip_id")
        and candidate.get("file_id")
        and candidate.get("file_name")
        and candidate.get("start_sec") is not None
        and candidate.get("end_sec") is not None
        and float(candidate["end_sec"]) > float(candidate["start_sec"])
    ]
    if not usable:
        return []
    ranked = sorted(
        usable,
        key=lambda candidate: float(candidate.get("overall_score") or 0.0),
        reverse=True,
    )
    versions = []
    for recipe in _FALLBACK_RECIPES:
        items = []
        for index in range(recipe["count"]):
            candidate = ranked[index % len(ranked)]
            lower = float(candidate["start_sec"])
            upper = float(candidate["end_sec"])
            offset = (index // len(ranked)) * recipe["segment_duration"]
            start = min(lower + offset, max(lower, upper - 1.0))
            end = min(upper, max(start + 0.5, start + recipe["segment_duration"]))
            items.append(
                CreativeVersionItem(
                    source_clip_id=str(candidate["clip_id"]),
                    file_id=str(candidate["file_id"]),
                    file_name=str(candidate["file_name"]),
                    start_sec=round(start, 2),
                    end_sec=round(end, 2),
                    speed=recipe["speed"],
                )
            )
        total = round(
            sum((item.end_sec - item.start_sec) / item.speed for item in items),
            1,
        )
        versions.append(
            CreativeVersion(
                version_id=recipe["version_id"],
                title=recipe["title"],
                vibe=recipe["vibe"],
                rationale=recipe["rationale"],
                profile=recipe["profile"],
                total_duration_sec=total,
                items=items,
                sequence_fingerprint=sequence_fingerprint(items),
            )
        )
    return versions


def default_review_agent(context: dict) -> dict:
    """Call the pi CLI for a propose-mode turn; degrade to chat-only on failure."""
    prompt = _AGENT_PROMPT.format(
        catalogue=OPERATION_CATALOGUE,
        api_reference=API_REFERENCE,
        candidates=json.dumps(context.get("candidates", []))[:6000],
        candidate_frames=json.dumps(context.get("candidate_frames", []))[:4000],
        timeline=json.dumps(context.get("timeline", {}))[:6000],
        history=json.dumps(context.get("history", [])[-12:])[:6000],
        user_message=context.get("user_message", ""),
    )
    frame_paths = [
        frame["frame_path"]
        for frame in context.get("candidate_frames", [])[:12]
        if frame.get("frame_path")
    ]
    settings = get_settings()
    command = [
        settings["pi_bin"], "--provider", settings["pi_provider"],
        "--model", settings["pi_model"],
        "--print", "--mode", "text", "--no-session", "--no-context-files",
        "--no-skills", "--no-extensions", "--tools", "read",
        *[f"@{path}" for path in frame_paths], prompt,
    ]
    try:
        completed = subprocess.run(
            command, capture_output=True, stdin=subprocess.DEVNULL, text=True,
            timeout=settings["pi_timeout_sec"], cwd=str(REPO_ROOT),
            env=os.environ.copy(),
        )
        if completed.returncode != 0 or not (completed.stdout or "").strip():
            raise ReviewAgentError((completed.stderr or "pi CLI returned no output").strip())
        parsed = _parse_agent_json(completed.stdout)
        parsed["versions"] = _validate_versions(
            parsed.get("versions") or [], context.get("candidates", [])
        )
        return parsed
    except (OSError, ValueError, ReviewAgentError, subprocess.TimeoutExpired) as exc:
        logger.warning("review agent unavailable, replying chat-only: %s", exc)
        return {
            "message": "I couldn't reach the review model just now, so I have no edits to propose.",
            "operations": [],
        }
