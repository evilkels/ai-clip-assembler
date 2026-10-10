import pytest

from remote_support import MAC_NAME, ORIGIN, OWNER, RemoteHarness
from src.remote.auth import SESSION_IDLE_TTL

SECURITY_HEADERS = {
    "content-security-policy": (
        "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; "
        "media-src 'self' blob:; frame-ancestors 'none'"
    ),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
}


@pytest.fixture
def harness(tmp_path):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html><title>remote</title>")
    (ui / "assets").mkdir()
    (ui / "assets" / "app.js").write_text("console.log('x')")
    (tmp_path / "secret.txt").write_text("TOP SECRET")
    h = RemoteHarness(tmp_path / "state", ui_dir=ui)
    yield h
    h.close()


@pytest.fixture
def phone(harness):
    return harness.paired_phone()


# --- 1. lease ------------------------------------------------------------------


def test_closed_lease_fails_every_request_with_503_remote_off(harness, phone):
    harness.runtime.close_lease()
    for path in ("/api/health", "/api/projects", "/", "/api/me"):
        response = phone.get(path)
        assert response.status_code == 503, path
        assert response.json() == {"reason": "remote_off"}
    # ...even with no ingress at all.
    assert phone.client.get("/anything", headers=phone.headers()).status_code == 503


def test_reenabling_mints_a_new_ingress_and_the_old_one_is_404(harness, phone):
    old = phone.url("/api/health")
    assert phone.client.get(old).status_code == 200
    harness.runtime.close_lease()
    harness.runtime.open_lease(OWNER, ORIGIN, MAC_NAME)

    assert phone.client.get(old).status_code == 404
    assert phone.client.get(phone.url("/api/health")).status_code == 200


# --- 2. ingress ----------------------------------------------------------------


def test_path_without_the_current_ingress_is_a_bare_404(harness, phone):
    for path in ("/api/health", "/remote/api/health", "/wrong-ingress/api/health", "/"):
        response = phone.client.get(path, headers=phone.headers())
        assert response.status_code == 404, path
        assert response.content == b""
    # a prefix of the ingress is not the ingress
    almost = f"/{harness.runtime.ingress[:-1]}/api/health"
    assert phone.client.get(almost, headers=phone.headers()).status_code == 404


def test_health_answers_through_the_ingress_without_revealing_it(harness):
    anonymous = harness.phone()
    response = anonymous.client.get(anonymous.url("/api/health"))  # no identity, no session

    assert response.status_code == 200
    assert response.json() == {"ok": True, "instance": harness.runtime.instance}
    assert harness.runtime.ingress not in response.text
    assert harness.runtime.ingress not in str(response.headers)


# --- 3. identity ---------------------------------------------------------------


@pytest.mark.parametrize(
    "extra, login",
    [
        ({}, None),  # missing
        ({}, "someone-else@example.test"),  # other
        ({}, ""),  # empty
        ({"Tailscale-Funnel-Request": "?1"}, OWNER),  # funnel-marked
        ({}, "OWNER@example.test"),  # exact match only
    ],
)
def test_identity_other_than_the_owner_is_refused(phone, extra, login):
    response = phone.client.get(
        phone.url("/api/projects"), headers=phone.headers(login=login, extra=extra)
    )
    assert response.status_code == 403
    assert response.json() == {"reason": "identity"}


def test_duplicate_identity_headers_are_refused(phone):
    headers = phone.headers(login=None)
    response = phone.client.get(
        phone.url("/api/projects"),
        headers=[*headers.items(), ("Tailscale-User-Login", OWNER), ("Tailscale-User-Login", OWNER)],
    )
    assert response.status_code == 403


def test_rfc2047_encoded_identity_is_decoded(phone):
    # =?utf-8?q?owner=40example=2Etest?= decodes to owner@example.test
    response = phone.client.get(
        phone.url("/api/projects"),
        headers=phone.headers(login="=?utf-8?q?owner=40example=2Etest?="),
    )
    assert response.status_code == 200


def test_identity_gate_applies_to_static_files_and_unknown_paths_too(harness):
    anonymous = harness.phone()
    for path in ("/", "/assets/app.js", "/mcp"):
        response = anonymous.client.get(
            anonymous.url(path), headers=anonymous.headers(login="intruder@example.test")
        )
        assert response.status_code == 403, path


# --- 4. session ----------------------------------------------------------------


