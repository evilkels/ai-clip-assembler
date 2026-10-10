import os
import stat

import pytest

from src.remote import auth as auth_module
from src.remote.auth import (
    DEVICE_ABSOLUTE_TTL,
    DEVICE_IDLE_TTL,
    PAIRING_TOKEN_TTL,
    ROTATION_GRACE,
    SESSION_IDLE_TTL,
    PairingError,
    RemoteAuth,
)
from src.remote.store import RemoteStore

OWNER = "owner@example.test"
MINUTE = 60
DAY = 24 * 3600


class Clock:
    def __init__(self, start=1_000_000.0):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def store_dir(tmp_path):
    return tmp_path / "remote"


@pytest.fixture
def auth(store_dir, clock):
    instance = RemoteAuth(RemoteStore(store_dir), clock=clock)
    instance.set_owner(OWNER)
    return instance


class Pairing:
    """Everything a phone ends up holding after a successful pairing."""

    def __init__(self, auth, label="iPhone", login=OWNER):
        self.code = auth.new_pairing_code()
        self.pending_id, self.poll_secret = auth.begin_pairing(
            login, self.code.token, label, "iPhone · Safari"
        )
        self.device = auth.approve(self.pending_id)
        poll = auth.poll_pairing(self.pending_id, self.poll_secret)
        assert poll.state == "approved"
        self.device_cookie = poll.device_cookie
        self.session_cookie = poll.session_cookie
        self.csrf = poll.csrf_token


def pair(auth, **kwargs):
    return Pairing(auth, **kwargs)


def all_store_text(directory):
    chunks = []
    for root, _dirs, files in os.walk(directory):
        for name in files:
            with open(os.path.join(root, name), "rb") as handle:
                chunks.append(handle.read().decode("utf-8", "replace"))
    return "\n".join(chunks)


# --- store permissions and secrets -------------------------------------------


def test_store_directory_and_files_are_private(auth, store_dir):
    pair(auth)
    auth.store.set_exposure("proj", "/tmp/p", True)
    auth.store.audit("x")

    assert stat.S_IMODE(store_dir.stat().st_mode) == 0o700
    names = sorted(p.name for p in store_dir.iterdir())
    assert {"devices.json", "exposure.json", "policy.json", "audit.jsonl"} <= set(names)
    for path in store_dir.iterdir():
        assert stat.S_IMODE(path.stat().st_mode) == 0o600, path.name


def test_no_raw_token_cookie_or_csrf_value_is_ever_written(auth, store_dir, clock):
    pairing = pair(auth)
    clock.advance(SESSION_IDLE_TTL + 1)
    renewal = auth.renew_session(pairing.device_cookie)
    second = pair(auth, label="iPad")
    auth.disconnect(second.device_cookie)
    pending_code = auth.new_pairing_code()
    auth.revoke(pairing.device.device_id)
    auth.revoke_all()

    secrets_seen = [
        pairing.code.token,
        pairing.poll_secret,
        pairing.device_cookie,
        pairing.session_cookie,
        pairing.csrf,
        renewal.device_cookie,
        renewal.session_cookie,
        renewal.csrf_token,
        second.device_cookie,
        second.session_cookie,
        pending_code.token,
    ]
    text = all_store_text(store_dir)
    assert text  # something was written
    for value in secrets_seen:
        assert value not in text


def test_devices_exposure_and_policy_survive_a_restart(auth, store_dir, clock):
    pairing = pair(auth)
    auth.store.set_exposure("proj-1", "/tmp/one", True)
    auth.store.set_exposure("proj-2", "/tmp/two", False)

    reloaded = RemoteAuth(RemoteStore(store_dir), clock=clock)

    assert reloaded.owner_login == OWNER
    assert [d["label"] for d in reloaded.list_devices()] == ["iPhone"]
    assert reloaded.store.exposed("proj-1").folder_path == "/tmp/one"
    assert reloaded.store.exposed("proj-2") is None  # not shown by default
    assert reloaded.store.exposed("never-seen") is None
    # Sessions are memory only: after a restart the device must renew.
    result = reloaded.authenticate(pairing.session_cookie, pairing.device_cookie)
    assert (result.ok, result.reason, result.device_valid) == (False, "session_expired", True)


# --- pairing token ------------------------------------------------------------


