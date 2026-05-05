import json
import subprocess
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Sequence

from .models import VideoMetadata


class FFprobeUnavailableError(RuntimeError):
    pass


class FFprobeError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess]


def parse_frame_rate(value: str) -> float:
    if not value or value == "0/0":
        return 0.0
    if "/" not in value:
        return round(float(value), 2)
    numerator, denominator = value.split("/", 1)
    denominator_float = float(denominator)
    if denominator_float == 0:
        return 0.0
    return round(float(numerator) / denominator_float, 2)


def parse_ffprobe_metadata(video_path: Path, payload: Dict[str, Any]) -> VideoMetadata:
    video_stream = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        raise FFprobeError(f"No video stream found in {video_path}")

    duration_value = payload.get("format", {}).get("duration") or video_stream.get("duration") or 0
    return VideoMetadata(
        file_id=str(uuid.uuid4()),
        file_path=str(video_path),
        file_name=video_path.name,
        duration_sec=round(float(duration_value), 3),
        fps=parse_frame_rate(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/0"),
        resolution=[int(video_stream["width"]), int(video_stream["height"])],
        codec=str(video_stream.get("codec_name", "unknown")),
    )


def ffprobe_command(video_path: Path) -> Sequence[str]:
    return [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]


def probe_video(video_path: Path, runner: Runner = subprocess.run) -> VideoMetadata:
    try:
        completed = runner(
            ffprobe_command(video_path),
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise FFprobeUnavailableError("ffprobe is required for video metadata extraction") from exc
    except subprocess.CalledProcessError as exc:
        raise FFprobeError(f"ffprobe failed for {video_path}: {exc.stderr}") from exc

    return parse_ffprobe_metadata(video_path, json.loads(completed.stdout))