def test_forged_owner_header_without_a_session_gets_401(harness):
    forger = harness.phone()
    response = forger.get("/api/projects")
    assert response.status_code == 401
    assert response.json()["reason"] == "never_paired"


def test_idle_session_gets_session_expired_and_renew_restores_it(harness, phone):
    harness.clock.advance(SESSION_IDLE_TTL + 1)
    response = phone.get("/api/projects")
    assert response.status_code == 401
    assert response.json()["reason"] == "session_expired"

    renewed = phone.post("/api/session/renew")
    assert renewed.status_code == 200
    assert renewed.json()["csrf_token"] == phone.csrf
    assert phone.get("/api/projects").status_code == 200


def test_expired_device_reports_expired(harness, phone):
    harness.clock.advance(31 * 24 * 3600)
    response = phone.get("/api/projects")
    assert (response.status_code, response.json()["reason"]) == (401, "expired")


# --- 5. mutations: origin and CSRF ---------------------------------------------------


def test_unauthenticated_mutation_is_401_before_origin_is_considered(harness):
    forger = harness.phone()
    response = forger.post("/api/session/renew", mutating=True, origin="https://evil.example")
    assert response.status_code == 401


@pytest.mark.parametrize(
    "origin",
    [None, "null", "https://mac.tailnet.ts.net", "https://mac.tailnet.ts.net:9999",
     "http://mac.tailnet.ts.net:8448", "https://evil.example", ORIGIN + "/"],
)
def test_mutation_with_a_wrong_origin_is_403(phone, origin):
    response = phone.post("/api/disconnect", origin=origin)
    assert response.status_code == 403
    assert response.json()["reason"] == "origin"
    # and the phone is still paired afterwards
    assert phone.get("/api/projects").status_code == 200


def test_mutation_without_or_with_wrong_csrf_is_403(phone):
    good = phone.csrf
    phone.csrf = None
    missing = phone.post("/api/disconnect")
    phone.csrf = "not-the-token"
    wrong = phone.post("/api/disconnect")
    phone.csrf = good

    assert (missing.status_code, missing.json()["reason"]) == (403, "csrf")
    assert (wrong.status_code, wrong.json()["reason"]) == (403, "csrf")
    assert phone.get("/api/projects").status_code == 200


def test_another_devices_csrf_token_is_refused(harness, phone):
    other = harness.paired_phone("iPad")
    phone.csrf = other.csrf
    assert phone.post("/api/disconnect").status_code == 403


def test_tus_method_override_header_is_not_honoured(phone):
    # An override must not let a "safe" request be treated as a mutation or vice versa.
    response = phone.request(
        "GET", "/api/projects", extra={"X-HTTP-Method-Override": "DELETE"}
    )
    assert response.status_code == 200


# --- 6. exposure ---------------------------------------------------------------


def test_only_projects_shown_on_phone_are_listed_and_reachable(harness, phone, tmp_path):
    shown_uuid, _, _ = harness.make_project(tmp_path, "shown", shown=True)
    hidden_uuid, _, _ = harness.make_project(tmp_path, "hidden", shown=False)

    listing = phone.get("/api/projects").json()["projects"]
    assert [p["id"] for p in listing] == [shown_uuid]
    assert phone.get(f"/api/projects/{shown_uuid}").status_code == 200
    unexposed = phone.get(f"/api/projects/{hidden_uuid}")
    missing = phone.get("/api/projects/00000000-0000-0000-0000-000000000000")
    assert unexposed.status_code == missing.status_code == 404
    assert unexposed.json() == missing.json()  # indistinguishable


def test_projects_list_is_empty_when_nothing_is_shown(harness, phone):
    assert phone.get("/api/projects").json() == {"projects": []}


# --- allow-list: desktop routes do not exist here ---------------------------------


@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/mcp"),
        ("GET", "/mcp"),
        ("POST", "/projects/from-folder"),
        ("GET", "/settings"),
        ("PUT", "/settings"),
        ("DELETE", "/projects/abc/files"),
        ("PUT", "/projects/abc/timeline"),
        ("POST", "/projects/abc/analyze"),
        ("GET", "/projects/abc/timeline/document"),
        ("GET", "/diagnostics"),
        ("GET", "/harnesses"),
        ("GET", "/api/settings"),
        ("POST", "/api/projects/abc/analyze"),
        ("POST", "/api/projects"),
    ],
)
def test_desktop_routes_are_404_on_the_remote_app(phone, method, path):
    response = phone.request(method, path)
    assert response.status_code in (404, 405), (method, path, response.status_code)
    assert "<!doctype" not in response.text.lower()


