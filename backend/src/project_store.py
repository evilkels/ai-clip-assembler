import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List

from pydantic import BaseModel, Field, ValidationError, field_validator


PROJECT_STATE_DIRNAME = "clipassembler"
PROJECT_MANIFEST_FILENAME = "project.json"
PROJECT_SCHEMA_VERSION = 1
SUPPORTED_SOURCE_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv"}
DEFAULT_HARNESS_ID = "pi_agent"


class ProjectStoreError(Exception):
    pass


class ProjectNotFoundError(ProjectStoreError):
    pass


class ProjectFolderNotWritableError(ProjectStoreError):
    pass


class NoSourceVideosFoundError(ProjectStoreError):
    pass


class InvalidProjectManifestError(ProjectStoreError):
    pass


class ProjectSourceVideo(BaseModel):
    filename: str
    imported_at: str

    @field_validator("filename")
    @classmethod
    def filename_must_be_top_level_relative_name(cls, value: str) -> str:
        if not value:
            raise ValueError("filename is required")
        if Path(value).is_absolute() or Path(value).name != value or "\\" in value:
            raise ValueError("filename must be a top-level relative filename")
        return value


class ProjectManifest(BaseModel):
    schema_version: int = PROJECT_SCHEMA_VERSION
    name: str
    created_at: str
    harness: str = DEFAULT_HARNESS_ID
    source_videos: List[ProjectSourceVideo]
    settings_overrides: dict = Field(default_factory=dict)

    @field_validator("schema_version")
    @classmethod
    def schema_version_must_be_supported(cls, value: int) -> int:
        if value != PROJECT_SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version: {value}")
        return value


def datetime_now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_or_open_project(
    project_folder: Path,
    now: Callable[[], datetime] = datetime_now_utc,
) -> ProjectManifest:
    if project_manifest_path(project_folder).exists():
        return open_project(project_folder)
    return create_project(project_folder, now=now)


def create_project(
    project_folder: Path,
    now: Callable[[], datetime] = datetime_now_utc,
) -> ProjectManifest:
    if project_manifest_path(project_folder).exists():
        return open_project(project_folder)

    validate_project_folder(project_folder)
    if not has_write_permission(project_folder):
        raise ProjectFolderNotWritableError(
            f"Project folder is not writable: {project_folder}"
        )

    source_video_filenames = scan_source_video_filenames(project_folder)
    if not source_video_filenames:
        raise NoSourceVideosFoundError(
            f"No supported source videos found in: {project_folder}"
        )

    created_at = format_timestamp(now())
    manifest = ProjectManifest(
        name=project_folder.name,
        created_at=created_at,
        source_videos=[
            ProjectSourceVideo(filename=filename, imported_at=created_at)
            for filename in source_video_filenames
        ],
    )

    state_dir = project_state_dir(project_folder)
    (state_dir / "samples").mkdir(parents=True, exist_ok=True)
    (state_dir / "analysis").mkdir(parents=True, exist_ok=True)
    (state_dir / "cache").mkdir(parents=True, exist_ok=True)
    write_project_manifest(project_folder, manifest)
    return manifest


def open_project(project_folder: Path) -> ProjectManifest:
    manifest_path = project_manifest_path(project_folder)
    if not manifest_path.exists():
        raise ProjectNotFoundError(f"Project manifest not found: {manifest_path}")

    try:
        return ProjectManifest.model_validate_json(
            manifest_path.read_text(encoding="utf-8")
        )
    except (json.JSONDecodeError, ValidationError) as exc:
        raise InvalidProjectManifestError(
            f"Invalid project manifest: {manifest_path}"
        ) from exc


def write_project_manifest(project_folder: Path, manifest: ProjectManifest) -> None:
    project_manifest_path(project_folder).write_text(
        manifest.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )


def scan_source_video_filenames(project_folder: Path) -> List[str]:
    validate_project_folder(project_folder)
    return sorted(
        [
            path.name
            for path in project_folder.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_SOURCE_VIDEO_EXTENSIONS
        ],
        key=str.casefold,
    )


def validate_project_folder(project_folder: Path) -> None:
    if not project_folder.exists():
        raise FileNotFoundError(f"Project folder does not exist: {project_folder}")
    if not project_folder.is_dir():
        raise NotADirectoryError(f"Project path is not a folder: {project_folder}")


def project_state_dir(project_folder: Path) -> Path:
    return project_folder / PROJECT_STATE_DIRNAME


def project_manifest_path(project_folder: Path) -> Path:
    return project_state_dir(project_folder) / PROJECT_MANIFEST_FILENAME


def has_write_permission(path: Path) -> bool:
    return os.access(path, os.W_OK)


def format_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")
