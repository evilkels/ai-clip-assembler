"""Pairing, sessions, CSRF and rate limits for Remote View (architecture §3).

Two gates guard the phone: the owner's Tailscale identity (checked by the remote
app) and the credentials this module issues after the Editor approves a pairing
on the Mac. Identity headers alone never reach this far.

Lifetimes
---------
* pairing token: single use, 5 minutes, memory only
* active session: 15 minutes idle, memory only (ends on disable or quit)
* Paired Device credential: 30 days unused or 90 days absolute, rotated on every
  renewal (the previous value stays valid for a short grace so a lost renewal
  response cannot strand the phone)

Only SHA-256 hashes of credentials are ever written to disk.

CSRF token. Instead of a per-session value, the token is
``HMAC-SHA256(server_key, device_id)``: it is unguessable to a cross-site page,
tied to one Paired Device, and survives idle-session expiry and backend restarts,
which lets ``POST /api/session/renew`` itself be CSRF-protected without a
chicken-and-egg (the phone has no session when it renews).
"""

import base64
import collections
import hashlib
import hmac
import re
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable, Deque, Dict, List, Optional

from .store import DeviceRecord, RemoteStore

SESSION_COOKIE = "__Host-aca_session"
DEVICE_COOKIE = "__Host-aca_device"
PAIRING_COOKIE = "__Host-aca_pairing"

PAIRING_TOKEN_TTL = 5 * 60
SESSION_IDLE_TTL = 15 * 60
DEVICE_IDLE_TTL = 30 * 24 * 3600
DEVICE_ABSOLUTE_TTL = 90 * 24 * 3600
TOMBSTONE_TTL = 90 * 24 * 3600
ROTATION_GRACE = 5 * 60
LAST_SEEN_PERSIST_INTERVAL = 60
CONNECTED_WINDOW = 45
MAX_SESSIONS_PER_DEVICE = 8
MAX_PENDING = 5