def test_pairing_token_is_single_use_and_five_minutes(auth, clock):
    code = auth.new_pairing_code()
    assert code.expires_at == clock() + PAIRING_TOKEN_TTL == clock() + 300

    auth.begin_pairing(OWNER, code.token, "iPhone")
    with pytest.raises(PairingError) as used:
        auth.begin_pairing(OWNER, code.token, "iPhone")
    assert used.value.code == "used"

    expiring = auth.new_pairing_code()
    clock.advance(PAIRING_TOKEN_TTL)
    with pytest.raises(PairingError) as expired:
        auth.begin_pairing(OWNER, expiring.token, "iPhone")
    assert expired.value.code == "expired"
    assert "Code expired" in str(expired.value)


def test_unknown_token_is_invalid_and_a_new_code_replaces_the_unused_one(auth):
    first = auth.new_pairing_code()
    second = auth.new_pairing_code()
    with pytest.raises(PairingError) as exc:
        auth.begin_pairing(OWNER, first.token, "iPhone")
    assert exc.value.code == "invalid"
    auth.begin_pairing(OWNER, second.token, "iPhone")


def test_claimed_code_cannot_be_redeemed_twice_even_after_approval(auth):
    pairing = pair(auth)
    with pytest.raises(PairingError):
        auth.begin_pairing(OWNER, pairing.code.token, "again")


def test_pairing_waits_for_mac_approval_then_issues_credentials_once_replayable(auth, clock):
    code = auth.new_pairing_code()
    pending_id, secret = auth.begin_pairing(OWNER, code.token, "  iPhone\x00 15  ", "iPhone · Safari")

    assert auth.poll_pairing(pending_id, secret).state == "pending"
    waiting = auth.list_pending()
    assert [(p["label"], p["login"], p["user_agent"]) for p in waiting] == [
        ("iPhone 15", OWNER, "iPhone · Safari")
    ]
    assert auth.list_devices() == []  # nothing is granted before approval

    device = auth.approve(pending_id)
    assert auth.list_pending() == []
    first = auth.poll_pairing(pending_id, secret)
    again = auth.poll_pairing(pending_id, secret)
    assert first.state == again.state == "approved"
    assert first.device_cookie == again.device_cookie
    assert first.device.device_id == device.device_id

    clock.advance(121)
    assert auth.poll_pairing(pending_id, secret).state == "expired"


def test_poll_requires_the_pending_secret(auth):
    code = auth.new_pairing_code()
    pending_id, _secret = auth.begin_pairing(OWNER, code.token, "iPhone")
    auth.approve(pending_id)
    with pytest.raises(PairingError):
        auth.poll_pairing(pending_id, "guess")
    with pytest.raises(PairingError):
        auth.poll_pairing(pending_id, None)
    with pytest.raises(PairingError):
        auth.poll_pairing("nope", "guess")


def test_deny_burns_the_code(auth):
    code = auth.new_pairing_code()
    pending_id, secret = auth.begin_pairing(OWNER, code.token, "iPhone")
    auth.deny(pending_id)

    assert auth.poll_pairing(pending_id, secret).state == "denied"
    with pytest.raises(PairingError):
        auth.approve(pending_id)
    with pytest.raises(PairingError):
        auth.begin_pairing(OWNER, code.token, "iPhone")
    assert auth.list_devices() == []


def test_unanswered_request_lapses_with_its_code(auth, clock):
    code = auth.new_pairing_code()
    pending_id, secret = auth.begin_pairing(OWNER, code.token, "iPhone")
    clock.advance(PAIRING_TOKEN_TTL + 1)

    assert auth.list_pending() == []
    assert auth.poll_pairing(pending_id, secret).state == "expired"
    with pytest.raises(PairingError) as exc:
        auth.approve(pending_id)
    assert exc.value.code == "expired"


# --- rate limits --------------------------------------------------------------


def test_five_failed_pairings_per_identity_in_ten_minutes_then_429(auth, clock):
    for _ in range(5):
        with pytest.raises(PairingError) as exc:
            auth.begin_pairing(OWNER, "wrong", "x")
        assert exc.value.code == "invalid"
    good = auth.new_pairing_code()
    with pytest.raises(PairingError) as limited:
        auth.begin_pairing(OWNER, good.token, "x")
    assert limited.value.code == "rate_limited"
    assert 0 < limited.value.retry_after <= 600

    # A different identity is not locked out by this one's failures.
    auth.begin_pairing("someone-else@example.test", good.token, "x")

    clock.advance(601)
    next_code = auth.new_pairing_code()
    auth.begin_pairing(OWNER, next_code.token, "x")


