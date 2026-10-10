"""What the phone is told about a Project, derived from the Mac's own state."""

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

from ..models import (
    RemoteNowOnMac,
    RemoteProjectDetail,
    RemoteProjectSummary,
    RemoteSource,
)
from ..project_store import analysis_results_path

# Where each analysis step sits inside one video's share of the run.
_STEP_FRACTION = {
    "starting": 0.0,
    "motion_analysis": 0.05,
    "frame_extraction": 0.35,
    "scene_detection": 0.6,
    "scoring_clips": 0.75,
}
_STEP_LABEL = {
    "starting": "Preparing",
    "motion_analysis": "Checking stability",
    "frame_extraction": "Sampling frames",
    "scene_detection": "Finding scenes",
    "scoring_clips": "Scoring clips",
    "complete": "Complete",
}


def analysis_percent(progress: dict) -> Optional[float]:
    """Rough 0-100 progress for an analysing run, from the Mac's own counters."""
    total = progress.get("video_total") or 0
    if total <= 0:
        return None
    index = max(1, int(progress.get("video_index") or 1))
    fraction = _STEP_FRACTION.get(progress.get("step") or "starting", 0.0)
    clip_total = progress.get("clip_total") or 0
    if progress.get("step") == "scoring_clips" and clip_total > 0:
        fraction = 0.75 + 0.25 * min(1.0, (progress.get("clip_index") or 0) / clip_total)
    value = ((index - 1) + fraction) / total
    return round(min(100.0, max(0.0, value * 100.0)), 1)


def now_on_mac(project: dict) -> RemoteNowOnMac:
    progress = project.get("analysis_progress") or {}
    phase = progress.get("phase")
    if phase == "analyzing":
        started = progress.get("started_at")
        return RemoteNowOnMac(
            state="analyzing",
            phase=_STEP_LABEL.get(progress.get("step") or "starting", "Analyzing"),
            percent=analysis_percent(progress),
            message=progress.get("message"),
            elapsed_sec=round(max(0.0, time.time() - started), 1)
            if isinstance(started, (int, float))
            else None,
            updated_at=progress.get("updated_at"),
        )
    if phase == "error":
        return RemoteNowOnMac(
            state="failed",
            message=progress.get("error") or "Analysis stopped",
            updated_at=progress.get("updated_at"),
        )
    return RemoteNowOnMac(state="idle", updated_at=progress.get("updated_at"))


_analyzed_cache: Dict[str, Tuple[int, Optional[str]]] = {}
_analyzed_lock = threading.Lock()


def last_analyzed_at(folder: Optional[str]) -> Optional[str]:
    if not folder:
        return None
    path = analysis_results_path(Path(folder))
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return None
    key = str(path)
    with _analyzed_lock:
        cached = _analyzed_cache.get(key)
        if cached and cached[0] == mtime:
            return cached[1]
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("analyzed_at")
    except (OSError, ValueError, AttributeError):
        value = None
    with _analyzed_lock:
        _analyzed_cache[key] = (mtime, value if isinstance(value, str) else None)
    return value if isinstance(value, str) else None


def sources_of(project: dict) -> list:
    manifest = project.get("project") or {}
    durations = {}
    sizes = {}
    for video in project.get("videos", []):
        metadata = video.get("metadata") or {}
        durations[video.get("file_name")] = metadata.get("duration_sec")
        sizes[video.get("file_name")] = metadata.get("size_bytes") or None
    sources = []
    for entry in manifest.get("source_videos", []):
        name = entry["filename"]
        size = entry.get("size_bytes") or sizes.get(name)
        sources.append(
            RemoteSource(
                source_uuid=entry["source_uuid"],
                name=name,
                duration_sec=durations.get(name),
                size_bytes=size,
                imported_at=entry["imported_at"],
                from_phone=bool(entry.get("provenance")),
            )
        )
    return sources


def project_detail(project_uuid: str, project: dict) -> RemoteProjectDetail:
    manifest = project.get("project") or {}
    sources = sources_of(project)
    return RemoteProjectDetail(
        id=project_uuid,
        name=manifest.get("name", ""),
        source_count=len(sources),
        clip_count=len(project.get("clips") or []),
        last_analyzed_at=last_analyzed_at(project.get("project_folder")),
        now_on_mac=now_on_mac(project),
        sources=sources,
    )


def project_summary(
    project_uuid: str, *, name: str, source_count: int, clip_count: int, progress: Optional[dict]
) -> RemoteProjectSummary:
    if progress and progress.get("phase") == "analyzing":
        return RemoteProjectSummary(
            id=project_uuid,
            name=name,
            source_count=source_count,
            clip_count=clip_count,
            state="analyzing",
            percent=analysis_percent(progress),
        )
    return RemoteProjectSummary(
        id=project_uuid,
        name=name,
        source_count=source_count,
        clip_count=clip_count,
        state="ready" if clip_count else "not_analyzed",
    )


def iso(timestamp: Optional[float]) -> Optional[str]:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
