"""One owner per canonical Project root.

The backend used to mint a fresh runtime ID every time a folder was opened and
let any route write the manifest. This service is the single place that knows
which runtime Project owns a folder, serializes state transitions on it, and
keeps a second backend process out:

* ``find_open`` / canonical roots: the same folder reached through a symlink or a
  different spelling resolves to the same runtime Project.
* ``lock(project_id)``: a re-entrant lock for short state transitions only
  (manifest read-modify-write, result persistence, snapshot capture). It is
  never held across network I/O, hashing or FFmpeg.
* an OS ``flock`` on ``clipassembler/.lock`` for as long as the Project is
  open, so another copy of the app gets a refusal instead of racing us.
"""

import fcntl
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Dict, Iterator, MutableMapping, Optional

from .project_store import (
    ProjectManifest,
    ProjectNotFoundError,
    ProjectSourceVideo,
    ProjectStoreError,
    create_or_open_project,
    open_project,
    project_state_dir,
    rescan_project,
    write_project_manifest,
)

LOCK_FILENAME = ".lock"
LOCKED_MESSAGE = "This Project is open in another copy of the app"

ManifestUpdate = Callable[[ProjectManifest], ProjectManifest]
FolderOpener = Callable[[Path], str]


class ProjectLockedError(ProjectStoreError):
    """Another process holds the Project folder."""

    def __init__(self, message: str = LOCKED_MESSAGE) -> None:
        super().__init__(message)


class ProjectService:
    def __init__(
        self,
        projects: MutableMapping[str, dict],
        opener: Optional[FolderOpener] = None,
    ) -> None:
        self._projects = projects
        self._opener = opener
        self._guard = threading.Lock()
        # Serializes "is it open? else open it" so two callers (the desktop and
        # a phone, or two phones) never create two runtime Projects per folder.
        self.open_lock = threading.RLock()
        self._project_locks: Dict[str, threading.RLock] = {}
        self._folder_locks: Dict[Path, int] = {}

    # --- canonical identity -------------------------------------------------

    @staticmethod
    def canonical_root(folder: Path) -> Path:
        return Path(folder).expanduser().resolve()

    def find_open(self, folder: Path) -> Optional[str]:
        """The runtime ``project_id`` already owning *folder*, if any."""
        root = self.canonical_root(folder)
        for project_id, project in list(self._projects.items()):
            recorded = project.get("project_folder")
            if recorded and self.canonical_root(Path(recorded)) == root:
                return project_id
        return None

    def find_open_by_uuid(self, project_uuid: str) -> Optional[str]:
        for project_id, project in list(self._projects.items()):
            manifest = project.get("project") or {}
            if manifest.get("project_uuid") == project_uuid:
                return project_id
        return None

    # --- per-Project transition lock ---------------------------------------

    def _lock_for(self, project_id: str) -> threading.RLock:
        with self._guard:
            lock = self._project_locks.get(project_id)
            if lock is None:
                lock = self._project_locks[project_id] = threading.RLock()
            return lock

    @contextmanager
    def lock(self, project_id: str) -> Iterator[None]:
        lock = self._lock_for(project_id)
        with lock:
            yield

    # --- OS lock across processes -------------------------------------------

    def acquire_folder(self, folder: Path) -> None:
        """Hold the Project's OS lock until ``release_folder`` (idempotent)."""
        root = self.canonical_root(folder)
        with self._guard:
            self._prune_folder_locks_locked()
            if root in self._folder_locks:
                return
            state_dir = project_state_dir(root)
            try:
                state_dir.mkdir(parents=True, exist_ok=True)
                fd = os.open(str(state_dir / LOCK_FILENAME), os.O_RDWR | os.O_CREAT, 0o644)
            except OSError:
                # A read-only folder cannot be locked; it cannot be written
                # by this backend either, so there is nothing to protect.
                return
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                os.close(fd)
                raise ProjectLockedError() from exc
            self._folder_locks[root] = fd

    def release_folder(self, folder: Path) -> None:
        root = self.canonical_root(folder)
        with self._guard:
            fd = self._folder_locks.pop(root, None)
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def _prune_folder_locks_locked(self) -> None:
        """Drop OS locks for roots no runtime Project owns any more."""
        open_roots = {
            self.canonical_root(Path(project["project_folder"]))
            for project in self._projects.values()
            if project.get("project_folder")
        }
        for root in [root for root in self._folder_locks if root not in open_roots]:
            fd = self._folder_locks.pop(root)
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    # --- serialized manifest commits ---------------------------------------

    def _folder_of(self, project_id: str) -> Path:
        project = self._projects.get(project_id)
        if project is None or not project.get("project_folder"):
            raise ProjectNotFoundError(f"Project is not a folder Project: {project_id}")
        return Path(project["project_folder"])

    def update_manifest(
        self,
        project_id: str,
        update: ManifestUpdate,
        *,
        create_if_missing: bool = False,
    ) -> ProjectManifest:
        """Read the latest manifest, transform it and write it, as one step."""
        folder = self._folder_of(project_id)
        with self.lock(project_id):
            current = (
                create_or_open_project(folder) if create_if_missing else open_project(folder)
            )
            updated = update(current)
            write_project_manifest(folder, updated)
            self._projects[project_id]["project"] = updated.model_dump()
            return updated

    def rescan(self, project_id: str) -> ProjectManifest:
        folder = self._folder_of(project_id)
        with self.lock(project_id):
            manifest = rescan_project(folder)
            self._projects[project_id]["project"] = manifest.model_dump()
            return manifest

    def upsert_source_video(
        self, project_id: str, video: ProjectSourceVideo
    ) -> ProjectManifest:
        """Add *video*, or merge it into the entry for the same filename.

        A rescan that saw the file first leaves a bare entry; the ingest merge
        keeps that entry's UUID and attaches the provenance and hash.
        """

        def merge(manifest: ProjectManifest) -> ProjectManifest:
            videos = list(manifest.source_videos)
            for index, existing in enumerate(videos):
                if existing.filename == video.filename:
                    videos[index] = video.model_copy(
                        update={
                            "source_uuid": existing.source_uuid,
                            "imported_at": existing.imported_at,
                        }
                    )
                    break
            else:
                videos.append(video)
            return manifest.model_copy(update={"source_videos": videos})

        return self.update_manifest(project_id, merge)

    # --- remote exposure ----------------------------------------------------

    def open_for_remote(self, project_uuid: str, folder: Path) -> str:
        """Runtime ``project_id`` for an exposed Project, opening it if needed.

        Never creates a Project: the folder must already hold a manifest whose
        UUID is the one the Editor exposed, so a replaced or moved folder is
        not silently exposed in its place.
        """
        with self.open_lock:
            existing = self.find_open_by_uuid(project_uuid)
            if existing is not None:
                return existing
            manifest = open_project(Path(folder))
            if manifest.project_uuid != project_uuid:
                raise ProjectNotFoundError("Project folder no longer matches the exposed Project")
            already = self.find_open(Path(folder))
            if already is not None:
                return already
            if self._opener is None:
                raise ProjectStoreError("No Project opener is configured")
            return self._opener(Path(folder))
