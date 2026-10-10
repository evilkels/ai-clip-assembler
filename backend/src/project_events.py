"""Project event vocabulary shared by the desktop SSE stream and Remote View.

Events are tiny, secret-free hints (``timeline-changed``, ``analysis-progress``,
``sources-changed``); clients reconcile by fetching the authoritative state.
"""

import threading
import time
from typing import Callable, Dict, Optional

TIMELINE_CHANGED = "timeline-changed"
ANALYSIS_PROGRESS = "analysis-progress"
SOURCES_CHANGED = "sources-changed"

PROGRESS_MIN_INTERVAL_SEC = 1.0

# Where each analysis step sits inside one video's share of the run.
_STEP_FRACTION = {
    "starting": 0.0,
    "motion_analysis": 0.05,
    "frame_extraction": 0.35,
    "scene_detection": 0.6,
    "scoring_clips": 0.75,
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


def analysis_event(progress: dict) -> dict:
    """The desktop/phone-neutral ``analysis-progress`` payload."""
    return {
        "type": ANALYSIS_PROGRESS,
        "phase": progress.get("phase"),
        "step": progress.get("step"),
        "message": progress.get("message"),
        "percent": analysis_percent(progress),
        "video_index": progress.get("video_index"),
        "video_total": progress.get("video_total"),
        "error": progress.get("error"),
    }


class ProgressGate:
    """At most one ``analysis-progress`` per second, plus every phase change."""

    def __init__(
        self,
        min_interval: float = PROGRESS_MIN_INTERVAL_SEC,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._min_interval = min_interval
        self._clock = clock
        self._lock = threading.Lock()
        self._last: Dict[str, tuple] = {}

    def allow(self, project_id: str, phase: Optional[str]) -> bool:
        now = self._clock()
        with self._lock:
            previous = self._last.get(project_id)
            if previous is not None and previous[1] == phase and now - previous[0] < self._min_interval:
                return False
            self._last[project_id] = (now, phase)
            return True

    def forget(self, project_id: str) -> None:
        with self._lock:
            self._last.pop(project_id, None)
