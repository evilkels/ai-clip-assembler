import fcntl
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src import api
from src.project_service import LOCK_FILENAME, ProjectService
from src.project_store import (
    ProjectNotFoundError,
    ProjectSourceVideo,
    UploadProvenance,
    open_project,
)


def make_folder(tmp_path, name="footage", files=("A.MP4",)):
    folder = tmp_path / name
    folder.mkdir()
    for filename in files:
        (folder / filename).write_bytes(b"video " + filename.encode())
    return folder


def open_via_api(client, folder):
    return client.post("/projects/from-folder", json={"folder_path": str(folder)})


@pytest.fixture
def client():
    api.projects.clear()
    yield TestClient(api.app)
    api.projects.clear()


def test_same_folder_through_a_symlink_returns_the_same_project_id(client, tmp_path):
    folder = make_folder(tmp_path)
    link = tmp_path / "link-to-footage"
    link.symlink_to(folder, target_is_directory=True)

    first = open_via_api(client, folder).json()
    second = open_via_api(client, link).json()
    third = open_via_api(client, tmp_path / "footage" / ".." / "footage").json()

    assert first["project_id"] == second["project_id"] == third["project_id"]
    assert len(api.projects) == 1
    assert second["project"]["project_uuid"] == first["project"]["project_uuid"]


def provenance(n):
    return UploadProvenance(
        upload_id=f"up{n}",
        device_id="dev",
        device_label="iPhone",
        owner_login="owner@example.test",
        original_filename=f"IMG_{n}.MOV",
        created_at="2026-10-10T10:00:00Z",
        completed_at="2026-10-10T10:01:00Z",
        verified_at="2026-10-10T10:01:05Z",
        verification_method="sha256-disk-reread",
        sha256=f"{n:064x}",
    )


def test_rescan_and_ingest_from_two_threads_both_survive(client, tmp_path):
    folder = make_folder(tmp_path)
    project_id = open_via_api(client, folder).json()["project_id"]
    service = api.project_service
    count = 25
    stop = threading.Event()
    errors = []

    def rescanner():
        try:
            while not stop.is_set():
                service.rescan(project_id)
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    def ingester():
        try:
            for n in range(count):
                name = f"IMG_{n}-phone-abc.mov"
                (folder / name).write_bytes(b"x" * (n + 1))
                service.upsert_source_video(
                    project_id,
                    ProjectSourceVideo(
                        filename=name,
                        imported_at="2026-10-10T10:01:06Z",
                        size_bytes=n + 1,
                        sha256=f"{n:064x}",
                        provenance=provenance(n),
                    ),
                )
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=rescanner), threading.Thread(target=ingester)]
    for thread in threads:
        thread.start()
    threads[1].join()
    stop.set()
    threads[0].join()

    assert errors == []
    manifest = open_project(folder)
    by_name = {video.filename: video for video in manifest.source_videos}
    assert len(manifest.source_videos) == count + 1  # footage + every ingest
    assert len({video.source_uuid for video in manifest.source_videos}) == count + 1
    for n in range(count):
        video = by_name[f"IMG_{n}-phone-abc.mov"]
        assert video.provenance is not None and video.provenance.upload_id == f"up{n}"
    assert api.projects[project_id]["project"]["project_uuid"] == manifest.project_uuid


def test_second_process_holding_the_folder_gets_409(client, tmp_path):
    folder = make_folder(tmp_path)
    open_via_api(client, folder)  # creates the manifest and takes our lock
    api.projects.clear()
    api.project_service._prune_folder_locks_locked()  # our lock goes with the Project
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            textwrap.dedent(
                """
                import fcntl, sys, os
                fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                print("held", flush=True)
                sys.stdin.read()
                """
            ),
            str(folder / "clipassembler" / LOCK_FILENAME),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout.readline().strip() == "held"
        manifest_before = (folder / "clipassembler" / "project.json").read_bytes()

        response = open_via_api(client, folder)

        assert response.status_code == 409
        assert response.json()["detail"] == "This Project is open in another copy of the app"
        assert api.projects == {}
        assert (folder / "clipassembler" / "project.json").read_bytes() == manifest_before
    finally:
        holder.stdin.close()
        holder.wait(timeout=10)

    assert open_via_api(client, folder).status_code == 200


def test_open_project_holds_an_exclusive_os_lock_until_deleted(client, tmp_path):
    folder = make_folder(tmp_path)
    project_id = open_via_api(client, folder).json()["project_id"]
    lock_path = folder / "clipassembler" / LOCK_FILENAME

    def can_lock():
        fd = lock_path.open("a+")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False
        finally:
            fd.close()

    assert not can_lock()
    assert client.delete(f"/projects/{project_id}/files").status_code == 200
    assert api.project_service._folder_locks == {}
    assert not lock_path.exists()


def test_locks_for_projects_that_are_gone_are_released_on_next_open(client, tmp_path):
    first = make_folder(tmp_path, "one")
    second = make_folder(tmp_path, "two")
    open_via_api(client, first)
    api.projects.clear()
    open_via_api(client, second)

    assert list(api.project_service._folder_locks) == [second.resolve()]


def test_open_for_remote_opens_an_unopened_project_by_uuid(client, tmp_path):
    folder = make_folder(tmp_path)
    opened = open_via_api(client, folder).json()
    project_uuid = opened["project"]["project_uuid"]
    service = api.project_service

    assert service.open_for_remote(project_uuid, folder) == opened["project_id"]

    api.projects.clear()
    reopened = service.open_for_remote(project_uuid, folder)
    assert reopened in api.projects
    assert api.projects[reopened]["project"]["project_uuid"] == project_uuid
    assert service.open_for_remote(project_uuid, folder) == reopened


def test_open_for_remote_refuses_a_folder_that_is_not_that_project(client, tmp_path):
    folder = make_folder(tmp_path)
    other = make_folder(tmp_path, "other")
    open_via_api(client, other)
    api.projects.clear()
    service = api.project_service

    with pytest.raises(ProjectNotFoundError):
        service.open_for_remote("00000000-0000-0000-0000-000000000000", other)
    assert api.projects == {}

    # A folder without a manifest is never turned into a Project remotely.
    with pytest.raises(ProjectNotFoundError):
        service.open_for_remote("whatever", folder)
    assert not (folder / "clipassembler").exists()


def test_project_lock_is_reentrant_and_per_project():
    service = ProjectService({})
    with service.lock("a"):
        with service.lock("a"):
            pass
        other_acquired = []
        thread = threading.Thread(
            target=lambda: [service.lock("b").__enter__(), other_acquired.append(True)]
        )
        thread.start()
        thread.join(timeout=2)
        assert other_acquired == [True]
        blocked = []
        thread = threading.Thread(target=lambda: (service.lock("a").__enter__(), blocked.append(1)))
        thread.daemon = True
        thread.start()
        thread.join(timeout=0.2)
        assert blocked == []  # same project from another thread must wait


def test_canonical_root_resolves_symlinks(tmp_path):
    folder = make_folder(tmp_path)
    link = tmp_path / "l"
    link.symlink_to(folder, target_is_directory=True)
    assert ProjectService.canonical_root(link) == Path(folder).resolve()
