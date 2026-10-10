"""The control channel and the remote listener's lifecycle (architecture §10).

Electron main spawns the backend with an extra pipe (``CLIP_ASSEMBLER_CONTROL_FD``)
carrying newline-delimited JSON in both directions. Remote administration never
goes over the unauthenticated desktop HTTP API.

main -> backend (requests carry an ``id``; the reply echoes it)::

    {"id": 1, "type": "enable", "owner_login": ..., "public_origin": ..., "mac_name": ...}
    {"type": "heartbeat"}                       every 5 s; the lease lapses after 15 s
    {"id": 2, "type": "disable"}
    {"id": 3, "type": "new_pairing_code"}       -> {token, expires_at}
    {"id": 4, "type": "approve", "pending_id": ...}   / deny
    {"id": 5, "type": "revoke", "device_id": ...}     / revoke_all
    {"id": 6, "type": "set_exposure", "folder_path": ..., "shown": true}
    {"id": 7, "type": "set_network_path", "path": "direct"}
    {"id": 8, "type": "get_state"}

backend -> main::

    {"id": n, "ok": true, "result": {...}} or {"id": n, "ok": false, "error": "..."}
    {"event": "ready" | "pending_pairing" | "sessions_changed" | "state", ...}

Disable, lease expiry and EOF all do the same, in order: close the gate (every
request is 503 from then on), end SSE and media streams, stop transfers at their
next chunk boundary, drop sessions, stop the listener.
"""

import asyncio
import contextlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Callable, Dict, Optional

from ..project_store import ProjectStoreError, open_project
from .app import create_remote_app
from .auth import PairingError
from .runtime import RemoteRuntime

HEARTBEAT_LEASE_SEC = 15.0
LISTENER_STOP_TIMEOUT_SEC = 1.0
SWEEP_INTERVAL_SEC = 600.0


class ControlError(Exception):
    """A request main should be told about, with a plain message."""


class ControlChannel:
    """Line-delimited JSON over one inherited, bidirectional file descriptor."""

    def __init__(self, fd: int) -> None:
        self._fd = fd
        self._buffer = b""
        self._write_lock = threading.Lock()
        self._closed = False

    def read_message(self) -> Optional[dict]:
        """Next JSON object, or ``None`` at EOF. Malformed lines are skipped."""
        while True:
            newline = self._buffer.find(b"\n")
            if newline >= 0:
                line, self._buffer = self._buffer[:newline], self._buffer[newline + 1 :]
                if not line.strip():
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if isinstance(message, dict):
                    return message
                continue
            try:
                chunk = os.read(self._fd, 65536)
            except OSError:
                return None
            if not chunk:
                return None
            self._buffer += chunk

    def send(self, message: dict) -> None:
        data = (json.dumps(message, default=str) + "\n").encode("utf-8")
        with self._write_lock:
            if self._closed:
                return
            try:
                view = memoryview(data)
                while view:
                    written = os.write(self._fd, view)
                    view = view[written:]
            except OSError:
                self._closed = True  # main is gone; EOF handling disables remote


class _RemoteServer:
    """One uvicorn server for the remote app, run inside the backend's event loop."""

    def __init__(self, asgi_app, loop: asyncio.AbstractEventLoop) -> None:
        import uvicorn

        class Server(uvicorn.Server):
            @contextlib.contextmanager
            def capture_signals(self):  # the desktop server owns the signals
                yield

        config = uvicorn.Config(
            asgi_app,
            host="127.0.0.1",
            port=0,
            log_level="warning",
            lifespan="off",
            access_log=False,
            timeout_graceful_shutdown=1,
            server_header=False,
        )
        self._server = Server(config)
        self._loop = loop
        self._task: Optional["asyncio.Future"] = None
        self.port: Optional[int] = None

    def start(self, timeout: float = 10.0) -> int:
        future = asyncio.run_coroutine_threadsafe(self._start(), self._loop)
        return future.result(timeout)

    async def _start(self) -> int:
        self._task = asyncio.ensure_future(self._server.serve())
        deadline = time.monotonic() + 10
        while not self._server.started:
            if self._task.done():
                self._task.result()
                raise ControlError("The remote listener could not start")
            if time.monotonic() > deadline:
                raise ControlError("The remote listener did not start in time")
            await asyncio.sleep(0.01)
        sockets = self._server.servers[0].sockets
        self.port = sockets[0].getsockname()[1]
        return self.port

    def stop(self, timeout: float = LISTENER_STOP_TIMEOUT_SEC) -> None:
        if self._task is None:
            return

        async def _stop() -> None:
            self._server.should_exit = True
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout)
            except asyncio.TimeoutError:
                self._server.force_exit = True
                try:
                    await asyncio.wait_for(asyncio.shield(self._task), timeout)
                except (asyncio.TimeoutError, Exception):
                    self._task.cancel()
            except Exception:
                pass

        try:
            asyncio.run_coroutine_threadsafe(_stop(), self._loop).result(timeout * 3 + 1)
        except Exception:
            pass
        self._task = None


