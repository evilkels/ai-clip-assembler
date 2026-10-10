"""Shared harness for the Remote View backend tests."""

import json

from fastapi.testclient import TestClient

from src import api
from src.remote.app import create_remote_app
from src.remote.auth import RemoteAuth
from src.remote.runtime import RemoteRuntime
from src.remote.store import RemoteStore

OWNER = "owner@example.test"
ORIGIN = "https://mac.tailnet.ts.net:8448"
MAC_NAME = "macbook-pro"


class Clock:
    def __init__(self, start=1_800_000_000.0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class Phone:
    """One browser: its own cookie jar, CSRF token and request defaults."""

    def __init__(self, harness, label="iPhone"):
        self.h = harness
        self.client = TestClient(harness.app, base_url="https://testserver")
        self.label = label
        self.csrf = None

    def headers(self, *, mutating=False, origin=ORIGIN, login=OWNER, extra=None):
        headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1"}
        if login is not None:
            headers["Tailscale-User-Login"] = login
        if mutating:
            if origin is not None:
                headers["Origin"] = origin
            if self.csrf:
                headers["X-CSRF-Token"] = self.csrf
        headers.update(extra or {})
        return headers

    def url(self, path):
        return f"/{self.h.runtime.ingress}{path}"

    def get(self, path, **kwargs):
        return self.client.get(self.url(path), headers=self.headers(**kwargs))

    def request(self, method, path, *, json_body=None, content=None, extra=None, **kwargs):
        kwargs.setdefault("mutating", method not in ("GET", "HEAD", "OPTIONS"))
        return self.client.request(
            method,
            self.url(path),
            headers=self.headers(extra=extra, **kwargs),
            json=json_body,
            content=content,
        )

    def post(self, path, json_body=None, **kwargs):
        return self.request("POST", path, json_body=json_body, **kwargs)

    def pair(self, approve=True):
        code = self.h.auth.new_pairing_code()
        response = self.post("/api/pair", {"token": code.token, "label": self.label}, mutating=True)
        assert response.status_code == 202, response.text
        pending_id = response.json()["pending_id"]
        if approve:
            self.h.auth.approve(pending_id)
            poll = self.get(f"/api/pair/{pending_id}")
            assert poll.json()["state"] == "approved", poll.text
            self.csrf = poll.json()["csrf_token"]
        return pending_id


class RemoteHarness:
    def __init__(self, tmp_path, ui_dir=None, clock=None):
        api.projects.clear()
        self.clock = clock or Clock()
        self.store = RemoteStore(tmp_path / "remote-store")
        self.auth = RemoteAuth(self.store, clock=self.clock)
        self.runtime = RemoteRuntime(
            store=self.store,
            auth=self.auth,
            project_service=api.project_service,
            projects=api.projects,
            ui_dir=ui_dir,
        )
        self.runtime.open_lease(OWNER, ORIGIN, MAC_NAME)
        self.app = create_remote_app(self.runtime)

    def phone(self, label="iPhone"):
        return Phone(self, label)

    def paired_phone(self, label="iPhone"):
        phone = self.phone(label)
        phone.pair()
        return phone

    def make_project(self, tmp_path, name="footage", files=("A.MP4",), shown=True):
        """A folder Project exposed (or not) to phones; returns (uuid, folder)."""
        folder = tmp_path / name
        folder.mkdir()
        for filename in files:
            (folder / filename).write_bytes(b"video " + filename.encode())
        client = TestClient(api.app)
        opened = client.post("/projects/from-folder", json={"folder_path": str(folder)}).json()
        project_uuid = opened["project"]["project_uuid"]
        self.store.set_exposure(project_uuid, str(folder), shown)
        return project_uuid, folder, opened["project_id"]

    def close(self):
        self.runtime.close_lease()
        api.projects.clear()


def body(response):
    try:
        return response.json()
    except json.JSONDecodeError:
        return response.text
