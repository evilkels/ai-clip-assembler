import subprocess
from pathlib import Path
from typing import Callable, List

from .models import FrameSample


class FFmpegUnavailableError(RuntimeError):
    pass


class FFmpegError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess]


def format_filter_number(value: float) -> str:
    return str(int(value)) if value == int(value) else str(value)


def frame_output_path(frames_dir: Path, file_id: str, timestamp: float) -> Path:
    milliseconds = int(round(timestamp * 1000))
    return frames_dir / f"{file_id}_{milliseconds:06d}.jpg"


def build_frame_extract_command(
    input_path: Path,
    output_pattern: Path,
    sample_fps: float = 1.0,
    max_width: int = 960,
) -> List[str]:
    vf = f"fps={format_filter_number(sample_fps)},scale='min({max_width},iw)':-2"
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        vf,
        "-q:v",
        "3",
        str(output_pattern),
    ]


def extract_frames(
    input_path: Path,
    frames_dir: Path,
    file_id: str,
    sample_fps: float = 1.0,
    max_width: int = 960,
    runner: Runner = subprocess.run,
) -> List[FrameSample]:
    if sample_fps <= 0:
        raise ValueError("sample_fps must be greater than 0")

    if frames_dir.exists():
        for old_frame in frames_dir.glob(f"{file_id}_*.jpg"):
            old_frame.unlink()
    frames_dir.mkdir(parents=True, exist_ok=True)
    output_pattern = frames_dir / f"{file_id}_raw_%06d.jpg"
    try:
        runner(
            build_frame_extract_command(input_path, output_pattern, sample_fps, max_width),
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise FFmpegUnavailableError("ffmpeg is required for frame extraction") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr or str(exc)
        raise FFmpegError(f"ffmpeg frame extraction failed for {input_path}: {detail}") from exc

    samples = []
    for index, raw_path in enumerate(sorted(frames_dir.glob(f"{file_id}_raw_*.jpg"))):
        timestamp = index / sample_fps
        timestamped_path = frame_output_path(frames_dir, file_id, timestamp)
        raw_path.replace(timestamped_path)
        samples.append(
            FrameSample(
                timestamp=timestamp,
                frame_path=str(timestamped_path),
                is_keyframe=True,
            )
        )
    return samples
