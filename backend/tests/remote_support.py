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
    def __init__(self, tmp_path, ui_dir=None, clock=None, uploads=None):
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
            events=api.project_events,
        )
        if uploads is not None:
            self.runtime.uploads = uploads
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


def tus_metadata(filename="IMG_1234.MOV", filetype="video/quicktime", last_modified=None):
    import base64

    def enc(value):
        return base64.b64encode(value.encode()).decode()

    parts = [f"filename {enc(filename)}"]
    if filetype:
        parts.append(f"filetype {enc(filetype)}")
    if last_modified is not None:
        parts.append(f"lastModified {enc(str(last_modified))}")
    return ",".join(parts)


def chunk_checksum(data, algorithm="sha256"):
    import base64
    import hashlib

    return f"{algorithm} " + base64.b64encode(getattr(hashlib, algorithm)(data).digest()).decode()


TUS = {"Tus-Resumable": "1.0.0"}


class Tus:
    """The tus calls a phone makes, against one Project."""

    def __init__(self, phone, project_uuid):
        self.phone = phone
        self.base = f"/api/projects/{project_uuid}"

    def create(self, length, filename="IMG_1234.MOV", key="key-00000001", **meta):
        return self.phone.post(
            f"{self.base}/uploads",
            extra={
                **TUS,
                "Upload-Length": str(length),
                "Upload-Metadata": tus_metadata(filename, **meta),
                "Idempotency-Key": key,
            },
        )

    def upload_id(self, response):
        assert response.status_code == 201, response.text
        return response.headers["location"].rsplit("/", 1)[1]

    def head(self, upload_id):
        return self.phone.request("HEAD", f"{self.base}/uploads/{upload_id}", extra=TUS)

    def patch(self, upload_id, offset, data, checksum=None, content_type="application/offset+octet-stream"):
        return self.phone.request(
            "PATCH",
            f"{self.base}/uploads/{upload_id}",
            content=data,
            extra={
                **TUS,
                "Upload-Offset": str(offset),
                "Content-Type": content_type,
                "Upload-Checksum": checksum or chunk_checksum(data),
            },
        )

    def delete(self, upload_id):
        return self.phone.request("DELETE", f"{self.base}/uploads/{upload_id}", extra=TUS)

    def status(self, upload_id, chunks=False):
        suffix = "?chunks=true" if chunks else ""
        return self.phone.get(f"{self.base}/upload-status/{upload_id}{suffix}")


class LiveServer:
    """The remote ASGI app on a real loopback socket (the TestClient cannot stream SSE)."""

    def __init__(self, asgi_app):
        import asyncio
        import contextlib
        import threading

        import uvicorn

        class Server(uvicorn.Server):
            @contextlib.contextmanager
            def capture_signals(self):
                yield

        self.loop = asyncio.new_event_loop()
        self.server = Server(
            uvicorn.Config(asgi_app, host="127.0.0.1", port=0, lifespan="off", log_level="warning")
        )
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        import time

        deadline = time.monotonic() + 10
        while not self.server.started:
            assert time.monotonic() < deadline, "server did not start"
            time.sleep(0.01)
        self.port = self.server.servers[0].sockets[0].getsockname()[1]

    def _run(self):
        import asyncio

        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self.server.serve())

    def stop(self):
        self.server.should_exit = True
        self.server.force_exit = True
        self._thread.join(timeout=5)


class SSEClient:
    """Reads one event stream on a thread so tests can wait with timeouts."""

    def __init__(self, url, headers):
        import queue
        import threading

        import httpx

        self.events = queue.Queue()
        self.status = None
        self.closed = threading.Event()
        self._stop = threading.Event()

        def run():
            try:
                with httpx.stream("GET", url, headers=headers, timeout=None) as response:
                    self.status = response.status_code
                    if response.status_code != 200:
                        self.events.put(("error", response.read().decode()))
                        return
                    name, data = "message", []
                    for line in response.iter_lines():
                        if self._stop.is_set():
                            return
                        if line.startswith(":"):
                            self.events.put(("comment", line[1:].strip()))
                        elif line.startswith("event:"):
                            name = line[6:].strip()
                        elif line.startswith("data:"):
                            data.append(line[5:].strip())
                        elif line == "":
                            if data or name != "message":
                                import json as _json

                                payload = _json.loads(data[0]) if data else None
                                self.events.put((name, payload))
                            name, data = "message", []
            except Exception as exc:  # connection torn down by the server
                self.events.put(("closed", repr(exc)))
            finally:
                self.closed.set()

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def next(self, timeout=5):
        import queue

        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            raise AssertionError("no event within %.1fs" % timeout) from None

    def next_matching(self, name, timeout=5):
        import time

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            event = self.next(max(0.05, deadline - time.monotonic()))
            if event[0] == name:
                return event[1]
        raise AssertionError(f"no {name!r} event")

    def expect_quiet(self, seconds=0.4, ignore=("comment",)):
        import queue
        import time

        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                event = self.events.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                return
            assert event[0] in ignore, event

    def stop(self):
        self._stop.set()


def live_headers(phone):
    """Headers a real browser would send: cookies from the phone's jar, identity, CSRF."""
    cookies = "; ".join(f"{name}={value}" for name, value in phone.client.cookies.items())
    return phone.headers(extra={"Cookie": cookies})
