import re
import shutil
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import List

from .types import AiRequest

_ABSOLUTE_PATH = re.compile(
    r'(?:(?<![\w./:])|(?<=file://))/'
    r'(?:[^\s/"\'<>][^/"\'<>]*/)+[^/\s"\'<>]+'
)


def strip_paths(text: str) -> str:
    def replace(match):
        value = match.group(0)
        trimmed = value.rstrip(".,;:!?)]}")
        return Path(trimmed).name + value[len(trimmed) :]

    return _ABSOLUTE_PATH.sub(replace, text)


_NAME = re.compile(r"^(?:frame-\d{2}|clip-\d-frame-\d)\.jpg$")


class PayloadError(ValueError):
    pass


@dataclass
class StagedRequest:
    cwd: Path
    images: List[Path]
    names: List[str]
    request: AiRequest


def validate_images(paths, samples_dir, limit) -> List[Path]:
    if len(paths) > limit:
        raise PayloadError(f"At most {limit} images are allowed")
    root = Path(samples_dir).resolve()
    resolved = []
    for path in paths:
        candidate = Path(path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise PayloadError("Images must be inside the samples directory") from exc
        if not candidate.exists() or not candidate.is_file():
            raise PayloadError("Images must be regular files")
        if candidate.suffix != ".jpg":
            raise PayloadError("Images must use the .jpg extension")
        resolved.append(candidate)
    return resolved


def _names(request: AiRequest) -> List[str]:
    names = request.image_names
    if names is None:
        names = [f"frame-{index:02d}.jpg" for index in range(1, len(request.images) + 1)]
    if len(names) != len(request.images) or len(set(names)) != len(names):
        raise PayloadError("Image names must be unique and match the image count")
    if any(not _NAME.fullmatch(name) for name in names):
        raise PayloadError("Invalid staged image name")
    return names


def stage(request: AiRequest) -> StagedRequest:
    if request.images and request.samples_dir is None:
        raise PayloadError("samples_dir is required when images are provided")
    paths = (
        validate_images(request.images, request.samples_dir, request.image_limit)
        if request.images
        else []
    )
    names = _names(request)
    cwd = Path(tempfile.mkdtemp(prefix="aca-ai-"))
    staged_images = []
    try:
        for source, name in zip(paths, names):
            target = cwd / name
            shutil.copyfile(source, target)
            staged_images.append(target)
    except Exception:
        shutil.rmtree(cwd, ignore_errors=True)
        raise
    staged_request = request.model_copy(update={"images": staged_images, "image_names": names})
    return StagedRequest(cwd=cwd, images=staged_images, names=names, request=staged_request)


def cleanup(staged_request: StagedRequest) -> None:
    shutil.rmtree(staged_request.cwd, ignore_errors=True)


@contextmanager
def staged(request: AiRequest):
    value = stage(request)
    try:
        yield value
    finally:
        cleanup(value)
