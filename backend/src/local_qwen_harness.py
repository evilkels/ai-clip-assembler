"""Local Qwen3-VL harness for enhancing rule-based clips with vision AI.

Enhances existing manual/rule-based candidate clips by sampling representative
frames and asking a local Ollama-hosted vision model (Qwen3-VL) to score
visual interest. Falls back gracefully to the original rule-based results when
Ollama or the model is unavailable.
"""

import base64
import json
import os
from typing import List, Tuple

import httpx

from .clip_assembly import AssemblyResult
from .harness_utils import clamp_score, sample_frames_for_clip
from .models import ClipSuggestion, FrameScore

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3-vl:8b")
DEFAULT_TEMPERATURE = float(os.environ.get("OLLAMA_TEMPERATURE", "0.2"))
DEFAULT_BATCH_SIZE = 8
DEFAULT_TIMEOUT = 30.0
REQUIRED_SCORE_KEYS = {"smoothness", "visual_interest"}

DEFAULT_PROMPT_TEMPLATE = (
    "You are a video quality analyst. Analyze these {frame_count} video frames and score each one "
    "(0-10) for: 1) smoothness/stability (is there camera shake?), "
    "2) visual interest (composition, lighting, subject). "
    "Respond ONLY with a JSON array in this exact format, with one object per frame in order: "
    '[{"smoothness": N, "visual_interest": N, "reason": "brief explanation"}, ...]'
)


class OllamaUnavailableError(Exception):
    """Raised when Ollama is unreachable or the model is not available."""


