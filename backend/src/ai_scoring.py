import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Set

from .ai_engines.engine import AiEngine, SCORING_TIMEOUT_PER_CLIP_SEC
from .ai_engines.messages import make_failure
from .ai_engines.types import AiFailure, AiRequest
from .harness_utils import clamp_score, sample_frames_for_clip
from .models import AssemblyResult, FrameScore

logger = logging.getLogger("uvicorn.error")
DEFAULT_MAX_FRAMES_PER_CLIP = 4
PROMPT_TEMPLATE = (
    "You are a drone-video quality analyst. Review each Candidate Clip using its frame samples.\n"
    "{clip_list}\nJudge composition, lighting, subject, moment, and progression. "
    "Smoothness is owned by motion analysis; score only visual_interest from 0–10. "
    "Give each clip a brief reason."
)
SCORE_SCHEMA = {
    "type": "object",
    "required": ["scores"],
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["k", "visual_interest", "reason"],
                "properties": {
                    "k": {"type": "integer"},
                    "visual_interest": {"type": "number"},
                    "reason": {"type": "string"},
                },
            },
        }
    },
}


@dataclass
class ScoringOutcome:
    result: AssemblyResult
    used_ai: bool
    failure: Optional[AiFailure]
    clips_scored: int
    clips_left: int


def _score_cache_key(paths: List[str], engine: AiEngine) -> str:
    digest = hashlib.sha256()
    digest.update(engine.provider.encode())
    digest.update(getattr(engine, "cache_identity", engine.provider).encode())
    digest.update(PROMPT_TEMPLATE.encode())
    for path in paths:
        try:
            digest.update(Path(path).read_bytes())
        except OSError:
            digest.update(path.encode())
    return digest.hexdigest()


