"""Shared state of the running remote listener (the "lease").

The lease is the single switch every remote request checks first. It opens when
Electron main sends ``enable`` over the control channel and closes on
``disable``, on a lapsed heartbeat or on EOF of the control pipe; closing it
fails every request with 503 at once, before anything else is torn down.
"""

import asyncio
import secrets
import threading
from pathlib import Path
from typing import Callable, Dict, List, MutableMapping, Optional

from ..project_service import ProjectService
from .auth import RemoteAuth
from .store import RemoteStore

PUBLIC_PREFIX = "/remote"


class StreamHandle:
    """A live streaming response (SSE, media, upload body) bound to a device.

    ``close`` is safe to call from any thread; the stream's own task awaits
    ``closed`` (or polls ``is_closed``) and finishes at its next boundary.
    """

    def __init__(self, device_id: str, loop: Optional[asyncio.AbstractEventLoop]) -> None:
        self.device_id = device_id
        self.reason: Optional[str] = None
        self._loop = loop
        self._event = asyncio.Event() if loop is not None else None
        self._flag = threading.Event()

    @property
    def is_closed(self) -> bool:
        return self._flag.is_set()

    async def wait(self) -> None:
        if self._event is not None:
            await self._event.wait()

    def close(self, reason: str) -> None:
        if self._flag.is_set():
            return
        self.reason = reason
        self._flag.set()
        if self._loop is not None and self._event is not None:
            try:
                self._loop.call_soon_threadsafe(self._event.set)
            except RuntimeError:  # loop already closed
                pass


class RemoteRuntime:
    def __init__(
        self,
        *,
        store: RemoteStore,
        auth: RemoteAuth,
        project_service: ProjectService,
        projects: MutableMapping[str, dict],
        ui_dir: Optional[Path] = None,
    ) -> None:
        self.store = store
        self.auth = auth
        self.project_service = project_service
        self.projects = projects
        self.ui_dir = Path(ui_dir) if ui_dir else None
        self._lease = threading.Event()
        self._lock = threading.RLock()
        self._streams: List[StreamHandle] = []
        self._close_hooks: List[Callable[[], None]] = []
        self.ingress: Optional[str] = None
        self.instance: Optional[str] = None
        self.owner_login: Optional[str] = None
        self.public_origin: Optional[str] = None
        self.mac_name: str = ""
        self.network_path: str = "unknown"
        auth.add_listener(self._on_auth_event)

    # --- lease --------------------------------------------------------------

    @property
    def is_open(self) -> bool:
        return self._lease.is_set()

    def open_lease(self, owner_login: str, public_origin: str, mac_name: str) -> Dict[str, str]:
        """Open the gate with a fresh ingress capability and instance ID."""
        with self._lock:
            self.owner_login = owner_login
            self.public_origin = public_origin.rstrip("/")
            self.mac_name = mac_name
            self.auth.set_owner(owner_login)
            self.ingress = secrets.token_urlsafe(32)
            self.instance = secrets.token_hex(8)
            self._lease.set()
            self.store.audit("remote_enabled", owner=owner_login)
            return {"ingress": self.ingress, "instance": self.instance}

    def close_lease(self, reason: str = "remote-off") -> None:
        """Close the gate first, then end streams and drop sessions (§10)."""
        with self._lock:
            was_open = self._lease.is_set()
            self._lease.clear()
            self.close_streams(reason)
            self.auth.drop_all_sessions()
            hooks = list(self._close_hooks)
        for hook in hooks:
            try:
                hook()
            except Exception:
                pass
        if was_open:
            self.store.audit("remote_disabled", reason=reason)

    def add_close_hook(self, hook: Callable[[], None]) -> None:
        self._close_hooks.append(hook)

    # --- streams ------------------------------------------------------------

    def register_stream(self, device_id: str) -> StreamHandle:
        try:
            loop: Optional[asyncio.AbstractEventLoop] = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        handle = StreamHandle(device_id, loop)
        with self._lock:
            if not self.is_open:
                handle.close("remote-off")
            self._streams.append(handle)
        return handle

    def unregister_stream(self, handle: StreamHandle) -> None:
        with self._lock:
            if handle in self._streams:
                self._streams.remove(handle)

    def close_streams(self, reason: str, device_id: Optional[str] = None) -> None:
        with self._lock:
            targets = [h for h in self._streams if device_id is None or h.device_id == device_id]
        for handle in targets:
            handle.close(reason)

    def _on_auth_event(self, event: str, payload: dict) -> None:
        if event == "device_ended":
            self.close_streams(payload.get("reason", "revoked"), payload.get("device_id"))

    # --- exposure -----------------------------------------------------------

    def public_url(self, path: str) -> str:
        """A public path for redirects, tus ``Location`` and SSE URLs.

        Always the mount prefix Serve exposes, never the per-enable ingress.
        """
        return PUBLIC_PREFIX + (path if path.startswith("/") else "/" + path)
