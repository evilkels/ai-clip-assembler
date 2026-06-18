"""In-app review agent — propose mode (Phase C).

The in-app agent is an MCP client of our own server, but unlike an External
Agent it **proposes** rather than applies. Its mutating tool calls are captured
as a :class:`Proposal` — staged operations plus a human-readable diff — instead
of mutating the live Timeline Document. Accepting **replays** the operations
through the operations core (so they land in Undo History); rejecting discards
them. Read access runs normally (provided here as context).

The actual model call is injected as an ``agent`` callable so the loop is
deterministic and testable; the default implementation reuses
``pi_cli_harness``'s provider/model env-config.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import uuid
from typing import Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from .models import TimelineDocument
from .pi_cli_harness import PI_BIN, PI_MODEL, PI_PROVIDER, REPO_ROOT
from .timeline_ops import OPERATIONS, Sources, TimelineController, apply_operation


logger = logging.getLogger("uvicorn.error")


class ReviewAgentError(Exception):
    pass


class Proposal(BaseModel):
    proposal_id: str
    project_id: str
    message: str
    operations: List[dict] = Field(default_factory=list)
    summary: List[str] = Field(default_factory=list)
    before_item_count: int = 0
    after_item_count: int = 0
    status: str = "pending"  # pending | accepted | rejected


def _describe(operation: str, args: dict) -> str:
    """A short human-readable line for one staged operation."""
    if operation == "include":
        return f"Accept {args.get('clip_id')}"
    if operation == "exclude":
        return f"Reject {args.get('clip_id')}"
    if operation == "add_item":
        return f"Add {args.get('source_clip_id')} to the timeline"
    if operation == "remove_item":
        return f"Remove item {args.get('item_id')}"
    if operation == "split_item":
        return f"Split item {args.get('item_id')} at {args.get('at_sec')}s"
    if operation == "set_bounds":
        return f"Trim item {args.get('item_id')} to {args.get('start_sec')}–{args.get('end_sec')}s"
    if operation == "reorder":
        return f"Move item {args.get('item_id')} to position {args.get('to_index')}"
    if operation == "set_speed":
        return f"Set speed {args.get('speed')}× on item {args.get('item_id')}"
    if operation == "set_transform":
        return f"Reframe item {args.get('item_id')}"
    if operation == "set_profile":
        return f"Set profile to {args.get('profile')}"
    if operation == "set_target_duration":
        return f"Set target duration to {args.get('target_duration_sec')}s"
    return f"{operation} {args}"


def _simulate(
    document: TimelineDocument, sources: Sources, operations: List[dict]
) -> TimelineDocument:
    """Apply the staged operations to a throwaway copy to compute the diff.

    Raises ``TimelineOpError`` if any staged operation is invalid, so a bad
    proposal is rejected at creation time rather than on accept.
    """
    working = document
    for op in operations:
        working = apply_operation(working, sources, op["operation"], **op.get("args", {}))
    return working


class ProposalStore:
    """Per-process registry of staged Proposals."""

    def __init__(self) -> None:
        self._proposals: Dict[str, Proposal] = {}

    def create(
        self,
        project_id: str,
        controller: TimelineController,
        *,
        message: str,
        operations: List[dict],
    ) -> Proposal:
        # Validate by simulating on a copy of the live document (no mutation).
        resulting = _simulate(controller.document, controller.sources, operations)
        proposal = Proposal(
            proposal_id=uuid.uuid4().hex,
            project_id=project_id,
            message=message,
            operations=operations,
            summary=[_describe(op["operation"], op.get("args", {})) for op in operations],
            before_item_count=len(controller.document.items),
            after_item_count=len(resulting.items),
        )
        self._proposals[proposal.proposal_id] = proposal
        return proposal

    def get(self, proposal_id: str) -> Optional[Proposal]:
        return self._proposals.get(proposal_id)

    def list_for_project(self, project_id: str) -> List[Proposal]:
        return [p for p in self._proposals.values() if p.project_id == project_id]

    async def accept(self, proposal_id: str, controller: TimelineController) -> TimelineDocument:
        proposal = self._require(proposal_id)
        if proposal.status != "pending":
            raise ReviewAgentError(f"proposal {proposal_id} is {proposal.status}, not pending")
        # Replay through the live operations core so the edits land in Undo
        # History and emit `timeline-changed` (one snapshot per operation).
        document = controller.document
        for op in proposal.operations:
            document = await controller.apply(op["operation"], **op.get("args", {}))
        proposal.status = "accepted"
        return document

    def reject(self, proposal_id: str) -> Proposal:
        proposal = self._require(proposal_id)
        if proposal.status == "accepted":
            raise ReviewAgentError(f"proposal {proposal_id} already accepted")
        proposal.status = "rejected"
        return proposal

    def _require(self, proposal_id: str) -> Proposal:
        proposal = self._proposals.get(proposal_id)
        if proposal is None:
            raise ReviewAgentError(f"unknown proposal: {proposal_id}")
        return proposal


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
) -> dict:
    """Run one agent turn in propose mode.

    Builds the read context (candidates + current timeline), asks the injected
    ``agent`` for an assistant message and staged operations, and — if it
    proposes any — captures them as a pending Proposal. Returns
    ``{"message", "proposal"}`` (``proposal`` is ``None`` for a chat-only turn).
    """
    context = {
        "user_message": user_message,
        "candidates": candidates,
        "timeline": controller.document.model_dump(),
    }
    reply = agent(context)
    message = reply.get("message", "")
    operations = reply.get("operations") or []
    proposal = None
    if operations:
        proposal = store.create(
            project_id, controller, message=message, operations=operations
        )
    return {"message": message, "proposal": proposal.model_dump() if proposal else None}


# --- Default model-backed agent (reuses pi_cli_harness env-config) ----------
#
# Not unit-tested (needs the pi CLI + network); tests inject a stub `agent`.
# Degrades gracefully to a chat-only reply on any failure so the app never
# crashes and never silently edits the timeline.

OPERATION_CATALOGUE = ", ".join(OPERATIONS.keys())

_AGENT_PROMPT = (
    "You are the in-app review agent for a local drone-footage editor. You help "
    "the editor assemble a timeline from candidate clips. You PROPOSE edits; the "
    "editor accepts or rejects them.\n\n"
    "Available timeline operations (and their args): {catalogue}.\n"
    "include/exclude take {{clip_id}}; add_item takes {{source_clip_id}}; "
    "set_speed takes {{item_id, speed}}; split_item takes {{item_id, at_sec}}; "
    "set_bounds takes {{item_id, start_sec, end_sec}}; set_transform takes "
    "{{item_id, transform:{{scale,x,y}}}}.\n\n"
    "Candidates (JSON): {candidates}\n"
    "Current timeline (JSON): {timeline}\n"
    "Editor said: {user_message}\n\n"
    "Reply with ONLY a JSON object: "
    '{{"message": "<one short sentence>", "operations": [{{"operation": "<name>", "args": {{...}}}}]}}. '
    "Use an empty operations list if no edit is warranted."
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
    return {"message": message, "operations": cleaned}


def default_review_agent(context: dict) -> dict:
    """Call the pi CLI for a propose-mode turn; degrade to chat-only on failure."""
    prompt = _AGENT_PROMPT.format(
        catalogue=OPERATION_CATALOGUE,
        candidates=json.dumps(context.get("candidates", []))[:6000],
        timeline=json.dumps(context.get("timeline", {}))[:6000],
        user_message=context.get("user_message", ""),
    )
    command = [
        PI_BIN, "--provider", PI_PROVIDER, "--model", PI_MODEL,
        "--print", "--mode", "text", "--no-session", "--no-context-files",
        "--no-skills", "--no-extensions", "--tools", "read", prompt,
    ]
    try:
        completed = subprocess.run(
            command, capture_output=True, stdin=subprocess.DEVNULL, text=True,
            timeout=120, cwd=str(REPO_ROOT), env=os.environ.copy(),
        )
        if completed.returncode != 0 or not (completed.stdout or "").strip():
            raise ReviewAgentError((completed.stderr or "pi CLI returned no output").strip())
        return _parse_agent_json(completed.stdout)
    except (OSError, ValueError, ReviewAgentError, subprocess.TimeoutExpired) as exc:
        logger.warning("review agent unavailable, replying chat-only: %s", exc)
        return {
            "message": "I couldn't reach the review model just now, so I have no edits to propose.",
            "operations": [],
        }
