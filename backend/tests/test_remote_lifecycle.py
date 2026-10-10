"""The remote listener and fd-3 control channel, driven through packaging/entry.py."""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest

from src.remote.lifecycle import control_fd_from_env

BACKEND = Path(__file__).resolve().parents[1]
OWNER = "owner@example.test"
ORIGIN = "https://mac.tailnet.ts.net:8448"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Backend:
    """A real backend subprocess with the control pipe on an inherited fd."""

    def __init__(self, tmp_path, extra_env=None):
        self.tmp_path = tmp_path
        self.parent, child = socket.socketpair()
        env = dict(os.environ)
        env.update(
            {
                "PYTHONPATH": str(BACKEND),
                "CLIP_ASSEMBLER_PORT": str(free_port()),
                "CLIP_ASSEMBLER_CONTROL_FD": str(child.fileno()),
                "CLIP_ASSEMBLER_RUNTIME_FILE": str(tmp_path / "runtime.json"),
                "CLIP_ASSEMBLER_REMOTE_UI_DIR": str(tmp_path / "ui"),
                "PYTHONUNBUFFERED": "1",
            }
        )
        env.update(extra_env or {})
        (tmp_path / "ui").mkdir(exist_ok=True)
        (tmp_path / "ui" / "index.html").write_text("<title>remote</title>")
        self.proc = subprocess.Popen(
            [sys.executable, str(BACKEND / "packaging" / "entry.py")],
            cwd=tmp_path,
            env=env,
            pass_fds=(child.fileno(),),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        child.close()
        self._buffer = b""
        self._next_id = 1
        self.events = []
        self.parent.settimeout(30)
        ready = self.read_message()
        assert ready == {"event": "ready"}, ready

    # --- channel ------------------------------------------------------------

    def read_message(self, timeout=30):
        self.parent.settimeout(timeout)
        while b"\n" not in self._buffer:
            chunk = self.parent.recv(65536)
            if not chunk:
                raise EOFError("backend closed the control channel")
            self._buffer += chunk
        line, self._buffer = self._buffer.split(b"\n", 1)
        return json.loads(line)

    def send(self, message):
        self.parent.sendall((json.dumps(message) + "\n").encode())

    def call(self, type_, **fields):
        request_id = self._next_id
        self._next_id += 1
        self.send({"id": request_id, "type": type_, **fields})
        while True:
            message = self.read_message()
            if message.get("id") == request_id:
                return message
            self.events.append(message)

    def wait_event(self, name, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for index, event in enumerate(self.events):
                if event.get("event") == name:
                    return self.events.pop(index)
            self.events.append(self.read_message(timeout=max(0.1, deadline - time.monotonic())))
        raise AssertionError(f"no {name} event")

    def enable(self):
        reply = self.call("enable", owner_login=OWNER, public_origin=ORIGIN, mac_name="mac")
        assert reply["ok"], reply
        self.remote_port = reply["result"]["remote_port"]
        self.ingress = reply["result"]["ingress"]
        self.instance = reply["result"]["instance"]
        return reply["result"]

    def url(self, path, ingress=None):
        return f"http://127.0.0.1:{self.remote_port}/{ingress or self.ingress}{path}"

    def heartbeat_forever(self, interval=0.5):
        stop = threading.Event()

        def run():
            while not stop.is_set():
                try:
                    self.send({"type": "heartbeat"})
                except OSError:
                    return
                stop.wait(interval)

        threading.Thread(target=run, daemon=True).start()
        return stop

    def port_refused(self):
        try:
            with socket.create_connection(("127.0.0.1", self.remote_port), timeout=0.3):
                return False
        except OSError:
            return True

    def close(self):
        try:
            self.parent.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()


@pytest.fixture
def backend(tmp_path):
    instance = Backend(tmp_path)
    yield instance
    instance.close()


def phone_headers(extra=None):
    headers = {"Tailscale-User-Login": OWNER, "Origin": ORIGIN}
    headers.update(extra or {})
    return headers


def cookie_header(response, existing=None):
    jar = dict(existing or {})
    for cookie in response.headers.get_list("set-cookie"):
        name, _, rest = cookie.partition("=")
        value = rest.split(";", 1)[0]
        if value:
            jar[name] = value
        else:
            jar.pop(name, None)
    return jar


def as_header(jar):
    return {"Cookie": "; ".join(f"{k}={v}" for k, v in jar.items())} if jar else {}


# --- enable ----------------------------------------------------------------------


def test_enable_then_health_answers_through_the_ingress(backend):
    result = backend.enable()
    assert set(result) == {"remote_port", "ingress", "instance"}

    health = httpx.get(backend.url("/api/health"))
    assert health.status_code == 200
    assert health.json() == {"ok": True, "instance": result["instance"]}
    # The ingress is the capability: other paths on the port are bare 404s.
    assert httpx.get(f"http://127.0.0.1:{backend.remote_port}/api/health").status_code == 404
    state = backend.call("get_state")["result"]
    assert state["enabled"] is True and state["instance"] == result["instance"]
    assert backend.port_refused() is False


def test_remote_listener_is_off_until_enabled_and_state_says_so(backend):
    state = backend.call("get_state")["result"]
    assert state["enabled"] is False and state["devices"] == [] and state["pending"] == []
    refused = backend.call("new_pairing_code")
    assert refused["ok"] is False and "off" in refused["error"].lower()


def test_enable_rejects_bad_requests(backend):
    assert backend.call("enable", public_origin=ORIGIN)["ok"] is False
    assert backend.call("enable", owner_login=OWNER, public_origin="http://insecure")["ok"] is False
    assert backend.call("bogus")["ok"] is False
    assert backend.call("get_state")["ok"] is True  # channel survives bad input


# --- disable, EOF, lease ----------------------------------------------------------


def test_disable_makes_requests_503_at_once_and_refuses_the_port_within_a_second(backend):
    backend.enable()
    assert httpx.get(backend.url("/api/health")).status_code == 200
    # A long-lived request holder, to prove streams cannot keep the port open.
    keepalive = httpx.Client()
    assert keepalive.get(backend.url("/api/health")).status_code == 200

    sent_at = time.monotonic()
    backend.send({"id": 99, "type": "disable"})
    statuses = []
    refused_after = None
    while time.monotonic() - sent_at < 3:
        try:
            statuses.append(httpx.get(backend.url("/api/health"), timeout=1).status_code)
        except httpx.HTTPError:
            refused_after = time.monotonic() - sent_at
            break
    assert refused_after is not None, "port still accepting connections"
    assert refused_after < 1.0
    assert set(statuses) <= {503}, statuses  # never served once disable was sent
    assert backend.port_refused()

    reply = None
    while reply is None:
        message = backend.read_message()
        if message.get("id") == 99:
            reply = message
    assert reply["ok"] is True


def test_reenable_mints_a_new_ingress_and_the_old_one_is_404(backend):
    first = backend.enable()
    assert backend.call("disable")["ok"]
    second = backend.enable()

    assert second["ingress"] != first["ingress"]
    assert second["instance"] != first["instance"]
    assert httpx.get(backend.url("/api/health", ingress=first["ingress"])).status_code == 404
    assert httpx.get(backend.url("/api/health")).status_code == 200


def test_closing_the_control_pipe_disables_remote_view_within_16_seconds(backend):
    backend.enable()
    assert httpx.get(backend.url("/api/health")).status_code == 200
    closed_at = time.monotonic()
    backend.parent.close()

    while not backend.port_refused():
        assert time.monotonic() - closed_at < 16
        time.sleep(0.1)
    # The backend itself survives the loss of its parent (the desktop API stays up).
    assert backend.proc.poll() is None


def test_stopped_heartbeats_disable_remote_view_within_16_seconds(backend):
    backend.enable()
    beats = backend.heartbeat_forever(interval=1.0)
    time.sleep(4)
    assert httpx.get(backend.url("/api/health")).status_code == 200  # lease held by heartbeats
    beats.set()
    stopped_at = time.monotonic()

    while not backend.port_refused():
        assert time.monotonic() - stopped_at < 16
        time.sleep(0.25)
    assert time.monotonic() - stopped_at >= 10  # a 15 s lease is not cut short


def test_a_short_lease_is_kept_alive_by_heartbeats_and_lapses_without_them(tmp_path):
    backend = Backend(tmp_path, extra_env={"CLIP_ASSEMBLER_LEASE_TIMEOUT_SEC": "2"})
    try:
        backend.enable()
        beats = backend.heartbeat_forever(interval=0.4)
        time.sleep(4.5)
        assert httpx.get(backend.url("/api/health")).status_code == 200
        beats.set()
        deadline = time.monotonic() + 6
        while not backend.port_refused():
            assert time.monotonic() < deadline
            time.sleep(0.1)
        state = backend.call("get_state")["result"]
        assert state["enabled"] is False
    finally:
        backend.close()


# --- pairing and administration over the channel -----------------------------------


def test_pairing_approval_and_revocation_over_the_control_channel(backend, tmp_path):
    backend.enable()
    beats = backend.heartbeat_forever()
    try:
        code = backend.call("new_pairing_code")["result"]
        assert code["expires_at"] > time.time()

        pair = httpx.post(
            backend.url("/api/pair"),
            json={"token": code["token"], "label": "Elvijs iPhone"},
            headers=phone_headers({"User-Agent": "Mozilla/5.0 (iPhone) Safari/605.1"}),
        )
        assert pair.status_code == 202
        jar = cookie_header(pair)
        pending = backend.wait_event("pending_pairing")["pending"]
        assert [(p["label"], p["login"]) for p in pending] == [("Elvijs iPhone", OWNER)]

        assert backend.call("approve", pending_id=pending[0]["pending_id"])["ok"]
        poll = httpx.get(
            backend.url(f"/api/pair/{pair.json()['pending_id']}"),
            headers={**phone_headers(), **as_header(jar)},
        )
        assert poll.json()["state"] == "approved"
        jar = cookie_header(poll, jar)
        assert httpx.get(
            backend.url("/api/projects"), headers={**phone_headers(), **as_header(jar)}
        ).status_code == 200

        state = backend.call("get_state")["result"]
        assert [d["label"] for d in state["devices"]] == ["Elvijs iPhone"]
        assert state["connected"] == 1

        device_id = state["devices"][0]["device_id"]
        assert backend.call("revoke", device_id=device_id)["result"] == {"revoked": True}
        after = httpx.get(
            backend.url("/api/projects"), headers={**phone_headers(), **as_header(jar)}
        )
        assert (after.status_code, after.json()["reason"]) == (401, "revoked")
    finally:
        beats.set()


def test_revoke_all_and_deny(backend):
    backend.enable()
    beats = backend.heartbeat_forever()
    try:
        code = backend.call("new_pairing_code")["result"]
        pair = httpx.post(
            backend.url("/api/pair"), json={"token": code["token"]}, headers=phone_headers()
        )
        pending_id = pair.json()["pending_id"]
        assert backend.call("deny", pending_id=pending_id)["ok"]
        poll = httpx.get(
            backend.url(f"/api/pair/{pending_id}"),
            headers={**phone_headers(), **as_header(cookie_header(pair))},
        )
        assert poll.json()["state"] == "denied"
        assert backend.call("revoke_all")["result"] == {"revoked": 0}
    finally:
        beats.set()


def test_set_exposure_requires_a_project_folder_and_survives_disable(backend, tmp_path):
    plain = tmp_path / "not-a-project"
    plain.mkdir()
    refused = backend.call("set_exposure", folder_path=str(plain), shown=True)
    assert refused["ok"] is False

    from src.project_store import create_project

    project = tmp_path / "proj"
    project.mkdir()
    (project / "A.MP4").write_bytes(b"x")
    manifest = create_project(project)
    reply = backend.call("set_exposure", folder_path=str(project), shown=True)
    assert reply["result"] == {"project_uuid": manifest.project_uuid, "shown": True}

    state = backend.call("get_state")["result"]
    assert state["exposure"] == [
        {"project_uuid": manifest.project_uuid, "folder_path": str(project.resolve()), "shown": True}
    ]
    backend.enable()
    backend.call("disable")
    assert backend.call("get_state")["result"]["exposure"][0]["shown"] is True


def test_network_path_reaches_the_phone_through_me(backend):
    backend.enable()
    beats = backend.heartbeat_forever()
    try:
        assert backend.call("set_network_path", path="relayed")["ok"]
        code = backend.call("new_pairing_code")["result"]
        pair = httpx.post(backend.url("/api/pair"), json={"token": code["token"]}, headers=phone_headers())
        pending_id = pair.json()["pending_id"]
        backend.call("approve", pending_id=pending_id)
        jar = cookie_header(pair)
        poll = httpx.get(backend.url(f"/api/pair/{pending_id}"), headers={**phone_headers(), **as_header(jar)})
        jar = cookie_header(poll, jar)
        me = httpx.get(backend.url("/api/me"), headers={**phone_headers(), **as_header(jar)})
        assert me.json()["network_path"] == "relayed"
    finally:
        beats.set()


# --- without a control channel ------------------------------------------------------


def test_without_the_control_fd_there_is_no_way_to_enable(monkeypatch):
    monkeypatch.delenv("CLIP_ASSEMBLER_CONTROL_FD", raising=False)
    assert control_fd_from_env() is None
    monkeypatch.setenv("CLIP_ASSEMBLER_CONTROL_FD", "not-a-number")
    assert control_fd_from_env() is None
    monkeypatch.setenv("CLIP_ASSEMBLER_CONTROL_FD", "3")
    assert control_fd_from_env() == 3