def test_global_failure_ceiling_of_thirty_per_ten_minutes(auth):
    for n in range(30):
        with pytest.raises(PairingError):
            auth.begin_pairing(f"user{n}@example.test", "wrong", "x")
    code = auth.new_pairing_code()
    with pytest.raises(PairingError) as exc:
        auth.begin_pairing("fresh@example.test", code.token, "x")
    assert exc.value.code == "rate_limited"


# --- sessions and device credentials ------------------------------------------


def test_session_authenticates_and_idles_out_after_fifteen_minutes(auth, clock):
    pairing = pair(auth)
    ok = auth.authenticate(pairing.session_cookie, pairing.device_cookie)
    assert ok.ok and ok.device.device_id == pairing.device.device_id

    clock.advance(SESSION_IDLE_TTL - 1)
    assert auth.authenticate(pairing.session_cookie, None).ok  # activity renews it
    clock.advance(SESSION_IDLE_TTL - 1)
    assert auth.authenticate(pairing.session_cookie, None).ok
    clock.advance(SESSION_IDLE_TTL + 1)
    idle = auth.authenticate(pairing.session_cookie, pairing.device_cookie)
    assert (idle.ok, idle.reason, idle.device_valid) == (False, "session_expired", True)

    # Without the device cookie the phone has nothing to renew with.
    assert auth.authenticate(pairing.session_cookie, None).reason == "never_paired"


def test_renewal_rotates_the_device_credential_with_a_short_grace(auth, clock):
    pairing = pair(auth)
    clock.advance(SESSION_IDLE_TTL + 1)

    renewal = auth.renew_session(pairing.device_cookie)

    assert renewal.device_cookie != pairing.device_cookie
    assert renewal.session_cookie != pairing.session_cookie
    assert auth.authenticate(renewal.session_cookie, renewal.device_cookie).ok
    # A lost response: the phone still holds the old cookie for a while.
    assert auth.authenticate(None, pairing.device_cookie).reason == "session_expired"
    again = auth.renew_session(pairing.device_cookie)
    assert auth.authenticate(again.session_cookie, None).ok
    clock.advance(ROTATION_GRACE + 1)
    assert auth.authenticate(None, pairing.device_cookie).reason == "never_paired"
    assert auth.authenticate(None, renewal.device_cookie).reason == "never_paired"
    assert auth.authenticate(None, again.device_cookie).device_valid


def test_device_expires_after_thirty_days_unused(auth, clock):
    pairing = pair(auth)
    clock.advance(DEVICE_IDLE_TTL - DAY)
    renewed = auth.renew_session(pairing.device_cookie)  # use resets the idle timer
    clock.advance(DEVICE_IDLE_TTL + 1)

    result = auth.authenticate(None, renewed.device_cookie)
    assert (result.ok, result.reason) == (False, "expired")
    with pytest.raises(PairingError) as exc:
        auth.renew_session(renewed.device_cookie)
    assert exc.value.code == "expired"
    assert auth.list_devices() == []


def test_device_expires_after_ninety_days_even_when_used_daily(auth, clock):
    pairing = pair(auth)
    cookie = pairing.device_cookie
    for _ in range(89):
        clock.advance(DAY)
        cookie = auth.renew_session(cookie).device_cookie
    clock.advance(DAY + 1)
    assert DEVICE_ABSOLUTE_TTL == 90 * DAY

    assert auth.authenticate(None, cookie).reason == "expired"


def test_disconnect_revoke_and_revoke_all_report_their_reason(auth):
    a, b, c = pair(auth, label="A"), pair(auth, label="B"), pair(auth, label="C")
    assert auth.connected_count() == 3

    assert auth.disconnect(a.device_cookie).device_id == a.device.device_id
    assert auth.revoke(b.device.device_id) is True
    assert auth.revoke(b.device.device_id) is False  # already gone

    assert auth.authenticate(a.session_cookie, a.device_cookie).reason == "disconnected"
    assert auth.authenticate(b.session_cookie, b.device_cookie).reason == "revoked"
    assert auth.authenticate(c.session_cookie, c.device_cookie).ok
    assert [d["label"] for d in auth.list_devices()] == ["C"]

    auth.revoke_all()
    assert auth.authenticate(c.session_cookie, c.device_cookie).reason == "revoked"
    assert auth.list_devices() == []
    assert auth.connected_count() == 0
    with pytest.raises(PairingError):
        auth.renew_session(c.device_cookie)


def test_revoked_device_cannot_renew_and_garbage_is_never_paired(auth):
    pairing = pair(auth)
    auth.revoke(pairing.device.device_id)
    with pytest.raises(PairingError) as exc:
        auth.renew_session(pairing.device_cookie)
    assert exc.value.code == "revoked"
    assert auth.authenticate("junk", "junk2").reason == "never_paired"
    assert auth.authenticate(None, None).reason == "never_paired"