def test_unknown_api_paths_are_json_404_never_the_spa(phone):
    response = phone.get("/api/definitely/not/here")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["reason"] == "not_found"


# --- headers -------------------------------------------------------------------------


def test_security_headers_on_api_static_and_error_responses(harness, phone):
    for response in (
        phone.get("/api/me"),
        phone.get("/api/projects"),
        phone.get("/"),
        phone.get("/assets/app.js"),
        phone.get("/api/nope"),
        phone.client.get(phone.url("/api/projects"), headers=phone.headers(login="x@y.z")),
        harness.phone().get("/api/projects"),
    ):
        for name, value in SECURITY_HEADERS.items():
            assert response.headers.get(name) == value, (response.url, name)
    assert phone.get("/api/me").headers["cache-control"] == "private, no-store"
    assert phone.get("/api/projects").headers["cache-control"] == "private, no-store"
    assert phone.get("/api/nope").headers["cache-control"] == "private, no-store"


def test_no_cors_headers_are_ever_sent(phone):
    response = phone.client.get(
        phone.url("/api/me"), headers=phone.headers(extra={"Origin": "https://evil.example"})
    )
    assert "access-control-allow-origin" not in response.headers
    preflight = phone.client.options(
        phone.url("/api/me"),
        headers=phone.headers(
            extra={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
        ),
    )
    assert "access-control-allow-origin" not in preflight.headers


# --- static ui and traversal ---------------------------------------------------


def test_static_ui_is_served_through_the_gate(phone):
    index = phone.get("/")
    assert index.status_code == 200
    assert "<title>remote</title>" in index.text
    assert index.headers["cache-control"] == "no-cache"
    assert phone.get("/assets/app.js").text == "console.log('x')"
    assert phone.get("/assets/missing.js").status_code == 404


@pytest.mark.parametrize(
    "path",
    ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt",
     "/%2e%2e%2fsecret.txt", "//etc/passwd", "/assets/%2e%2e/%2e%2e/secret.txt"],
)
def test_static_path_traversal_never_leaves_the_ui_directory(phone, path):
    response = phone.client.get(phone.url(path), headers=phone.headers())
    assert "TOP SECRET" not in response.text
    assert "root:" not in response.text


# --- size limits ---------------------------------------------------------------


