import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator

from .models import ReviewSession, TimelineDocument, TimelineItem


PROJECT_STATE_DIRNAME = "clipassembler"
PROJECT_MANIFEST_FILENAME = "project.json"
PROJECT_SCHEMA_VERSION = 1
ANALYSIS_RESULTS_FILENAME = "results.json"
ANALYSIS_RESULTS_SCHEMA_VERSION = 1
TIMELINE_DOCUMENT_FILENAME = "timeline.json"
REVIEW_SESSION_FILENAME = "review-session.json"
SUPPORTED_SOURCE_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv"}
DEFAULT_HARNESS_ID = "pi_agent"
UNSAFE_PROJECT_ROOTS = [
    Path("/System"),
    Path("/Applications"),
]


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


class UnsafeProjectFolderError(ProjectStoreError):
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
    validate_safe_project_folder(project_folder)
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
    (state_dir / "cache" / ".nosync").touch()
    write_project_manifest(project_folder, manifest)
    return manifest


def rescan_project(
    project_folder: Path,
    now: Callable[[], datetime] = datetime_now_utc,
) -> ProjectManifest:
    manifest = open_project(project_folder)
    scanned_filenames = scan_source_video_filenames(project_folder)
    existing_by_filename = {video.filename: video for video in manifest.source_videos}
    imported_at = format_timestamp(now())
    reconciled_videos = [
        existing_by_filename.get(filename)
        or ProjectSourceVideo(filename=filename, imported_at=imported_at)
        for filename in scanned_filenames
    ]

    updated = manifest.model_copy(
        update={"source_videos": reconciled_videos}
    )
    write_project_manifest(project_folder, updated)
    return updated


def delete_project_files(project_folder: Path) -> List[str]:
    validate_project_folder(project_folder)
    deleted = []
    for dirname in [PROJECT_STATE_DIRNAME, "exports"]:
        path = project_folder / dirname
        if path.exists():
            shutil.rmtree(path)
            deleted.append(dirname)
    return deleted


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


def validate_safe_project_folder(project_folder: Path) -> None:
    resolved = project_folder.resolve()
    for unsafe_root in UNSAFE_PROJECT_ROOTS:
        unsafe = unsafe_root.resolve()
        if resolved == unsafe or unsafe in resolved.parents:
            raise UnsafeProjectFolderError(
                f"Project folder is not allowed in protected location: {project_folder}"
            )


def analysis_results_path(project_folder: Path) -> Path:
    return project_state_dir(project_folder) / "analysis" / ANALYSIS_RESULTS_FILENAME


def write_analysis_results(
    project_folder: Path,
    *,
    harness_id: str,
    clips: List[dict],
    timeline: Optional[dict],
    now: Callable[[], datetime] = datetime_now_utc,
) -> None:
    payload = {
        "schema_version": ANALYSIS_RESULTS_SCHEMA_VERSION,
        "harness_id": harness_id,
        "analyzed_at": format_timestamp(now()),
        "clips": clips,
        "timeline": timeline,
    }
    path = analysis_results_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_analysis_results(project_folder: Path) -> Optional[dict]:
    path = analysis_results_path(project_folder)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("schema_version") != ANALYSIS_RESULTS_SCHEMA_VERSION:
        return None
    if not isinstance(payload.get("clips"), list):
        return None
    return payload


def review_session_path(project_folder: Path) -> Path:
    return project_state_dir(project_folder) / "analysis" / REVIEW_SESSION_FILENAME


def write_review_session(project_folder: Path, session: ReviewSession) -> None:
    path = review_session_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(session.model_dump_json(indent=2) + "\n", encoding="utf-8")


def read_review_session(project_folder: Path) -> Optional[ReviewSession]:
    path = review_session_path(project_folder)
    if not path.exists():
        return None
    try:
        session = ReviewSession.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, json.JSONDecodeError):
        return None
    if session.schema_version != 1:
        return None
    return session


def timeline_document_path(project_folder: Path) -> Path:
    return project_state_dir(project_folder) / "analysis" / TIMELINE_DOCUMENT_FILENAME


def write_timeline_document(project_folder: Path, document: TimelineDocument) -> None:
    """Persist the backend-authoritative Timeline Document for a project."""
    path = timeline_document_path(project_folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(document.model_dump_json(indent=2) + "\n", encoding="utf-8")


def read_timeline_document(project_folder: Path) -> Optional[TimelineDocument]:
    """Load a saved Timeline Document, or ``None`` if absent/unreadable."""
    path = timeline_document_path(project_folder)
    if not path.exists():
        return None
    try:
        return TimelineDocument.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, json.JSONDecodeError):
        return None


def migrate_legacy_timeline(
    legacy: dict,
    sources: Optional[Dict[str, object]] = None,
) -> TimelineDocument:
    """Upgrade an old ``{clip_id, start_sec, end_sec}`` timeline into a document.

    The legacy timeline stored clips either as bare clip-id strings or as dicts
    with bounds. Each becomes a :class:`TimelineItem` with a fresh ``item_id``,
    ``speed = 1.0`` and an identity transform. Bare ids resolve their bounds from
    the supplied ``sources`` registry (entries that cannot be resolved are
    dropped rather than failing the whole migration).
    """
    items: List[TimelineItem] = []
    for entry in legacy.get("clips") or []:
        if isinstance(entry, str):
            clip_id, start_sec, end_sec = entry, None, None
        elif isinstance(entry, dict):
            clip_id = entry.get("clip_id")
            start_sec = entry.get("start_sec")
            end_sec = entry.get("end_sec")
        else:
            continue
        if not clip_id:
            continue
        if start_sec is None or end_sec is None:
            source = (sources or {}).get(clip_id)
            if source is None:
                continue
            start_sec = getattr(source, "start_sec", None)
            end_sec = getattr(source, "end_sec", None)
            if start_sec is None or end_sec is None:
                continue
        items.append(
            TimelineItem(
                item_id=uuid.uuid4().hex,
                source_clip_id=clip_id,
                start_sec=float(start_sec),
                end_sec=float(end_sec),
            )
        )
    decisions = legacy.get("decisions")
    return TimelineDocument(
        items=items,
        profile=legacy.get("profile"),
        target_duration_sec=legacy.get("target_duration_sec"),
        decisions=decisions if isinstance(decisions, dict) else {},
    )


def load_timeline_document(
    project_folder: Path,
    legacy: Optional[dict] = None,
    sources: Optional[Dict[str, object]] = None,
) -> Optional[TimelineDocument]:
    """Resolve a project's Timeline Document, preferring the saved one.

    Returns the saved document if present; otherwise migrates the supplied
    ``legacy`` timeline (the old in-memory/results shape); otherwise ``None``.
    """
    saved = read_timeline_document(project_folder)
    if saved is not None:
        return saved
    if legacy is not None:
        return migrate_legacy_timeline(legacy, sources=sources)
    return None


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