def test_revoke_all_discards_pending_pairings_and_codes(auth):
    code = auth.new_pairing_code()
    pending_id, _ = auth.begin_pairing(OWNER, code.token, "x")
    spare = auth.new_pairing_code()
    auth.revoke_all()

    assert auth.list_pending() == []
    with pytest.raises(PairingError):
        auth.approve(pending_id)
    with pytest.raises(PairingError):
        auth.begin_pairing(OWNER, spare.token, "x")


def test_turning_off_ends_sessions_but_remembered_devices_can_reconnect(auth):
    pairing = pair(auth)
    auth.drop_all_sessions()

    result = auth.authenticate(pairing.session_cookie, pairing.device_cookie)
    assert (result.ok, result.reason, result.device_valid) == (False, "session_expired", True)
    assert auth.connected_count() == 0
    renewal = auth.renew_session(pairing.device_cookie)
    assert auth.authenticate(renewal.session_cookie, renewal.device_cookie).ok


def test_owner_change_revokes_devices_paired_under_the_old_owner(auth):
    pairing = pair(auth)
    auth.set_owner("new-owner@example.test")

    assert auth.authenticate(pairing.session_cookie, pairing.device_cookie).reason == "revoked"
    assert auth.list_devices() == []


def test_session_count_per_device_is_bounded(auth, clock):
    pairing = pair(auth)
    cookie = pairing.device_cookie
    for _ in range(auth_module.MAX_SESSIONS_PER_DEVICE + 5):
        cookie = auth.renew_session(cookie).device_cookie
    assert len(auth._sessions) == auth_module.MAX_SESSIONS_PER_DEVICE


# --- CSRF ---------------------------------------------------------------------


def test_csrf_token_is_per_device_and_survives_renewal(auth, clock):
    one, two = pair(auth, label="one"), pair(auth, label="two")

    assert one.csrf != two.csrf
    assert auth.check_csrf(one.device, one.csrf)
    assert not auth.check_csrf(one.device, two.csrf)
    assert not auth.check_csrf(one.device, "")
    assert not auth.check_csrf(one.device, None)
    assert not auth.check_csrf(one.device, "é")  # non-ascii must not raise
    assert not auth.check_csrf(None, one.csrf)

    clock.advance(SESSION_IDLE_TTL + 1)
    renewal = auth.renew_session(one.device_cookie)
    assert renewal.csrf_token == one.csrf


def test_revoke_all_rotates_the_csrf_key(auth):
    pairing = pair(auth)
    before = auth.csrf_token(pairing.device)
    auth.revoke_all()
    assert auth.csrf_token(pairing.device) != before


# --- presence and events ------------------------------------------------------


def test_connected_means_recent_activity_or_an_open_stream(auth, clock):
    pairing = pair(auth)
    device_id = pairing.device.device_id
    assert auth.connected_count() == 1

    clock.advance(auth_module.CONNECTED_WINDOW + 1)
    assert auth.connected_count() == 0
    auth.stream_opened(device_id)
    assert auth.connected_count() == 1
    assert auth.list_devices()[0]["connected"] is True
    auth.stream_closed(device_id)
    assert auth.connected_count() == 0
    auth.authenticate(pairing.session_cookie, None)
    assert auth.connected_count() == 1


def test_listeners_hear_about_pending_pairings_and_ended_devices(auth):
    events = []
    auth.add_listener(lambda name, payload: events.append((name, payload.get("reason"))))
    pairing = pair(auth)
    events.clear()
    auth.revoke(pairing.device.device_id)

    assert ("sessions_changed", None) in events
    assert ("device_ended", "revoked") in events

    events.clear()
    code = auth.new_pairing_code()
    auth.begin_pairing(OWNER, code.token, "x")
    assert ("pending_pairing", None) in events


def test_a_failing_listener_does_not_break_auth(auth):
    def boom(_name, _payload):
        raise RuntimeError("observer bug")

    auth.add_listener(boom)
    assert pair(auth).device is not None


def test_last_seen_is_persisted_at_most_once_a_minute(auth, store_dir, clock):
    pairing = pair(auth)
    writes = []
    real = auth.store.save_devices
    auth.store.save_devices = lambda: (writes.append(1), real())
    for _ in range(10):
        clock.advance(5)
        auth.authenticate(pairing.session_cookie, None)
    assert writes == []
    clock.advance(60)
    auth.authenticate(pairing.session_cookie, None)
    assert writes == [1]
