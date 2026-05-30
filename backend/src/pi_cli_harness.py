"""Pi coding-agent harness for enhancing rule-based clips with vision AI.

Drives the ``pi`` coding agent (https://github.com/earendil-works/pi-mono) in
non-interactive print mode to score the visual interest of candidate drone
clips. By default it uses the ``openai-codex`` provider with the
``gpt-5.4-mini`` model; ``pi`` reads sampled frame images with its built-in
``read`` tool and returns structured JSON scores.

Falls back gracefully to the original rule-based result when the ``pi`` CLI is
unavailable, times out, or returns unusable output.

Configuration is via environment variables only (no config file):

| Variable         | Default        | Description                                  |
|------------------|----------------|----------------------------------------------|
| ``PI_BIN``       | ``pi``         | Path/name of the pi executable               |
| ``PI_PROVIDER``  | ``openai-codex`` | pi provider to route through                |
| ``PI_MODEL``     | ``gpt-5.4-mini`` | Model pattern/ID for that provider          |
| ``PI_TIMEOUT_SEC`` | ``180``      | Per-clip subprocess timeout in seconds       |

Provider credentials are managed by ``pi`` itself (``~/.pi/agent/auth.json`` or
provider env vars such as ``OPENCODE_API_KEY``); the harness inherits the
backend process environment when spawning the CLI.
"""

import json
import os
import subprocess
from typing import List, Optional, Tuple

from .models import AssemblyResult, ClipSuggestion, FrameScore

PI_BIN = os.environ.get("PI_BIN", "pi")
PI_PROVIDER = os.environ.get("PI_PROVIDER", "openai-codex")
PI_MODEL = os.environ.get("PI_MODEL", "gpt-5.4-mini")
DEFAULT_TIMEOUT = float(os.environ.get("PI_TIMEOUT_SEC", "180"))
DEFAULT_MAX_FRAMES_PER_CLIP = 4
REQUIRED_SCORE_KEYS = {"smoothness", "visual_interest"}

DEFAULT_PROMPT_TEMPLATE = (
    "You are a drone-video quality analyst. Use your read tool to view each of "
    "these {frame_count} frame image(s) sampled from a SINGLE candidate video clip:\n"
    "{frame_list}\n"
    "Judge the clip as a whole and score it 0-10 for: "
    "1) smoothness/stability (10 = perfectly smooth, no camera shake), "
    "2) visual_interest (composition, lighting, subject). "
    "Respond with ONLY one JSON object and nothing else, in this exact format: "
    '{"smoothness": N, "visual_interest": N, "reason": "brief explanation"}'
)


class PiCliUnavailableError(Exception):
    """Raised when the pi CLI is unreachable, fails, or returns junk."""


def _parse_pi_json_response(raw: str) -> dict:
    """Parse a single JSON object from a pi text response.

    Handles common agent-output quirks such as markdown code fences and
    surrounding prose by extracting the first balanced ``{...}`` object.
    """
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])

    if isinstance(parsed, list):
        if not parsed:
            raise ValueError("Empty JSON array in pi response")
        parsed = parsed[0]
    if not isinstance(parsed, dict):
        raise ValueError(f"Unexpected response type: {type(parsed)}")
    return parsed


def _build_prompt(frame_paths: List[str], prompt_template: str) -> str:
    frame_list = "\n".join(f"- {path}" for path in frame_paths)
    return prompt_template.replace("{frame_count}", str(len(frame_paths))).replace(
        "{frame_list}", frame_list
    )