def _load_cached_score(cache_dir: Optional[Path], key: str) -> Optional[dict]:
    if cache_dir is None:
        return None
    try:
        cached = json.loads((cache_dir / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return cached if isinstance(cached, dict) and "visual_interest" in cached else None


def _store_cached_score(cache_dir: Optional[Path], key: str, score: dict) -> None:
    if cache_dir is not None:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            (cache_dir / f"{key}.json").write_text(json.dumps(score), encoding="utf-8")
        except OSError:
            logger.warning("Could not write AI score cache in %s", cache_dir)


def _manual_outcome(manual_result, failure, clips_scored, clips_left):
    return ScoringOutcome(manual_result, False, failure, clips_scored, clips_left)


def enhance_clips(
    engine: AiEngine,
    manual_result: AssemblyResult,
    all_frames: List[FrameScore],
    *,
    max_frames_per_clip: int = DEFAULT_MAX_FRAMES_PER_CLIP,
    progress_callback: Optional[Callable[[int, int], None]] = None,
    cache_dir: Optional[Path] = None,
    only_clip_ids: Optional[Set[str]] = None,
    timeout_per_clip_sec: float = SCORING_TIMEOUT_PER_CLIP_SEC,
    samples_dir: Path,
) -> ScoringOutcome:
    sampled = []
    for clip in manual_result.clips:
        paths = sample_frames_for_clip(clip, all_frames, max_frames=max_frames_per_clip)
        if paths:
            sampled.append((clip, paths, _score_cache_key(paths, engine)))
    if not sampled:
        return _manual_outcome(
            manual_result,
            make_failure(
                "unusable_reply", engine.provider, detail="no frames available for analysis"
            ),
            0,
            0,
        )

    scores = {}
    pending = []
    for clip, paths, key in sampled:
        cached = _load_cached_score(cache_dir, key)
        if cached is not None:
            scores[clip.clip_id] = cached
        elif only_clip_ids is None or clip.clip_id in only_clip_ids:
            pending.append((clip, paths, key, 0))
    total = len(sampled)
    if scores and progress_callback:
        progress_callback(len(scores), total)

    failure = None
    while pending:
        batch, pending = pending[:5], pending[5:]
        names, images, labels = [], [], []
        for position, (clip, paths, _key, _attempt) in enumerate(batch, start=1):
            staged_names = []
            for frame_number, path in enumerate(paths, start=1):
                name = f"clip-{position}-frame-{frame_number}.jpg"
                names.append(name)
                images.append(Path(path))
                staged_names.append(name)
            file_name = Path(clip.file_name).name
            labels.append(
                f"{position} → {file_name} {clip.start_sec:.1f}–{clip.end_sec:.1f} s\n"
                + "  "
                + ", ".join(staged_names)
            )
        request = AiRequest(
            images=images,
            text=PROMPT_TEMPLATE.format(clip_list="\n".join(labels)),
            schema=SCORE_SCHEMA,
            timeout_sec=timeout_per_clip_sec * len(batch),
            samples_dir=samples_dir,
            image_limit=20,
            image_names=names,
        )
        started = time.monotonic()
        reply = engine.run(request)
        if isinstance(reply, AiFailure):
            failure = reply
            break
        entries = reply.data.get("scores")
        by_k = {}
        invalid = set()
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get("k"), int):
                    continue
                k = entry["k"]
                if k < 1 or k > len(batch) or k in by_k:
                    invalid.add(k)
                else:
                    by_k[k] = entry
        retries = []
        for position, (clip, paths, key, attempt) in enumerate(batch, start=1):
            entry = by_k.get(position)
            value = entry.get("visual_interest") if entry else None
            if (
                position in invalid
                or isinstance(value, bool)
                or not isinstance(value, (int, float))
            ):
                if attempt == 0:
                    retries.append((clip, paths, key, 1))
                continue
            score = {"visual_interest": value, "reason": str(entry.get("reason", "")).strip()}
            _store_cached_score(cache_dir, key, score)
            scores[clip.clip_id] = score
        if progress_callback:
            progress_callback(len(scores), total)
        if retries:
            pending = retries + pending
        logger.info("AI scoring batch completed in %.1fs", time.monotonic() - started)

    clips_left = sum(clip.clip_id not in scores for clip, _paths, _key in sampled)
    if failure is not None or clips_left:
        if failure is None:
            failure = make_failure("unusable_reply", engine.provider)
        return _manual_outcome(manual_result, failure, len(scores), clips_left)

    sampled_ids = {clip.clip_id for clip, _paths, _key in sampled}
    enhanced = []
    for clip, _paths, _key in sampled:
        score = scores[clip.clip_id]
        visual = round(clamp_score(score["visual_interest"]), 2)
        enhanced.append(
            clip.model_copy(
                update={
                    "visual_interest_score": visual,
                    "overall_score": round(0.7 * clip.overall_score + 0.3 * visual, 2),
                    "ai_reason": f"{clip.ai_reason} | AI: {score.get('reason') or 'No reason provided'}",
                }
            )
        )
    enhanced.extend(clip for clip in manual_result.clips if clip.clip_id not in sampled_ids)
    enhanced.sort(key=lambda clip: clip.overall_score, reverse=True)
    metadata = dict(manual_result.metadata)
    metadata.update(
        {
            "provider": engine.provider,
            "local": False,
            "used_ai": True,
            "clips_enhanced": len(scores),
            "clips_total": len(sampled),
            "clips_left": 0,
        }
    )
    model_used = getattr(engine, "pi_model", None)
    if model_used:
        metadata["model_used"] = model_used
    return ScoringOutcome(
        AssemblyResult(
            clips=enhanced,
            sequence=manual_result.sequence.model_copy(
                update={"clips": [clip.clip_id for clip in enhanced]}
            ),
            metadata=metadata,
            harness_id="pi_agent",
            harness_version="1.0.0",
            processing_time_sec=manual_result.processing_time_sec,
        ),
        True,
        None,
        len(scores),
        0,
    )
