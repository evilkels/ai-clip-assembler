import subprocess
from pathlib import Path
from typing import Callable, List


class FFmpegVidstabUnavailableError(RuntimeError):
    pass


class FFmpegVidstabError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess]


def build_vidstabdetect_command(input_path: Path, transforms_path: Path) -> List[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        f"vidstabdetect=result={transforms_path}",
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
        raise FFmpegVidstabError(f"ffmpeg vidstabdetect failed for {input_path}: {detail}") from exc
    return transforms_path