def _encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _parse_ollama_json_response(raw: str) -> List[dict]:
    """Parse a JSON array from an Ollama text response.

    Handles common LLM output quirks such as markdown code fences and
    object-wrapped arrays.
    """
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    parsed = json.loads(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ("results", "scores", "frames", "data"):
            if key in parsed and isinstance(parsed[key], list):
                return parsed[key]
        return [parsed]
    raise ValueError(f"Unexpected response type: {type(parsed)}")


def _call_ollama_for_batch(
    frame_paths: List[str],
    prompt_template: str = DEFAULT_PROMPT_TEMPLATE,
    model: str = OLLAMA_MODEL,
    base_url: str = OLLAMA_URL,
    timeout_sec: float = DEFAULT_TIMEOUT,
    temperature: float = DEFAULT_TEMPERATURE,
) -> List[dict]:
    """Send a batch of frame images to Ollama and parse structured JSON scores.

    Returns a list of score dicts, one per frame, in the same order as
    *frame_paths*.
    """
    if not frame_paths:
        return []

    images = [_encode_image(p) for p in frame_paths]
    prompt = prompt_template.replace("{frame_count}", str(len(images)))

    payload = {
        "model": model,
        "prompt": prompt,
        "images": images,
        "stream": False,
        "format": "json",
        "options": {"temperature": temperature},
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_sec)) as client:
            response = client.post(f"{base_url}/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
    except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
        raise OllamaUnavailableError(f"Cannot reach Ollama at {base_url}: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text if exc.response else str(exc)
        raise OllamaUnavailableError(f"Ollama request failed: {detail}") from exc

    raw_response = data.get("response", "")
    if not raw_response:
        raise OllamaUnavailableError("Ollama returned an empty response")

    try:
        return _parse_ollama_json_response(raw_response)
    except (json.JSONDecodeError, ValueError) as exc:
        raise OllamaUnavailableError(f"Failed to parse Ollama JSON response: {exc}") from exc


def enhance_clips_with_local_qwen(
    manual_result: AssemblyResult,
    all_frames: List[FrameScore],
    batch_size: int = DEFAULT_BATCH_SIZE,
    prompt_template: str = DEFAULT_PROMPT_TEMPLATE,
    model: str = OLLAMA_MODEL,
    base_url: str = OLLAMA_URL,
    timeout_sec: float = DEFAULT_TIMEOUT,
    temperature: float = DEFAULT_TEMPERATURE,
) -> Tuple[AssemblyResult, bool]:
    """Enhance manual rule-based clips with local Qwen vision analysis.

    The function:
      1. Samples representative frames from each candidate clip.
      2. Sends them to Ollama in batches of *batch_size*.
      3. Parses structured JSON scores (smoothness, visual_interest, reason).
      4. Updates each clip with ``visual_interest_score``, ``ai_reason``,
         and a blended ``overall_score``.
      5. Re-ranks clips by the new ``overall_score``.

    If Ollama is unreachable, the model returns empty responses, or JSON parsing
    fails, the original manual result is returned unchanged and the second
    return value is ``False``.

    Returns
    -------
    Tuple[AssemblyResult, bool]
        The (possibly enhanced) result, and whether the AI enhancement
        succeeded.
    """
    # Sample frames for each clip
    clip_samples: List[Tuple[ClipSuggestion, List[str]]] = []
    for clip in manual_result.clips:
        paths = sample_frames_for_clip(clip, all_frames)
        if paths:
            clip_samples.append((clip, paths))

    if not clip_samples:
        metadata = dict(manual_result.metadata)
        metadata["used_ai"] = False
        metadata["warning"] = "Local Qwen fallback: no frames available for analysis"
        return (
            AssemblyResult(
                clips=manual_result.clips,
                sequence=manual_result.sequence,
                metadata=metadata,
                harness_id="local_qwen",
                harness_version="1.0.0",
                processing_time_sec=manual_result.processing_time_sec,
            ),
            False,
        )

    # Flatten frames and track which clip each frame belongs to
    all_frame_paths: List[str] = []
    frame_to_clip_index: List[int] = []
    for clip_index, (_clip, paths) in enumerate(clip_samples):
        for path in paths:
            all_frame_paths.append(path)
            frame_to_clip_index.append(clip_index)

    # Call Ollama in batches
    all_scores: List[dict] = []
    try:
        for i in range(0, len(all_frame_paths), batch_size):
            batch_paths = all_frame_paths[i : i + batch_size]
            batch_scores = _call_ollama_for_batch(
                batch_paths,
                prompt_template=prompt_template,
                model=model,
                base_url=base_url,
                timeout_sec=timeout_sec,
                temperature=temperature,
            )
            if len(batch_scores) != len(batch_paths):
                raise OllamaUnavailableError(
                    f"Score count mismatch: expected {len(batch_paths)}, got {len(batch_scores)}"
                )
            all_scores.extend(batch_scores)
    except OllamaUnavailableError:
        metadata = dict(manual_result.metadata)
        metadata["used_ai"] = False
        metadata["warning"] = "Local Qwen fallback: Ollama/model unavailable"
        return (
            AssemblyResult(
                clips=manual_result.clips,
                sequence=manual_result.sequence,
                metadata=metadata,
                harness_id="local_qwen",
                harness_version="1.0.0",
                processing_time_sec=manual_result.processing_time_sec,
            ),
            False,
        )

    if len(all_scores) != len(all_frame_paths):
        metadata = dict(manual_result.metadata)
        metadata["used_ai"] = False
        metadata["warning"] = (
            f"Local Qwen fallback: score/frame mismatch "
            f"({len(all_scores)} scores for {len(all_frame_paths)} frames)"
        )
        return (
            AssemblyResult(
                clips=manual_result.clips,
                sequence=manual_result.sequence,
                metadata=metadata,
                harness_id="local_qwen",
                harness_version="1.0.0",
                processing_time_sec=manual_result.processing_time_sec,
            ),
            False,
        )

    # Map scores back to clips, validating each score object
    clip_scores: List[List[dict]] = [[] for _ in clip_samples]
    invalid_count = 0
    for clip_index, score in zip(frame_to_clip_index, all_scores):
        if not isinstance(score, dict) or not REQUIRED_SCORE_KEYS.issubset(score):
            invalid_count += 1
            continue
        clip_scores[clip_index].append(score)

    usable_clips = sum(1 for scores in clip_scores if scores)
    if usable_clips == 0:
        metadata = dict(manual_result.metadata)
        metadata["used_ai"] = False
        metadata["warning"] = "Local Qwen fallback: model returned no usable scores"
        return (
            AssemblyResult(
                clips=manual_result.clips,
                sequence=manual_result.sequence,
                metadata=metadata,
                harness_id="local_qwen",
                harness_version="1.0.0",
                processing_time_sec=manual_result.processing_time_sec,
            ),
            False,
        )

    partial = invalid_count > 0

    # Build enhanced clips
    enhanced_clips: List[ClipSuggestion] = []
    sampled_clip_ids = {clip.clip_id for clip, _ in clip_samples}
    for (original_clip, _), scores in zip(clip_samples, clip_scores):
        if scores:
            avg_visual_interest = sum(
                clamp_score(s.get("visual_interest", 0)) for s in scores
            ) / len(scores)
            reasons = [
                str(s.get("reason", "")).strip()
                for s in scores
                if s.get("reason")
            ]
            ai_reason_text = " | ".join(reasons) if reasons else "No reason provided"

            new_visual_interest = round(avg_visual_interest, 2)
            # Blend overall_score: 70 % original technical + 30 % visual interest
            new_overall = round(
                0.7 * original_clip.overall_score + 0.3 * new_visual_interest, 2
            )

            enhanced_clip = original_clip.model_copy(
                update={
                    "visual_interest_score": new_visual_interest,
                    "overall_score": new_overall,
                    "ai_reason": f"{original_clip.ai_reason} | AI: {ai_reason_text}",
                }
            )
            enhanced_clips.append(enhanced_clip)
        else:
            enhanced_clips.append(original_clip)

    # Include clips that had no frame samples (unchanged)
    for clip in manual_result.clips:
        if clip.clip_id not in sampled_clip_ids:
            enhanced_clips.append(clip)

    # Re-rank by new overall_score descending
    enhanced_clips = sorted(
        enhanced_clips, key=lambda c: c.overall_score, reverse=True
    )

    metadata = dict(manual_result.metadata)
    metadata["model_used"] = model
    metadata["local"] = True
    metadata["used_ai"] = True
    metadata["clips_enhanced"] = usable_clips
    metadata["clips_total"] = len(clip_samples)
    if partial:
        metadata["partial_enhancement"] = True
        metadata["warning"] = (
            f"Local Qwen partial enhancement: {usable_clips}/{len(clip_samples)} clips enhanced"
        )

    return (
        AssemblyResult(
            clips=enhanced_clips,
            sequence=manual_result.sequence.model_copy(
                update={"clips": [c.clip_id for c in enhanced_clips]}
            ),
            metadata=metadata,
            harness_id="local_qwen",
            harness_version="1.0.0",
            processing_time_sec=manual_result.processing_time_sec,
        ),
        True,
    )
