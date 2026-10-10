"""The remote ASGI application: an ordered gate in front of an explicit allow-list.

Nothing here forwards to the desktop API, MCP or settings; those routes simply do
not exist on this app. Every request passes the gate in this order:

1. the remote lease is open, else ``503 {"reason": "remote_off"}``
2. the path starts with the current per-enable ingress segment, else a bare 404
3. exactly one ``Tailscale-User-Login`` equal to the owner, and no Funnel marker
4. a valid session cookie (or device cookie on the few device-tier routes)
5. for mutations: the exact ``Origin`` and the CSRF token
6. the Project is shown on the phone
7. the resource belongs to the caller

Steps 1-3 are the ``RemoteGate`` middleware; 4-7 are route dependencies.
``GET /api/health`` stops after step 2 and reveals only an instance ID.
"""

import hmac
from email.header import decode_header, make_header
from pathlib import Path
from typing import Annotated, Awaitable, Callable, List, Optional

from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from ..models import (
    RemoteHealth,
    RemoteMe,
    RemotePairPoll,
    RemotePairRequest,
    RemotePairStarted,
    RemoteProjectDetail,
    RemoteProjectList,
    RemoteSessionRenewed,
)
from ..project_store import ProjectStoreError, open_project, read_analysis_results
from .auth import (
    DEVICE_ABSOLUTE_TTL,
    DEVICE_COOKIE,
    PAIRING_COOKIE,
    PAIRING_TOKEN_TTL,
    SESSION_COOKIE,
    PairingError,
)
from .runtime import RemoteRuntime
from .store import DeviceRecord
from . import summary

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
JSON_BODY_LIMIT = 64 * 1024
UPLOAD_PATCH_LIMIT = 9 * 1024 * 1024  # 8 MiB ceiling plus framing slack

CSP = (
    "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; "
    "media-src 'self' blob:; frame-ancestors 'none'"
)

Scope = dict
Receive = Callable[[], Awaitable[dict]]
Send = Callable[[dict], Awaitable[None]]


class RemoteHTTPError(Exception):
    def __init__(
        self,
        status: int,
        reason: str,
        message: Optional[str] = None,
        headers: Optional[dict] = None,
    ) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.message = message
        self.headers = headers or {}


class BodyTooLarge(Exception):
    pass


