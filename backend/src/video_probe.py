import json
import math
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Sequence

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


def parse_rotation_degrees(video_stream: Dict[str, Any]) -> int:
    for side_data in video_stream.get("side_data_list", []):
        if "rotation" in side_data:
            return int(round(float(side_data["rotation"]))) % 360
    tags = video_stream.get("tags", {})
    if "rotate" in tags:
        return int(round(float(tags["rotate"]))) % 360
    return 0


def display_resolution(width: int, height: int, rotation_degrees: int) -> list[int]:
    if abs(rotation_degrees) % 180 == 90:
        return [height, width]
    return [width, height]


def parse_positive_int(value: Any) -> Optional[int]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0 or not number.is_integer():
        return None
    return int(number)


def parse_ffprobe_metadata(video_path: Path, payload: Dict[str, Any]) -> VideoMetadata:
    video_stream = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        raise FFprobeError(f"No video stream found in {video_path}")
    audio_stream = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )
    audio_channels = parse_positive_int(audio_stream.get("channels")) if audio_stream else None
    audio_sample_rate = parse_positive_int(audio_stream.get("sample_rate")) if audio_stream else None
    audio_bit_depth = None
    if audio_stream:
        audio_bit_depth = parse_positive_int(audio_stream.get("bits_per_sample"))
        if audio_bit_depth is None:
            audio_bit_depth = parse_positive_int(audio_stream.get("bits_per_raw_sample"))
        if audio_bit_depth is None:
            audio_bit_depth = 16

    duration_value = payload.get("format", {}).get("duration") or video_stream.get("duration") or 0
    width = int(video_stream["width"])
    height = int(video_stream["height"])
    rotation = parse_rotation_degrees(video_stream)
    size_value = payload.get("format", {}).get("size")
    try:
        size_bytes = int(size_value)
    except (TypeError, ValueError):
        try:
            size_bytes = video_path.stat().st_size
        except OSError:
            size_bytes = 0
    created_at = extract_created_at(video_path, payload, video_stream)
    r_frame_rate = _usable_rate(parse_frame_rate(video_stream.get("r_frame_rate") or "0/0"))
    avg_frame_rate = _usable_rate(parse_frame_rate(video_stream.get("avg_frame_rate") or "0/0"))
    if r_frame_rate and avg_frame_rate and abs(avg_frame_rate - r_frame_rate) / r_frame_rate <= 0.01:
        fps = r_frame_rate
    else:
        fps = avg_frame_rate or r_frame_rate
    return VideoMetadata(
        file_id=str(uuid.uuid4()),
        file_path=str(video_path),
        file_name=video_path.name,
        duration_sec=round(float(duration_value), 3),
        fps=fps,
        resolution=[width, height],
        display_resolution=display_resolution(width, height, rotation),
        rotation_degrees=rotation,
        codec=str(video_stream.get("codec_name", "unknown")),
        size_bytes=size_bytes,
        created_at=created_at,
        has_audio=audio_stream is not None,
        audio_channels=audio_channels,
        audio_sample_rate=audio_sample_rate,
        audio_codec=str(audio_stream["codec_name"]) if audio_stream and audio_stream.get("codec_name") else None,
        audio_bit_depth=audio_bit_depth,
    )


def extract_created_at(
    video_path: Path, payload: Dict[str, Any], video_stream: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Recording time from container tags, falling back to the file mtime."""
    format_tags = payload.get("format", {}).get("tags", {}) or {}
    stream_tags = (video_stream or {}).get("tags", {}) or {}
    timestamps = (
        _case_insensitive_tag(format_tags, "com.apple.quicktime.creationdate"),
        _case_insensitive_tag(format_tags, "creation_time"),
        _case_insensitive_tag(stream_tags, "creation_time"),
    )
    for timestamp in timestamps:
        normalized = _normalize_timestamp(timestamp)
        if normalized is not None:
            return normalized
    try:
        mtime = video_path.stat().st_mtime
        return _format_utc_timestamp(datetime.fromtimestamp(mtime, tz=timezone.utc))
    except OSError:
        return None


def _usable_rate(rate: float) -> float:
    return rate if math.isfinite(rate) and rate > 0 else 0.0


def _case_insensitive_tag(tags: Dict[str, Any], key: str) -> Any:
    key = key.casefold()
    return next((value for tag, value in tags.items() if str(tag).casefold() == key), None)


def _normalize_timestamp(value: Any) -> Optional[str]:
    if value is None or not str(value).strip():
        return None
    timestamp = str(value).strip()
    if timestamp.endswith(("Z", "z")):
        timestamp = f"{timestamp[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(timestamp)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    try:
        return _format_utc_timestamp(parsed)
    except (OverflowError, ValueError):
        return None


def _format_utc_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


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
