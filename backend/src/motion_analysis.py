import math
import subprocess
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Callable, List, Optional, Sequence, Tuple


class FFmpegVidstabUnavailableError(RuntimeError):
    pass


class FFmpegVidstabError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess]

# vidstabdetect estimates *global* camera motion, which is robust to
# downscaling. Running it on a small proxy frame is ~8x faster than full
# resolution (≈35s → ≈4s on a 12s 1080p clip) with no meaningful change to the
# detected motion. Width only; height auto-scales to keep the aspect ratio.
VIDSTAB_ANALYSIS_WIDTH = 640


@dataclass(frozen=True)
class FFmpegVidstabCapability:
    available: bool
    reason: Optional[str] = None


@dataclass(frozen=True)
class FrameTransform:
    t: float
    dx: float
    dy: float
    da: float
    zoom: float


FRAME_RE = re.compile(r"^Frame\s+(\d+)")
LOCAL_MOTION_RE = re.compile(
    r"\(LM\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+"
    r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+"
    r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)"
)


def ffmpeg_supports_vidstab(runner: Runner = subprocess.run) -> FFmpegVidstabCapability:
    try:
        result = runner(
            ["ffmpeg", "-hide_banner", "-filters"],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return FFmpegVidstabCapability(
            available=False,
            reason="ffmpeg was not found; motion-stability analysis will be skipped.",
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or str(exc)
        return FFmpegVidstabCapability(
            available=False,
            reason=f"ffmpeg filter detection failed; motion-stability analysis will be skipped: {detail}",
        )
    filters = f"{result.stdout}\n{result.stderr}"
    if "vidstabdetect" not in filters:
        return FFmpegVidstabCapability(
            available=False,
            reason="ffmpeg lacks vidstabdetect; motion-stability analysis will be skipped.",
        )
    return FFmpegVidstabCapability(available=True)


def _is_missing_vidstab_error(detail: str) -> bool:
    lowered = detail.lower()
    return "vidstabdetect" in lowered and (
        "no such filter" in lowered
        or "filter not found" in lowered
        or "not found" in lowered
    )


def fit_rotation_degrees(
    motions: Sequence[Tuple[float, float]],
    positions: Sequence[Tuple[float, float]],
) -> float:
    """Least-squares rotation (degrees) of a local-motion field.

    vidstab stores per-frame local motions as (vector, field-position) pairs but
    no rotation. Modelling each motion as ``m = t + θ·perp(r)`` (translation plus
    a small rotation about the field centroid, where ``r`` is the position
    relative to that centroid and ``perp(r) = (-r_y, r_x)``), translation drops
    out once both motions and positions are centred, leaving the closed form
    ``θ = Σ(r_x·dm_y − r_y·dm_x) / Σ‖r‖²``. Scale-invariant, so the 640px proxy
    needs no normalisation.
    """
    count = len(motions)
    if count < 2:
        return 0.0
    cx = sum(p[0] for p in positions) / count
    cy = sum(p[1] for p in positions) / count
    mean_vx = sum(m[0] for m in motions) / count
    mean_vy = sum(m[1] for m in motions) / count
    numerator = 0.0
    denominator = 0.0
    for (vx, vy), (px, py) in zip(motions, positions):
        rx, ry = px - cx, py - cy
        dmx, dmy = vx - mean_vx, vy - mean_vy
        numerator += rx * dmy - ry * dmx
        denominator += rx * rx + ry * ry
    if denominator == 0:
        return 0.0
    return math.degrees(numerator / denominator)


def parse_trf(path: Path, fps: float = 30.0) -> List[FrameTransform]:
    """Parse vidstab's ASCII local-motion format into robust frame transforms.

    LM fields are ``(LM v.x v.y f.x f.y f.size contrast match)`` — motion vector
    first, field position second. ``dx``/``dy`` are the median motion (robust to
    outlier blocks); ``da`` is the rotation fitted from the field (see
    :func:`fit_rotation_degrees`), in degrees per inter-frame interval.
    """
    transforms = []
    frame_rate = fps if fps > 0 else 30.0
    for line in path.read_text(encoding="utf-8").splitlines():
        frame_match = FRAME_RE.match(line)
        if not frame_match:
            continue
        motions = LOCAL_MOTION_RE.findall(line)
        vectors = [(float(item[0]), float(item[1])) for item in motions]
        positions = [(float(item[2]), float(item[3])) for item in motions]
        dx = median(v[0] for v in vectors) if vectors else 0.0
        dy = median(v[1] for v in vectors) if vectors else 0.0
        da = fit_rotation_degrees(vectors, positions)
        frame_number = int(frame_match.group(1))
        transforms.append(
            FrameTransform(
                t=(frame_number - 1) / frame_rate,
                dx=dx,
                dy=dy,
                da=da,
                zoom=1.0,
            )
        )
    return transforms


def build_vidstabdetect_command(input_path: Path, transforms_path: Path) -> List[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        f"scale={VIDSTAB_ANALYSIS_WIDTH}:-2,vidstabdetect=result={transforms_path}:fileformat=ascii",
        "-f",
        "null",
        "-",
    ]


def run_vidstabdetect(
    input_path: Path,
    transforms_path: Path,
    runner: Runner = subprocess.run,
) -> Path:
    transforms_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        runner(
            build_vidstabdetect_command(input_path, transforms_path),
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise FFmpegVidstabUnavailableError("ffmpeg is required for vidstabdetect analysis") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or str(exc)
        if _is_missing_vidstab_error(detail):
            raise FFmpegVidstabUnavailableError(
                "ffmpeg lacks vidstabdetect; motion-stability analysis will be skipped"
            ) from exc
        raise FFmpegVidstabError(f"ffmpeg vidstabdetect failed for {input_path}: {detail}") from exc
    return transforms_path