def decode_login(raw: bytes) -> Optional[str]:
    """Header value to text, decoding RFC 2047 encoded words when present."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    if "=?" in text:
        try:
            text = str(make_header(decode_header(text)))
        except Exception:
            return None
    return text


def _json_response(status: int, body: dict, headers: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers=headers)


class RemoteGate:
    """Pure-ASGI steps 1-3, so streaming bodies and SSE are never buffered."""

    def __init__(self, app: Callable, runtime: RemoteRuntime) -> None:
        self.app = app
        self.runtime = runtime

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if scope["type"] != "http":
            return  # no WebSockets on the remote listener
        runtime = self.runtime

        # 1. lease
        if not runtime.is_open:
            await self._respond(scope, receive, send, 503, {"reason": "remote_off"}, "")
            return

        # 2. ingress capability
        ingress = runtime.ingress or ""
        path: str = scope["path"]
        first = path.split("/", 2)[1] if path.startswith("/") else ""
        if not ingress or not hmac.compare_digest(first.encode(), ingress.encode()):
            await self._bare_404(send)
            return
        inner_path = path[len(ingress) + 1 :] or "/"
        inner = dict(scope)
        inner["path"] = inner_path
        raw_path = scope.get("raw_path")
        if raw_path:
            inner["raw_path"] = raw_path[len(ingress) + 1 :] or b"/"
        method = scope["method"]

        # 3. identity (health is the one unauthenticated probe)
        is_health = inner_path == "/api/health"
        if not is_health:
            login = self._identity(scope)
            if login is None or login != runtime.owner_login:
                await self._respond(scope, receive, send, 403, {"reason": "identity"}, inner_path)
                return
            inner.setdefault("state", {})["login"] = login

        # bounded bodies, before any route reads them
        limit = (
            UPLOAD_PATCH_LIMIT
            if method == "PATCH" and "/uploads/" in inner_path
            else JSON_BODY_LIMIT
        )
        declared = self._header(scope, b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._respond(scope, receive, send, 413, {"reason": "too_large"}, inner_path)
            return

        received = 0

        async def limited_receive() -> dict:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise BodyTooLarge()
            return message

        started = False

        async def guarded_send(message: dict) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message = dict(message)
                message["headers"] = self._with_security_headers(
                    message.get("headers", []), inner_path
                )
            await send(message)

        try:
            await self.app(inner, limited_receive, guarded_send)
        except BodyTooLarge:
            if not started:
                await self._respond(scope, receive, send, 413, {"reason": "too_large"}, inner_path)

    # --- helpers ------------------------------------------------------------

    @staticmethod
    def _header(scope: Scope, name: bytes) -> Optional[str]:
        for key, value in scope.get("headers", []):
            if key == name:
                return value.decode("latin-1")
        return None

    @staticmethod
    def _identity(scope: Scope) -> Optional[str]:
        logins = []
        for key, value in scope.get("headers", []):
            if key == b"tailscale-funnel-request":
                return None
            if key == b"tailscale-user-login":
                logins.append(value)
        if len(logins) != 1:
            return None
        return decode_login(logins[0])

    @staticmethod
    def _with_security_headers(headers: List[tuple], inner_path: str) -> List[tuple]:
        drop = {b"content-security-policy", b"referrer-policy", b"x-content-type-options"}
        api = inner_path.startswith("/api/")
        if api:
            drop.add(b"cache-control")
        kept = [(k, v) for k, v in headers if k.lower() not in drop]
        kept += [
            (b"content-security-policy", CSP.encode()),
            (b"referrer-policy", b"no-referrer"),
            (b"x-content-type-options", b"nosniff"),
        ]
        if api:
            kept.append((b"cache-control", b"private, no-store"))
        return kept

    async def _bare_404(self, send: Send) -> None:
        await send(
            {"type": "http.response.start", "status": 404, "headers": [(b"content-length", b"0")]}
        )
        await send({"type": "http.response.body", "body": b""})

    async def _respond(
        self, scope: Scope, receive: Receive, send: Send, status: int, body: dict, inner_path: str
    ) -> None:
        response = _json_response(status, body)
        raw = list(response.raw_headers)
        wrapped = self._with_security_headers(raw, inner_path or "/api/")

        async def guarded(message: dict) -> None:
            if message["type"] == "http.response.start":
                message = dict(message)
                message["headers"] = wrapped
            await send(message)

        await response(scope, receive, guarded)


# --- request-scoped helpers ---------------------------------------------------


def runtime_of(request: Request) -> RemoteRuntime:
    return request.app.state.runtime


def parse_cookies(request: Request) -> dict:
    return dict(request.cookies)


class Authed:
    def __init__(
        self, device: DeviceRecord, login: str, session_cookie: Optional[str], has_session: bool
    ) -> None:
        self.device = device
        self.login = login
        self.session_cookie = session_cookie
        self.has_session = has_session


def _check_mutation(request: Request, runtime: RemoteRuntime, device: Optional[DeviceRecord]) -> None:
    """Step 5: exact Origin, then the device-bound CSRF token."""
    if request.method in SAFE_METHODS:
        return
    _check_origin(request, runtime)
    if not runtime.auth.check_csrf(device, request.headers.get("x-csrf-token")):
        raise RemoteHTTPError(403, "csrf", "Missing or wrong CSRF token")


def _check_origin(request: Request, runtime: RemoteRuntime) -> None:
    origin = request.headers.get("origin")
    if origin is None or origin == "null" or origin != runtime.public_origin:
        raise RemoteHTTPError(403, "origin", "Request did not come from this app")


def _auth_error(reason: Optional[str]) -> RemoteHTTPError:
    return RemoteHTTPError(401, reason or "never_paired")


async def require_origin(request: Request) -> None:
    """Pairing is the one mutation that has no session yet: Origin only."""
    _check_origin(request, runtime_of(request))


async def require_session(request: Request) -> Authed:
    runtime = runtime_of(request)
    cookies = parse_cookies(request)
    result = runtime.auth.authenticate(cookies.get(SESSION_COOKIE), cookies.get(DEVICE_COOKIE))
    if not result.ok:
        raise _auth_error(result.reason)
    _check_mutation(request, runtime, result.device)
    return Authed(result.device, request.state.login, cookies.get(SESSION_COOKIE), True)


async def require_device(request: Request) -> Authed:
    """Device-tier routes also accept a valid device cookie with no live session."""
    runtime = runtime_of(request)
    cookies = parse_cookies(request)
    result = runtime.auth.authenticate(cookies.get(SESSION_COOKIE), cookies.get(DEVICE_COOKIE))
    if not result.ok and not result.device_valid:
        raise _auth_error(result.reason)
    _check_mutation(request, runtime, result.device)
    return Authed(result.device, request.state.login, cookies.get(SESSION_COOKIE), result.ok)


def exposed_entry(runtime: RemoteRuntime, project_id: str):
    """Step 6: a Project the Editor did not show is indistinguishable from a missing one."""
    entry = runtime.store.exposed(project_id)
    if entry is None:
        raise RemoteHTTPError(404, "not_found")
    return entry


def open_exposed_project(runtime: RemoteRuntime, project_id: str) -> tuple:
    """``(runtime_project_id, project_dict)``, opening the Project on demand."""
    entry = exposed_entry(runtime, project_id)
    try:
        runtime_id = runtime.project_service.open_for_remote(project_id, Path(entry.folder_path))
    except ProjectStoreError as exc:
        runtime.store.audit("project_open_failed", project=project_id[:8], error=type(exc).__name__)
        raise RemoteHTTPError(404, "not_found") from exc
    except OSError as exc:
        raise RemoteHTTPError(404, "not_found") from exc
    return runtime_id, runtime.projects[runtime_id]


def summarize_user_agent(user_agent: str) -> str:
    device = "Phone"
    for marker, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android")):
        if marker in user_agent:
            device = name
            break
    browser = "browser"
    if "CriOS" in user_agent:
        browser = "Chrome"
    elif "FxiOS" in user_agent:
        browser = "Firefox"
    elif "Safari" in user_agent:
        browser = "Safari"
    return f"{device} · {browser}"


def _set_cookie(response: Response, name: str, value: str, max_age: Optional[int] = None) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", secure=True, httponly=True, samesite="strict"
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.set_cookie(
        name, "", max_age=0, path="/", secure=True, httponly=True, samesite="strict"
    )


def _pairing_http_error(exc: PairingError) -> RemoteHTTPError:
    status = {"invalid": 410, "expired": 410, "used": 409, "rate_limited": 429, "busy": 429}.get(
        exc.code, 400
    )
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return RemoteHTTPError(status, exc.code, str(exc), headers=headers)


# --- app factory ----------------------------------------------------------------


def build_remote_api(runtime: RemoteRuntime) -> FastAPI:
    app = FastAPI(
        title="AI Clip Assembler Remote View",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        redirect_slashes=False,
    )
    app.state.runtime = runtime

    @app.exception_handler(RemoteHTTPError)
    async def remote_error(_request: Request, exc: RemoteHTTPError) -> JSONResponse:
        body: dict = {"reason": exc.reason}
        if exc.message:
            body["message"] = exc.message
        return JSONResponse(body, status_code=exc.status, headers=exc.headers)

    # --- health -------------------------------------------------------------

    @app.get("/api/health", response_model=RemoteHealth)
    async def health(request: Request) -> RemoteHealth:
        return RemoteHealth(instance=runtime_of(request).instance or "")

    # --- pairing ------------------------------------------------------------

    @app.post("/api/pair", response_model=RemotePairStarted, status_code=202)
    async def pair(
        body: RemotePairRequest,
        request: Request,
        _origin: Annotated[None, Depends(require_origin)],
    ):
        rt = runtime_of(request)
        user_agent = summarize_user_agent(request.headers.get("user-agent", ""))
        try:
            pending_id, poll_secret = rt.auth.begin_pairing(
                request.state.login, body.token, body.label or user_agent.split(" · ")[0], user_agent
            )
        except PairingError as exc:
            raise _pairing_http_error(exc) from exc
        response = JSONResponse(
            RemotePairStarted(pending_id=pending_id).model_dump(), status_code=202
        )
        _set_cookie(response, PAIRING_COOKIE, poll_secret, max_age=PAIRING_TOKEN_TTL * 2)
        return response

    @app.get("/api/pair/{pending_id}", response_model=RemotePairPoll)
    async def poll_pair(pending_id: str, request: Request):
        rt = runtime_of(request)
        try:
            result = rt.auth.poll_pairing(
                pending_id, parse_cookies(request).get(PAIRING_COOKIE)
            )
        except PairingError as exc:
            raise RemoteHTTPError(404, "not_found") from exc
        body = RemotePairPoll(
            state=result.state,  # type: ignore[arg-type]
            csrf_token=result.csrf_token,
            device_label=result.device.label if result.device else None,
        )
        response = JSONResponse(body.model_dump())
        if result.state == "approved":
            _set_cookie(response, DEVICE_COOKIE, result.device_cookie or "", max_age=DEVICE_ABSOLUTE_TTL)
            _set_cookie(response, SESSION_COOKIE, result.session_cookie or "")
            _clear_cookie(response, PAIRING_COOKIE)
        elif result.state in ("denied", "expired"):
            _clear_cookie(response, PAIRING_COOKIE)
        return response

    # --- sessions -----------------------------------------------------------

    @app.post("/api/session/renew", response_model=RemoteSessionRenewed)
    async def renew(request: Request, authed: Annotated[Authed, Depends(require_device)]):
        rt = runtime_of(request)
        try:
            renewal = rt.auth.renew_session(parse_cookies(request).get(DEVICE_COOKIE))
        except PairingError as exc:
            raise _auth_error(exc.code) from exc
        response = JSONResponse(RemoteSessionRenewed(csrf_token=renewal.csrf_token).model_dump())
        _set_cookie(response, DEVICE_COOKIE, renewal.device_cookie, max_age=DEVICE_ABSOLUTE_TTL)
        _set_cookie(response, SESSION_COOKIE, renewal.session_cookie)
        return response

    @app.post("/api/disconnect")
    async def disconnect(request: Request, authed: Annotated[Authed, Depends(require_device)]):
        rt = runtime_of(request)
        rt.auth.disconnect(parse_cookies(request).get(DEVICE_COOKIE))
        response = JSONResponse({"ok": True})
        for name in (SESSION_COOKIE, DEVICE_COOKIE, PAIRING_COOKIE):
            _clear_cookie(response, name)
        return response

    @app.get("/api/me", response_model=RemoteMe)
    async def me(request: Request, authed: Annotated[Authed, Depends(require_device)]):
        rt = runtime_of(request)
        device = authed.device
        started = rt.auth.session_started_at(authed.session_cookie) if authed.has_session else None
        return RemoteMe(
            device_label=device.label,
            user_agent=device.user_agent,
            owner_login=authed.login,
            mac_name=rt.mac_name,
            csrf_token=rt.auth.csrf_token(device),
            session_active=authed.has_session,
            approved_at=summary.iso(device.approved_at) or "",
            session_started_at=summary.iso(started),
            network_path=rt.network_path if rt.network_path in ("direct", "relayed") else "unknown",
            devices_connected=rt.auth.connected_count(),
        )

    # --- projects -----------------------------------------------------------

    @app.get("/api/projects", response_model=RemoteProjectList)
    def list_projects(request: Request, authed: Annotated[Authed, Depends(require_session)]):
        rt = runtime_of(request)
        listed = []
        for project_uuid, entry in rt.store.shown_projects():
            open_id = rt.project_service.find_open_by_uuid(project_uuid)
            if open_id is not None and open_id in rt.projects:
                project = rt.projects[open_id]
                manifest = project.get("project") or {}
                listed.append(
                    summary.project_summary(
                        project_uuid,
                        name=manifest.get("name", ""),
                        source_count=len(manifest.get("source_videos", [])),
                        clip_count=len(project.get("clips") or []),
                        progress=project.get("analysis_progress"),
                    )
                )
                continue
            try:
                manifest_model = open_project(Path(entry.folder_path))
            except (ProjectStoreError, OSError):
                continue  # a missing or foreign folder is simply not listed
            if manifest_model.project_uuid != project_uuid:
                continue
            restored = read_analysis_results(Path(entry.folder_path))
            listed.append(
                summary.project_summary(
                    project_uuid,
                    name=manifest_model.name,
                    source_count=len(manifest_model.source_videos),
                    clip_count=len(restored["clips"]) if restored else 0,
                    progress=None,
                )
            )
        return RemoteProjectList(projects=listed)

    @app.get("/api/projects/{project_id}", response_model=RemoteProjectDetail)
    def project_detail(project_id: str, request: Request, authed: Annotated[Authed, Depends(require_session)]):
        rt = runtime_of(request)
        _runtime_id, project = open_exposed_project(rt, project_id)
        return summary.project_detail(project_id, project)

    register_extensions(app, runtime)

    # --- unknown API paths are JSON 404s, never the SPA ---------------------

    @app.api_route(
        "/api/{rest:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    )
    async def unknown_api(rest: str):
        raise RemoteHTTPError(404, "not_found")

    # --- static phone UI (identity gate only; it holds no data) -------------

    @app.get("/{path:path}", include_in_schema=False)
    async def static_ui(path: str, request: Request):
        rt = runtime_of(request)
        ui_dir = rt.ui_dir
        if ui_dir is None:
            raise RemoteHTTPError(404, "no_ui")
        root = ui_dir.resolve()
        candidate = (root / (path or "index.html")).resolve()
        # Exact files only (the phone app routes in the URL hash), never an SPA
        # fallback: every unknown path is a 404, like `/mcp` or `/settings`.
        if not _is_within(candidate, root) or not candidate.is_file():
            raise RemoteHTTPError(404, "not_found")
        headers = {}
        if candidate.name == "index.html":
            headers["Cache-Control"] = "no-cache"
        return FileResponse(candidate, headers=headers)

    return app


def _is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def register_extensions(app: FastAPI, runtime: RemoteRuntime) -> None:
    """Later tasks add routers here (events, uploads) before the catch-alls."""
    for hook in EXTENSIONS:
        hook(app, runtime)


EXTENSIONS: List[Callable[[FastAPI, RemoteRuntime], None]] = []


def create_remote_app(runtime: RemoteRuntime) -> Callable:
    """The ASGI callable uvicorn serves: the gate wrapped around the routes."""
    return RemoteGate(build_remote_api(runtime), runtime)