PAIR_FAILS_PER_IDENTITY = 5
PAIR_FAILS_GLOBAL = 30
PAIR_FAIL_WINDOW = 10 * 60

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class PairingError(Exception):
    """A pairing request that must be refused. ``code`` is machine-readable."""

    def __init__(self, code: str, message: str, retry_after: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def hash_credential(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clean_label(label: Optional[str], fallback: str = "Phone") -> str:
    cleaned = _CONTROL.sub("", label or "").strip()
    return cleaned[:60] or fallback


@dataclass
class PairingCode:
    token: str
    expires_at: float


@dataclass
class _Code:
    expires_at: float
    claimed_by: Optional[str] = None


@dataclass
class _Pending:
    pending_id: str
    login: str
    label: str
    user_agent: str
    created_at: float
    expires_at: float
    token_hash: str
    poll_hash: str
    state: str = "pending"  # pending | approved | denied
    device_cookie: Optional[str] = None
    session_cookie: Optional[str] = None
    device_id: Optional[str] = None
    deliver_until: float = 0.0


@dataclass
class _Session:
    device_id: str
    created_at: float
    last_active: float


@dataclass
class PollResult:
    state: str  # pending | approved | denied | expired
    device_cookie: Optional[str] = None
    session_cookie: Optional[str] = None
    csrf_token: Optional[str] = None
    device: Optional[DeviceRecord] = None


@dataclass
class AuthResult:
    ok: bool
    device: Optional[DeviceRecord] = None
    reason: Optional[str] = None
    # The device cookie is valid but there is no live session: only the renew,
    # disconnect and "who am I" routes may proceed.
    device_valid: bool = False


@dataclass
class Renewal:
    device: DeviceRecord
    device_cookie: str
    session_cookie: str
    csrf_token: str


Listener = Callable[[str, dict], None]


class RemoteAuth:
    def __init__(
        self,
        store: RemoteStore,
        *,
        clock: Callable[[], float] = time.time,
        token_bytes: Callable[[int], bytes] = secrets.token_bytes,
    ) -> None:
        self.store = store
        self._clock = clock
        self._token_bytes = token_bytes
        self._lock = threading.RLock()
        self._codes: Dict[str, _Code] = {}
        self._pending: Dict[str, _Pending] = {}
        self._sessions: Dict[str, _Session] = {}
        self._streams: Dict[str, int] = {}
        self._persisted_seen: Dict[str, float] = {}
        self._fails_by_identity: Dict[str, Deque[float]] = collections.defaultdict(collections.deque)
        self._fails_global: Deque[float] = collections.deque()
        self._listeners: List[Listener] = []
        self._purge_old_tombstones()

    # --- plumbing -----------------------------------------------------------

    def _token(self) -> str:
        return _b64(self._token_bytes(32))

    def add_listener(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def _emit(self, event: str, **payload: object) -> None:
        for listener in list(self._listeners):
            try:
                listener(event, payload)
            except Exception:  # a broken observer must not break authentication
                pass

    def _purge_old_tombstones(self) -> None:
        now = self._clock()
        stale = [
            device_id
            for device_id, device in self.store.devices.items()
            if device.status != "active"
            and now - (device.status_at or device.approved_at) > TOMBSTONE_TTL
        ]
        if stale:
            for device_id in stale:
                del self.store.devices[device_id]
            self.store.save_devices()

    # --- owner --------------------------------------------------------------

    @property
    def owner_login(self) -> Optional[str]:
        return self.store.policy.owner_login

    def set_owner(self, login: str) -> None:
        """Record the owner. Devices paired under another login are revoked."""
        with self._lock:
            previous = self.store.policy.owner_login
            if previous == login:
                return
            self.store.policy.owner_login = login
            self.store.save_policy()
            if previous is not None:
                self._revoke_where(lambda d: d.owner_login != login, "owner_changed")

    # --- pairing codes ------------------------------------------------------

    def new_pairing_code(self) -> PairingCode:
        with self._lock:
            now = self._clock()
            self._prune_codes(now)
            for key in [k for k, v in self._codes.items() if v.claimed_by is None]:
                del self._codes[key]  # a fresh code replaces the unused one
            token = self._token()
            expires_at = now + PAIRING_TOKEN_TTL
            self._codes[hash_credential(token)] = _Code(expires_at=expires_at)
            self.store.audit("pairing_code_created")
            return PairingCode(token=token, expires_at=expires_at)

    def _prune_codes(self, now: float) -> None:
        for key in [k for k, v in self._codes.items() if v.expires_at + 3600 < now]:
            del self._codes[key]
        for pid in [p for p, v in self._pending.items() if v.expires_at + 3600 < now]:
            del self._pending[pid]

    # --- rate limits --------------------------------------------------------

    def _trim(self, bucket: Deque[float], now: float) -> None:
        while bucket and bucket[0] <= now - PAIR_FAIL_WINDOW:
            bucket.popleft()

    def _check_rate(self, login: str, now: float) -> None:
        mine = self._fails_by_identity[login]
        self._trim(mine, now)
        self._trim(self._fails_global, now)
        for bucket, limit in ((mine, PAIR_FAILS_PER_IDENTITY), (self._fails_global, PAIR_FAILS_GLOBAL)):
            if len(bucket) >= limit:
                retry = max(1, int(bucket[0] + PAIR_FAIL_WINDOW - now))
                raise PairingError(
                    "rate_limited", "Too many tries — wait a few minutes", retry_after=retry
                )

    def _record_failure(self, login: str, now: float) -> None:
        self._fails_by_identity[login].append(now)
        self._fails_global.append(now)

    # --- pairing flow -------------------------------------------------------

    def begin_pairing(
        self, login: str, token: str, label: Optional[str], user_agent: str = ""
    ) -> tuple:
        """Claim a code for *login*; returns ``(pending_id, poll_secret)``."""
        with self._lock:
            now = self._clock()
            self._check_rate(login, now)
            code = self._codes.get(hash_credential(token or ""))
            if code is None:
                self._record_failure(login, now)
                self.store.audit("pairing_failed", reason="invalid")
                raise PairingError("invalid", "Code expired — show a new one on the Mac")
            if code.expires_at <= now:
                self._record_failure(login, now)
                self.store.audit("pairing_failed", reason="expired")
                raise PairingError("expired", "Code expired — show a new one on the Mac")
            if code.claimed_by is not None:
                self._record_failure(login, now)
                self.store.audit("pairing_failed", reason="used")
                raise PairingError("used", "Already used — show a new one on the Mac")
            live = [p for p in self._pending.values() if p.state == "pending" and p.expires_at > now]
            if len(live) >= MAX_PENDING:
                raise PairingError("busy", "Too many pairing requests are waiting on the Mac")
            pending_id = self._token()
            poll_secret = self._token()
            self._pending[pending_id] = _Pending(
                pending_id=pending_id,
                login=login,
                label=clean_label(label),
                user_agent=clean_label(user_agent, fallback="")[:120],
                created_at=now,
                expires_at=code.expires_at,
                token_hash=hash_credential(token),
                poll_hash=hash_credential(poll_secret),
            )
            code.claimed_by = pending_id
            self.store.audit("pairing_requested", pending=pending_id[:8])
        self._emit("pending_pairing")
        return pending_id, poll_secret

    def list_pending(self) -> List[dict]:
        with self._lock:
            now = self._clock()
            return [
                {
                    "pending_id": p.pending_id,
                    "label": p.label,
                    "user_agent": p.user_agent,
                    "login": p.login,
                    "created_at": p.created_at,
                    "expires_at": p.expires_at,
                }
                for p in self._pending.values()
                if p.state == "pending" and p.expires_at > now
            ]

    def poll_pairing(self, pending_id: str, poll_secret: Optional[str]) -> PollResult:
        with self._lock:
            now = self._clock()
            pending = self._pending.get(pending_id or "")
            if pending is None or not hmac.compare_digest(
                pending.poll_hash, hash_credential(poll_secret or "")
            ):
                raise PairingError("invalid", "Unknown pairing request")
            if pending.state == "denied":
                return PollResult(state="denied")
            if pending.state == "approved":
                if now > pending.deliver_until or pending.device_cookie is None:
                    return PollResult(state="expired")
                device = self.store.devices.get(pending.device_id or "")
                return PollResult(
                    state="approved",
                    device_cookie=pending.device_cookie,
                    session_cookie=pending.session_cookie,
                    csrf_token=self._csrf_for(device) if device else None,
                    device=device,
                )
            if pending.expires_at <= now:
                return PollResult(state="expired")
            return PollResult(state="pending")

    def approve(self, pending_id: str) -> DeviceRecord:
        with self._lock:
            now = self._clock()
            pending = self._pending.get(pending_id)
            if pending is None or pending.state != "pending":
                raise PairingError("invalid", "That pairing request is no longer waiting")
            if pending.expires_at <= now:
                raise PairingError("expired", "Code expired — show a new one on the Mac")
            self._codes.pop(pending.token_hash, None)  # single use: consumed now
            device_cookie = self._token()
            device = DeviceRecord(
                device_id=self._token(),
                label=pending.label,
                owner_login=pending.login,
                user_agent=pending.user_agent,
                approved_at=now,
                last_seen=now,
                cred_hash=hash_credential(device_cookie),
            )
            self.store.devices[device.device_id] = device
            self.store.save_devices()
            self._persisted_seen[device.device_id] = now
            session_cookie = self._new_session(device.device_id, now)
            pending.state = "approved"
            pending.device_id = device.device_id
            pending.device_cookie = device_cookie
            pending.session_cookie = session_cookie
            pending.deliver_until = now + 120
            self.store.audit("pairing_approved", device=device.device_id[:8], owner=device.owner_login)
        self._emit("sessions_changed")
        return device

    def deny(self, pending_id: str) -> None:
        with self._lock:
            pending = self._pending.get(pending_id)
            if pending is None or pending.state != "pending":
                return
            pending.state = "denied"
            self._codes.pop(pending.token_hash, None)
            self.store.audit("pairing_denied", pending=pending_id[:8])
        self._emit("pending_pairing")

    # --- sessions -----------------------------------------------------------

    def _new_session(self, device_id: str, now: float) -> str:
        cookie = self._token()
        mine = [(h, s) for h, s in self._sessions.items() if s.device_id == device_id]
        if len(mine) >= MAX_SESSIONS_PER_DEVICE:
            oldest = min(mine, key=lambda item: item[1].last_active)
            del self._sessions[oldest[0]]
        self._sessions[hash_credential(cookie)] = _Session(device_id, now, now)
        return cookie

    def _lookup_device(self, cookie: str, now: float) -> Optional[DeviceRecord]:
        wanted = hash_credential(cookie)
        for device in self.store.devices.values():
            if hmac.compare_digest(device.cred_hash, wanted):
                return device
            if (
                device.prev_cred_hash
                and now <= device.prev_valid_until
                and hmac.compare_digest(device.prev_cred_hash, wanted)
            ):
                return device
        return None

    def _device_reason(self, device: DeviceRecord, now: float) -> Optional[str]:
        """Why a device credential cannot be used, or ``None`` if it can."""
        if device.status == "disconnected":
            return "disconnected"
        if device.status == "revoked":
            return "revoked"
        if device.status == "expired":
            return "expired"
        if device.owner_login != self.owner_login:
            return "revoked"
        if now - device.approved_at > DEVICE_ABSOLUTE_TTL or now - device.last_seen > DEVICE_IDLE_TTL:
            device.status = "expired"
            device.status_at = now
            self._save_devices_quietly()
            return "expired"
        return None

    def _save_devices_quietly(self) -> None:
        try:
            self.store.save_devices()
        except OSError:
            pass

    def authenticate(
        self, session_cookie: Optional[str], device_cookie: Optional[str]
    ) -> AuthResult:
        with self._lock:
            now = self._clock()
            if session_cookie:
                key = hash_credential(session_cookie)
                session = self._sessions.get(key)
                if session is not None:
                    device = self.store.devices.get(session.device_id)
                    reason = self._device_reason(device, now) if device else "revoked"
                    if reason is None and now - session.last_active <= SESSION_IDLE_TTL:
                        session.last_active = now
                        self._touch_device(device, now)
                        return AuthResult(ok=True, device=device)
                    del self._sessions[key]
            if device_cookie:
                device = self._lookup_device(device_cookie, now)
                if device is not None:
                    reason = self._device_reason(device, now)
                    if reason is None:
                        return AuthResult(
                            ok=False, device=device, reason="session_expired", device_valid=True
                        )
                    return AuthResult(ok=False, reason=reason)
            return AuthResult(ok=False, reason="never_paired")

    def _touch_device(self, device: DeviceRecord, now: float) -> None:
        device.last_seen = now
        if now - self._persisted_seen.get(device.device_id, 0.0) >= LAST_SEEN_PERSIST_INTERVAL:
            self._persisted_seen[device.device_id] = now
            self._save_devices_quietly()

    def session_started_at(self, session_cookie: Optional[str]) -> Optional[float]:
        with self._lock:
            session = self._sessions.get(hash_credential(session_cookie or ""))
            return session.created_at if session is not None else None

    def renew_session(self, device_cookie: Optional[str]) -> Renewal:
        """New session and a rotated device credential for a valid device cookie."""
        with self._lock:
            now = self._clock()
            device = self._lookup_device(device_cookie, now) if device_cookie else None
            if device is None:
                raise PairingError("never_paired", "This phone isn't paired")
            reason = self._device_reason(device, now)
            if reason is not None:
                raise PairingError(reason, "This phone can't reconnect")
            presented = hash_credential(device_cookie or "")
            new_cookie = self._token()
            device.prev_cred_hash = presented
            device.prev_valid_until = now + ROTATION_GRACE
            device.cred_hash = hash_credential(new_cookie)
            device.rotation += 1
            device.last_seen = now
            self._persisted_seen[device.device_id] = now
            self.store.save_devices()
            session_cookie = self._new_session(device.device_id, now)
            self.store.audit("session_renewed", device=device.device_id[:8])
        self._emit("sessions_changed")
        return Renewal(device, new_cookie, session_cookie, self._csrf_for(device))

    def _csrf_for(self, device: Optional[DeviceRecord]) -> str:
        if device is None:
            return ""
        key = self.store.policy.csrf_key.encode("ascii")
        mac = hmac.new(key, device.device_id.encode("utf-8"), hashlib.sha256).digest()
        return _b64(mac)

    def csrf_token(self, device: DeviceRecord) -> str:
        return self._csrf_for(device)

    def check_csrf(self, device: Optional[DeviceRecord], presented: Optional[str]) -> bool:
        if device is None or not presented:
            return False
        return hmac.compare_digest(
            self._csrf_for(device).encode("utf-8"), presented.encode("utf-8")
        )

    # --- ending access ------------------------------------------------------

    def _drop_sessions(self, device_id: str) -> None:
        for key in [k for k, s in self._sessions.items() if s.device_id == device_id]:
            del self._sessions[key]
        self._streams.pop(device_id, None)

    def _revoke_where(self, predicate: Callable[[DeviceRecord], bool], why: str) -> List[str]:
        now = self._clock()
        revoked = []
        for device in self.store.devices.values():
            if device.status == "active" and predicate(device):
                device.status = "revoked"
                device.status_at = now
                self._drop_sessions(device.device_id)
                revoked.append(device.device_id)
                self.store.audit("device_revoked", device=device.device_id[:8], why=why)
        if revoked:
            self.store.save_devices()
        return revoked

    def disconnect(self, device_cookie: Optional[str]) -> Optional[DeviceRecord]:
        """The phone ends its own pairing."""
        with self._lock:
            now = self._clock()
            device = self._lookup_device(device_cookie, now) if device_cookie else None
            if device is None or device.status != "active":
                return None
            device.status = "disconnected"
            device.status_at = now
            self._drop_sessions(device.device_id)
            self.store.save_devices()
            self.store.audit("device_disconnected", device=device.device_id[:8])
        self._emit("sessions_changed")
        self._emit("device_ended", device_id=device.device_id, reason="disconnected")
        return device

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            revoked = self._revoke_where(lambda d: d.device_id == device_id, "mac_revoke")
        if revoked:
            self._emit("sessions_changed")
            self._emit("device_ended", device_id=device_id, reason="revoked")
        return bool(revoked)

    def revoke_all(self) -> List[str]:
        with self._lock:
            revoked = self._revoke_where(lambda d: True, "revoke_all")
            self._codes.clear()
            self._pending.clear()
            self._sessions.clear()
            self.store.policy.csrf_key = _b64(self._token_bytes(32))
            self.store.save_policy()
        self._emit("sessions_changed")
        for device_id in revoked:
            self._emit("device_ended", device_id=device_id, reason="revoked")
        return revoked

    def drop_all_sessions(self) -> None:
        """Remote View was turned off: sessions, codes and pending requests end.

        Remembered device approvals stay on disk and may open a new session once
        Remote View is back on.
        """
        with self._lock:
            self._sessions.clear()
            self._streams.clear()
            self._codes.clear()
            self._pending.clear()
        self._emit("sessions_changed")

    # --- presence -----------------------------------------------------------

    def stream_opened(self, device_id: str) -> None:
        with self._lock:
            self._streams[device_id] = self._streams.get(device_id, 0) + 1
        self._emit("sessions_changed")

    def stream_closed(self, device_id: str) -> None:
        with self._lock:
            count = self._streams.get(device_id, 0) - 1
            if count > 0:
                self._streams[device_id] = count
            else:
                self._streams.pop(device_id, None)
        self._emit("sessions_changed")

    def _is_connected(self, device: DeviceRecord, now: float) -> bool:
        sessions = [s for s in self._sessions.values() if s.device_id == device.device_id]
        if not sessions or all(now - s.last_active > SESSION_IDLE_TTL for s in sessions):
            return False
        if self._streams.get(device.device_id, 0) > 0:
            return True
        return any(now - s.last_active <= CONNECTED_WINDOW for s in sessions)

    def list_devices(self) -> List[dict]:
        with self._lock:
            now = self._clock()
            result = []
            for device in self.store.devices.values():
                if device.status != "active":
                    continue
                result.append(
                    {
                        "device_id": device.device_id,
                        "label": device.label,
                        "user_agent": device.user_agent,
                        "login": device.owner_login,
                        "approved_at": device.approved_at,
                        "last_seen": device.last_seen,
                        "connected": self._is_connected(device, now),
                    }
                )
            return sorted(result, key=lambda item: item["approved_at"])

    def connected_count(self) -> int:
        with self._lock:
            now = self._clock()
            return sum(
                1
                for device in self.store.devices.values()
                if device.status == "active" and self._is_connected(device, now)
            )