class RemoteLifecycle:
    def __init__(
        self,
        *,
        channel: ControlChannel,
        runtime: RemoteRuntime,
        loop: asyncio.AbstractEventLoop,
        lease_timeout_sec: float = HEARTBEAT_LEASE_SEC,
        monotonic: Callable[[], float] = time.monotonic,
        server_factory: Optional[Callable[[object, asyncio.AbstractEventLoop], object]] = None,
    ) -> None:
        self.channel = channel
        self.runtime = runtime
        self.loop = loop
        self.lease_timeout_sec = lease_timeout_sec
        self._monotonic = monotonic
        self._server_factory = server_factory or (lambda app, lp: _RemoteServer(app, lp))
        self._server: Optional[_RemoteServer] = None
        self._lock = threading.RLock()
        self._last_heartbeat = 0.0
        self._stop = threading.Event()
        self._enabled = False
        self.runtime.auth.add_listener(self._on_auth_event)

    # --- lifecycle of the threads --------------------------------------------

    def start(self) -> None:
        threading.Thread(target=self._watchdog, name="remote-lease", daemon=True).start()
        self.channel.send({"event": "ready"})
        threading.Thread(target=self._read_loop, name="remote-control", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self.disable("shutdown")

    def _read_loop(self) -> None:
        while not self._stop.is_set():
            message = self.channel.read_message()
            if message is None:
                self.disable("control-eof")
                return
            try:
                self._dispatch(message)
            except Exception as exc:  # never let one bad message end the channel
                self._reply(message, error=f"{type(exc).__name__}: {exc}")

    def _watchdog(self) -> None:
        interval = min(0.5, max(0.05, self.lease_timeout_sec / 10))
        last_sweep = self._monotonic()
        while not self._stop.wait(interval):
            if self.runtime.uploads is not None and self._monotonic() - last_sweep > SWEEP_INTERVAL_SEC:
                last_sweep = self._monotonic()
                self.runtime.uploads.sweep_all()
            with self._lock:
                expired = (
                    self._enabled
                    and self._monotonic() - self._last_heartbeat > self.lease_timeout_sec
                )
            if expired:
                self.disable("lease-expired")

    # --- dispatch ------------------------------------------------------------

    def _reply(self, request: dict, result: Optional[dict] = None, error: Optional[str] = None) -> None:
        if "id" not in request:
            return
        if error is not None:
            self.channel.send({"id": request["id"], "ok": False, "error": error})
        else:
            self.channel.send({"id": request["id"], "ok": True, "result": result or {}})

    def _dispatch(self, message: dict) -> None:
        kind = message.get("type")
        handlers: Dict[str, Callable[[dict], Optional[dict]]] = {
            "enable": self._enable,
            "disable": lambda m: self.disable("disable") or {},
            "heartbeat": self._heartbeat,
            "new_pairing_code": self._new_pairing_code,
            "approve": self._approve,
            "deny": self._deny,
            "revoke": self._revoke,
            "revoke_all": self._revoke_all,
            "set_exposure": self._set_exposure,
            "set_network_path": self._set_network_path,
            "get_state": lambda m: self.state(),
        }
        handler = handlers.get(kind) if isinstance(kind, str) else None
        if handler is None:
            self._reply(message, error=f"unknown message type: {kind}")
            return
        try:
            result = handler(message)
        except (ControlError, PairingError, ProjectStoreError, OSError) as exc:
            self._reply(message, error=str(exc))
            return
        if kind == "heartbeat" and "id" not in message:
            return
        self._reply(message, result=result)

    # --- handlers ------------------------------------------------------------

    def _heartbeat(self, message: dict) -> dict:
        with self._lock:
            self._last_heartbeat = self._monotonic()
        return {}

    def _enable(self, message: dict) -> dict:
        owner = message.get("owner_login")
        origin = message.get("public_origin")
        mac_name = message.get("mac_name")
        if not (isinstance(owner, str) and owner and isinstance(origin, str)):
            raise ControlError("enable needs owner_login and public_origin")
        if not origin.startswith("https://"):
            raise ControlError("public_origin must be an https origin")
        with self._lock:
            if self._enabled:
                self.disable("re-enable")
            server = self._server_factory(create_remote_app(self.runtime), self.loop)
            try:
                port = server.start()
            except ControlError:
                raise
            except Exception as exc:
                raise ControlError(f"The remote listener could not start: {exc}") from exc
            self._server = server
            opened = self.runtime.open_lease(
                owner, origin, mac_name if isinstance(mac_name, str) else ""
            )
            self._last_heartbeat = self._monotonic()
            self._enabled = True
        self.channel.send({"event": "state", **self.state()})
        return {"remote_port": port, **opened}

    def disable(self, reason: str = "disable") -> None:
        """Close the gate first, then everything behind it (§10)."""
        with self._lock:
            server, self._server = self._server, None
            was_enabled, self._enabled = self._enabled, False
            self.runtime.close_lease("remote-off")
            if server is not None:
                server.stop()
        if was_enabled:
            self.channel.send({"event": "state", **self.state(), "reason": reason})

    def _new_pairing_code(self, message: dict) -> dict:
        if not self.runtime.is_open:
            raise ControlError("Remote View is off")
        code = self.runtime.auth.new_pairing_code()
        return {"token": code.token, "expires_at": code.expires_at}

    def _approve(self, message: dict) -> dict:
        device = self.runtime.auth.approve(str(message.get("pending_id", "")))
        return {"device_id": device.device_id}

    def _deny(self, message: dict) -> dict:
        self.runtime.auth.deny(str(message.get("pending_id", "")))
        return {}

    def _revoke(self, message: dict) -> dict:
        return {"revoked": self.runtime.auth.revoke(str(message.get("device_id", "")))}

    def _revoke_all(self, message: dict) -> dict:
        return {"revoked": len(self.runtime.auth.revoke_all())}

    def _set_exposure(self, message: dict) -> dict:
        folder = message.get("folder_path")
        shown = message.get("shown")
        if not isinstance(folder, str) or not isinstance(shown, bool):
            raise ControlError("set_exposure needs folder_path and shown")
        resolved = Path(folder).expanduser().resolve()
        manifest = open_project(resolved)  # refused unless the folder is a Project
        self.runtime.store.set_exposure(manifest.project_uuid, str(resolved), shown)
        self.runtime.store.audit(
            "exposure_changed", project=manifest.project_uuid[:8], shown=shown
        )
        return {"project_uuid": manifest.project_uuid, "shown": shown}

    def _set_network_path(self, message: dict) -> dict:
        path = message.get("path")
        self.runtime.network_path = path if path in ("direct", "relayed") else "unknown"
        return {}

    # --- state and events ----------------------------------------------------

    def state(self) -> dict:
        auth = self.runtime.auth
        exposure = []
        for project_uuid, entry in self.runtime.store.exposure.items():
            exposure.append(
                {"project_uuid": project_uuid, "folder_path": entry.folder_path, "shown": entry.shown}
            )
        return {
            "enabled": self.runtime.is_open,
            "instance": self.runtime.instance if self.runtime.is_open else None,
            "owner_login": self.runtime.owner_login,
            "pending": auth.list_pending(),
            "devices": auth.list_devices(),
            "connected": auth.connected_count(),
            "exposure": exposure,
            "network_path": self.runtime.network_path,
        }

    def _on_auth_event(self, event: str, payload: dict) -> None:
        if event == "pending_pairing":
            self.channel.send({"event": "pending_pairing", "pending": self.runtime.auth.list_pending()})
        elif event == "sessions_changed":
            self.channel.send(
                {
                    "event": "sessions_changed",
                    "devices": self.runtime.auth.list_devices(),
                    "connected": self.runtime.auth.connected_count(),
                }
            )


def control_fd_from_env() -> Optional[int]:
    raw = os.environ.get("CLIP_ASSEMBLER_CONTROL_FD")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def build_lifecycle(loop: asyncio.AbstractEventLoop, fd: int) -> RemoteLifecycle:
    """Wire the lifecycle to the running backend's Projects (imports the app lazily)."""
    from .. import api
    from .auth import RemoteAuth
    from .store import RemoteStore

    store = RemoteStore()
    auth = RemoteAuth(store)
    ui_dir = os.environ.get("CLIP_ASSEMBLER_REMOTE_UI_DIR")
    runtime = RemoteRuntime(
        store=store,
        auth=auth,
        project_service=api.project_service,
        projects=api.projects,
        ui_dir=Path(ui_dir) if ui_dir else None,
        events=api.project_events,
    )
    runtime.uploads = api.upload_service
    try:
        timeout = float(os.environ.get("CLIP_ASSEMBLER_LEASE_TIMEOUT_SEC", HEARTBEAT_LEASE_SEC))
    except ValueError:
        timeout = HEARTBEAT_LEASE_SEC
    return RemoteLifecycle(
        channel=ControlChannel(fd), runtime=runtime, loop=loop, lease_timeout_sec=timeout
    )