def _call_pi_cli(
    frame_paths: List[str],
    prompt_template: str = DEFAULT_PROMPT_TEMPLATE,
    provider: str = PI_PROVIDER,
    model: str = PI_MODEL,
    pi_bin: str = PI_BIN,
    timeout_sec: float = DEFAULT_TIMEOUT,
) -> dict:
    """Score one clip's frames by invoking the pi CLI once.

    Returns a single score dict ``{"smoothness", "visual_interest", "reason"}``.
    Raises :class:`PiCliUnavailableError` on any failure so callers can fall back.
    """
    prompt = _build_prompt(frame_paths, prompt_template)
    command = [
        pi_bin,
        "--provider",
        provider,
        "--model",
        model,
        "--print",
        "--mode",
        "text",
        "--no-session",
        prompt,
    ]

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env=os.environ.copy(),
        )
    except FileNotFoundError as exc:
        raise PiCliUnavailableError(f"pi CLI not found on PATH ({pi_bin})") from exc
    except subprocess.TimeoutExpired as exc:
        raise PiCliUnavailableError(
            f"pi CLI timed out after {timeout_sec}s"
        ) from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise PiCliUnavailableError(f"pi CLI exited {completed.returncode}: {detail}")

    raw = (completed.stdout or "").strip()
    if not raw:
        raise PiCliUnavailableError("pi CLI returned empty output")

    try:
        return _parse_pi_json_response(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise PiCliUnavailableError(f"Failed to parse pi JSON output: {exc}") from exc


def _sample_frames_for_clip(
    clip: ClipSuggestion,
    all_frames: List[FrameScore],
    max_frames: int = DEFAULT_MAX_FRAMES_PER_CLIP,
) -> List[str]:
    """Pick up to *max_frames* representative frame paths inside *clip*."""
    clip_frames = [
        f for f in all_frames if clip.start_sec <= f.timestamp <= clip.end_sec
    ]
    if not clip_frames:
        return []
    if len(clip_frames) <= max_frames:
        return [f.frame_path for f in clip_frames]
    indices = [int(i * (len(clip_frames) - 1) / (max_frames - 1)) for i in range(max_frames)]
    return [clip_frames[i].frame_path for i in indices]


def _clamp_score(value) -> float:
    try:
        return max(0.0, min(10.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _fallback_result(manual_result: AssemblyResult, warning: str) -> Tuple[AssemblyResult, bool]:
    metadata = dict(manual_result.metadata)
    metadata["used_ai"] = False
    metadata["warning"] = warning
    return (
        AssemblyResult(
            clips=manual_result.clips,
            sequence=manual_result.sequence,
            metadata=metadata,
            harness_id="pi_agent",
            harness_version="1.0.0",
            processing_time_sec=manual_result.processing_time_sec,
        ),
        False,
    )


def enhance_clips_with_pi_cli(
    manual_result: AssemblyResult,
    all_frames: List[FrameScore],
    max_frames_per_clip: int = DEFAULT_MAX_FRAMES_PER_CLIP,
    prompt_template: str = DEFAULT_PROMPT_TEMPLATE,
    provider: str = PI_PROVIDER,
    model: str = PI_MODEL,
    pi_bin: str = PI_BIN,
    timeout_sec: float = DEFAULT_TIMEOUT,
) -> Tuple[AssemblyResult, bool]:
    """Enhance manual rule-based clips with pi coding-agent vision analysis.

    For each candidate clip it samples representative frames, asks the ``pi``
    CLI to score them, and updates the clip with ``visual_interest_score``,
    ``ai_reason``, and a blended ``overall_score`` (70 % original technical +
    30 % visual interest). Clips are then re-ranked by ``overall_score``.

    If the CLI is unavailable or every clip fails to score, the original manual
    result is returned unchanged and the second return value is ``False``.

    Returns
    -------
    Tuple[AssemblyResult, bool]
        The (possibly enhanced) result and whether AI enhancement succeeded.
    """
    clip_samples: List[Tuple[ClipSuggestion, List[str]]] = []
    for clip in manual_result.clips:
        paths = _sample_frames_for_clip(clip, all_frames, max_frames=max_frames_per_clip)
        if paths:
            clip_samples.append((clip, paths))

    if not clip_samples:
        return _fallback_result(
            manual_result, "pi harness fallback: no frames available for analysis"
        )

    clip_scores: List[Optional[dict]] = []
    for _clip, paths in clip_samples:
        try:
            score = _call_pi_cli(
                paths,
                prompt_template=prompt_template,
                provider=provider,
                model=model,
                pi_bin=pi_bin,
                timeout_sec=timeout_sec,
            )
        except PiCliUnavailableError:
            clip_scores.append(None)
            continue
        if isinstance(score, dict) and REQUIRED_SCORE_KEYS.issubset(score):
            clip_scores.append(score)
        else:
            clip_scores.append(None)

    usable_clips = sum(1 for score in clip_scores if score is not None)
    if usable_clips == 0:
        return _fallback_result(
            manual_result, "pi harness fallback: CLI unavailable or no usable scores"
        )

    partial = usable_clips < len(clip_samples)

    enhanced_clips: List[ClipSuggestion] = []
    sampled_clip_ids = {clip.clip_id for clip, _ in clip_samples}
    for (original_clip, _paths), score in zip(clip_samples, clip_scores):
        if score is None:
            enhanced_clips.append(original_clip)
            continue
        new_visual_interest = round(_clamp_score(score.get("visual_interest", 0)), 2)
        new_overall = round(
            0.7 * original_clip.overall_score + 0.3 * new_visual_interest, 2
        )
        reason = str(score.get("reason", "")).strip() or "No reason provided"
        enhanced_clips.append(
            original_clip.model_copy(
                update={
                    "visual_interest_score": new_visual_interest,
                    "overall_score": new_overall,
                    "ai_reason": f"{original_clip.ai_reason} | AI: {reason}",
                }
            )
        )

    # Include clips that had no frame samples (unchanged).
    for clip in manual_result.clips:
        if clip.clip_id not in sampled_clip_ids:
            enhanced_clips.append(clip)

    enhanced_clips = sorted(enhanced_clips, key=lambda c: c.overall_score, reverse=True)

    metadata = dict(manual_result.metadata)
    metadata["model_used"] = model
    metadata["provider"] = provider
    metadata["local"] = False
    metadata["used_ai"] = True
    metadata["clips_enhanced"] = usable_clips
    metadata["clips_total"] = len(clip_samples)
    if partial:
        metadata["partial_enhancement"] = True
        metadata["warning"] = (
            f"pi harness partial enhancement: {usable_clips}/{len(clip_samples)} clips enhanced"
        )

    return (
        AssemblyResult(
            clips=enhanced_clips,
            sequence=manual_result.sequence.model_copy(
                update={"clips": [c.clip_id for c in enhanced_clips]}
            ),
            metadata=metadata,
            harness_id="pi_agent",
            harness_version="1.0.0",
            processing_time_sec=manual_result.processing_time_sec,
        ),
        True,
    )
