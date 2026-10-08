import math
from datetime import datetime, timezone, tzinfo
from typing import Optional

from .types import AiFailure, AiFailureAction, AiFailureKind, Provider

_ACTIONS = {
    "not_installed": "open_providers", "incompatible_version": "open_providers",
    "signed_out": "sign_in", "usage_limit": "wait", "rate_limited": "retry",
    "timed_out": "retry", "network": "retry", "unusable_reply": "retry",
    "engine_error": "retry", "cancelled": "none", "ai_not_connected": "open_providers",
    "ai_off_for_project": "open_providers",
}
_PROVIDER = {"claude": "Claude", "chatgpt": "ChatGPT"}
_ENGINE = {"claude": "Claude Code", "chatgpt": "Codex"}


def provider_name(provider: Optional[Provider]) -> str:
    return _PROVIDER.get(provider, "AI")


def default_action(kind: AiFailureKind) -> AiFailureAction:
    return _ACTIONS[kind]


def _names(provider: Optional[Provider]):
    return (_PROVIDER.get(provider, "The AI"), _ENGINE.get(provider, "The AI"))


def format_failure(failure: AiFailure, now: datetime, tz: tzinfo) -> str:
    provider, engine = _names(failure.provider)
    kind = failure.kind
    if kind == "not_installed":
        return f"{engine} is not installed. Open Settings › Providers to download it."
    if kind == "incompatible_version":
        return f"{engine} is too old for this app. Update it, then press Check again in Settings › Providers."
    if kind == "signed_out":
        return f"{provider} is signed out. Sign in from Settings › Providers."
    if kind == "usage_limit":
        window = {"5h": "5-hour ", "weekly": "weekly "}.get(failure.window, "")
        prefix = f"{provider} {window}usage limit reached."
        if failure.resets_at:
            try:
                resets_at = datetime.fromisoformat(failure.resets_at.replace("Z", "+00:00"))
                current = now.astimezone(timezone.utc)
                seconds = (resets_at.astimezone(timezone.utc) - current).total_seconds()
                if seconds > 0:
                    if seconds <= 12 * 60 * 60:
                        return f"{prefix} It resets at {resets_at.astimezone(tz):%H:%M} — your earlier suggestions are kept."
                    hours = max(1, round(seconds / 3600))
                    return f"{prefix} It resets in about {hours} h — your earlier suggestions are kept."
            except (ValueError, TypeError):
                pass
        return f"{prefix} Your earlier suggestions are kept."
    if kind == "rate_limited":
        if failure.retry_after_sec is None:
            return f"{provider} is getting too many requests right now. Try again in a minute."
        seconds = max(0, math.ceil(failure.retry_after_sec))
        return f"{provider} is getting too many requests right now. Try again in {seconds} seconds."
    if kind == "timed_out":
        if failure.timeout_sec is None:
            return f"{provider} did not answer in time. Try again."
        if failure.timeout_sec < 60:
            duration = f"{max(1, round(failure.timeout_sec))} seconds"
        else:
            minutes = max(1, round(failure.timeout_sec / 60))
            duration = f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"
        return f"{provider} did not answer within {duration}. Try again."
    if kind == "network":
        return f"{provider} could not be reached. Check your internet connection and try again."
    if kind == "unusable_reply":
        return f"{provider} answered, but not in a form the app can use. Try again."
    if kind == "engine_error":
        return f"{engine} stopped with an error. Try again; if it keeps happening, open Settings › Diagnostics."
    if kind == "cancelled":
        return f"The {provider} request was cancelled."
    if kind == "ai_not_connected":
        return "No AI connected yet. Connect Claude or ChatGPT in Settings › AI."
    return "AI is off for this project. Turn it on in Settings › AI."


def make_failure(
    kind: AiFailureKind,
    provider: Optional[Provider],
    *,
    detail: Optional[str] = None,
    resets_at: Optional[str] = None,
    window: Optional[str] = None,
    retry_after_sec: Optional[float] = None,
    timeout_sec: Optional[float] = None,
    now: Optional[datetime] = None,
    tz: Optional[tzinfo] = None,
) -> AiFailure:
    failure = AiFailure(
        kind=kind, provider=provider, message="", action=default_action(kind), detail=detail,
        resets_at=resets_at, window=window, retry_after_sec=retry_after_sec, timeout_sec=timeout_sec,
    )
    return failure.model_copy(update={
        "message": format_failure(failure, now or datetime.now(timezone.utc), tz or datetime.now().astimezone().tzinfo)
    })