def test_oversized_json_body_is_413_before_any_route_reads_it(harness):
    anonymous = harness.phone()
    big = b"{" + b'"token": "' + b"a" * 70_000 + b'"}'
    response = anonymous.request("POST", "/api/pair", content=big, mutating=True,
                                 extra={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json() == {"reason": "too_large"}


# --- pairing over HTTP ----------------------------------------------------------


def test_pairing_flow_issues_host_only_strict_cookies_after_mac_approval(harness):
    phone = harness.phone()
    code = harness.auth.new_pairing_code()

    started = phone.post("/api/pair", {"token": code.token, "label": "Elvijs iPhone"}, mutating=True)
    assert started.status_code == 202
    pairing_cookie = started.headers["set-cookie"].lower()
    assert "__host-aca_pairing=" in pairing_cookie
    for flag in ("httponly", "secure", "samesite=strict", "path=/"):
        assert flag in pairing_cookie
    assert "domain" not in pairing_cookie
    pending_id = started.json()["pending_id"]

    waiting = phone.get(f"/api/pair/{pending_id}")
    assert waiting.json() == {"state": "pending", "csrf_token": None, "device_label": None}
    assert phone.get("/api/projects").status_code == 401  # nothing before approval
    pending = harness.auth.list_pending()
    assert pending[0]["label"] == "Elvijs iPhone"
    assert pending[0]["login"] == OWNER
    assert pending[0]["user_agent"] == "iPhone · Safari"

    harness.auth.approve(pending_id)
    approved = phone.get(f"/api/pair/{pending_id}")
    assert approved.json()["state"] == "approved"
    cookies = approved.headers.get_list("set-cookie")
    names = {c.split("=", 1)[0] for c in cookies}
    assert {"__Host-aca_device", "__Host-aca_session", "__Host-aca_pairing"} <= names
    for cookie in cookies:
        lowered = cookie.lower()
        assert "httponly" in lowered and "secure" in lowered
        assert "samesite=strict" in lowered and "path=/" in lowered
        assert "domain" not in lowered
    assert phone.get("/api/projects").status_code == 200

    me = phone.get("/api/me").json()
    assert (me["device_label"], me["owner_login"], me["mac_name"]) == (
        "Elvijs iPhone",
        OWNER,
        MAC_NAME,
    )
    assert me["session_active"] is True and me["csrf_token"]
    assert me["network_path"] == "unknown"


def test_pair_poll_needs_the_pairing_cookie(harness):
    phone = harness.phone()
    code = harness.auth.new_pairing_code()
    pending_id = phone.post("/api/pair", {"token": code.token}, mutating=True).json()["pending_id"]
    harness.auth.approve(pending_id)

    thief = harness.phone()
    assert thief.get(f"/api/pair/{pending_id}").status_code == 404
    assert thief.get("/api/projects").status_code == 401


def test_pairing_errors_map_to_clear_statuses(harness):
    phone = harness.phone()
    code = harness.auth.new_pairing_code()
    assert phone.post("/api/pair", {"token": code.token}, mutating=True).status_code == 202
    used = phone.post("/api/pair", {"token": code.token}, mutating=True)
    assert (used.status_code, used.json()["reason"]) == (409, "used")

    expiring = harness.auth.new_pairing_code()
    harness.clock.advance(301)
    expired = phone.post("/api/pair", {"token": expiring.token}, mutating=True)
    assert (expired.status_code, expired.json()["reason"]) == (410, "expired")
    assert "Code expired" in expired.json()["message"]

    for _ in range(5):
        phone.post("/api/pair", {"token": "wrong"}, mutating=True)
    limited = phone.post("/api/pair", {"token": "wrong"}, mutating=True)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0


def test_pairing_requires_the_exact_origin(harness):
    phone = harness.phone()
    code = harness.auth.new_pairing_code()
    for origin in (None, "null", "https://evil.example"):
        response = phone.post("/api/pair", {"token": code.token}, mutating=True, origin=origin)
        assert response.status_code == 403
    assert harness.auth.list_pending() == []


def test_disconnect_clears_cookies_and_ends_access(harness, phone):
    response = phone.post("/api/disconnect")
    assert response.status_code == 200
    cleared = response.headers.get_list("set-cookie")
    assert len(cleared) == 3 and all("max-age=0" in c.lower() for c in cleared)
    assert harness.auth.list_devices() == []


def test_disconnected_phone_with_a_stale_cookie_sees_reason_disconnected(harness, phone):
    jar = dict(phone.client.cookies)
    phone.post("/api/disconnect")
    stale = harness.phone()
    for name, value in jar.items():
        stale.client.cookies.set(name, value)
    response = stale.get("/api/projects")
    assert (response.status_code, response.json()["reason"]) == (401, "disconnected")


def test_revoked_phone_with_a_stale_cookie_sees_reason_revoked(harness, phone):
    jar = dict(phone.client.cookies)
    harness.auth.revoke(harness.auth.list_devices()[0]["device_id"])
    stale = harness.phone()
    for name, value in jar.items():
        stale.client.cookies.set(name, value)
    response = stale.get("/api/projects")
    assert (response.status_code, response.json()["reason"]) == (401, "revoked")


# --- public URLs --------------------------------------------------------------------


def test_public_urls_use_the_mount_prefix_never_the_ingress(harness):
    assert harness.runtime.public_url("/api/projects/p/uploads/u") == "/remote/api/projects/p/uploads/u"
    assert harness.runtime.ingress not in harness.runtime.public_url("/x")


def _raw_get(app, path, login=OWNER):
    """Drive the ASGI app with an exact decoded path (no client-side normalisation)."""
    import asyncio

    sent = []

    async def run():
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [(b"tailscale-user-login", login.encode()), (b"host", b"testserver")],
            "client": ("127.0.0.1", 1),
            "server": ("testserver", 443),
        }
        await app(scope, receive, send)

    asyncio.run(run())
    start = next(m for m in sent if m["type"] == "http.response.start")
    data = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], data


def test_decoded_dot_dot_segments_cannot_escape_the_ui_directory(harness):
    ingress = harness.runtime.ingress
    for path in (
        f"/{ingress}/../secret.txt",
        f"/{ingress}/assets/../../secret.txt",
        f"/{ingress}//../secret.txt",
        f"/{ingress}/%2e%2e/secret.txt",
    ):
        status, data = _raw_get(harness.app, path)
        assert b"TOP SECRET" not in data, path
        assert status in (403, 404), (path, status)
    status, data = _raw_get(harness.app, f"/{ingress}/")
    assert status == 200 and b"<title>remote</title>" in data
