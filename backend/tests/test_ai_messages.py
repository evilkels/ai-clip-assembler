from datetime import datetime, timezone
import re
from zoneinfo import ZoneInfo

import pytest

from src.ai_engines.messages import format_failure, make_failure
from src.ai_engines.types import AiFailure


KINDS = [
    "not_installed", "incompatible_version", "signed_out", "usage_limit",
    "rate_limited", "timed_out", "network", "unusable_reply", "engine_error",
    "cancelled", "ai_not_connected", "ai_off_for_project",
]
EXPECTED_ACTIONS = {
    "not_installed": "open_providers",
    "incompatible_version": "open_providers",
    "signed_out": "sign_in",
    "usage_limit": "wait",
    "rate_limited": "retry",
    "timed_out": "retry",
    "network": "retry",
    "unusable_reply": "retry",
    "engine_error": "retry",
    "cancelled": "none",
    "ai_not_connected": "open_providers",
    "ai_off_for_project": "open_providers",
}


@pytest.mark.parametrize("provider", ["claude", "chatgpt"])
@pytest.mark.parametrize("kind", KINDS)
def test_each_failure_has_provider_specific_copy_and_default_action(kind, provider):
    failure = make_failure(kind, provider, now=datetime(2026, 1, 1, tzinfo=timezone.utc), tz=timezone.utc)

    assert failure.message
    assert failure.action == EXPECTED_ACTIONS[kind]
    display_name = {"claude": "Claude Code" if kind in {"not_installed", "incompatible_version", "engine_error"} else "Claude", "chatgpt": "Codex" if kind in {"not_installed", "incompatible_version", "engine_error"} else "ChatGPT"}[provider]
    assert display_name in failure.message or kind in {"ai_not_connected", "ai_off_for_project"}
    assert not any(word in failure.message.lower() for word in ["harness", "pi", "consent", "model"])


def test_usage_limit_formats_local_reset_and_window():
    now = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    failure = make_failure(
        "usage_limit", "chatgpt", resets_at="2026-01-01T11:30:00+00:00", window="5h",
        now=now, tz=ZoneInfo("Europe/Riga"),
    )

    assert failure.message == "ChatGPT 5-hour usage limit reached. It resets at 13:30 — your earlier suggestions are kept."


def test_usage_limit_formats_far_unknown_and_past_resets():
    now = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    far = make_failure("usage_limit", "claude", resets_at="2026-01-02T10:00:00+00:00", now=now, tz=timezone.utc)
    unknown = make_failure("usage_limit", "claude", now=now, tz=timezone.utc)
    past = make_failure("usage_limit", "claude", resets_at="2026-01-01T09:00:00+00:00", now=now, tz=timezone.utc)

    assert "resets in about 24 h" in far.message
    assert "It resets" not in unknown.message
    assert "It resets" not in past.message


def test_failure_details_are_sanitized_and_limited():
    failure = make_failure("engine_error", "claude", detail="  failed   at /private/user/project/file.py  " + "x" * 600)

    assert "/private/user/project" not in failure.detail
    assert failure.detail.startswith("failed at file.py")
    assert len(failure.detail) <= 500


def test_no_failure_message_exposes_internal_terms_for_supported_fields():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    values = [
        {},
        {"detail": "/private/path/secret.txt"},
        {"resets_at": "2026-01-01T11:00:00Z", "window": "5h"},
        {"resets_at": "2026-01-02T11:00:00Z", "window": "weekly"},
        {"retry_after_sec": 30},
        {"timeout_sec": 120},
    ]
    for kind in KINDS:
        providers = [None] if kind in {"ai_not_connected", "ai_off_for_project"} else ["claude", "chatgpt"]
        for provider in providers:
            for fields in values:
                failure = make_failure(kind, provider, now=now, tz=timezone.utc, **fields)
                assert not re.search(r"harness|\bPi\b|consent|model", failure.message, re.IGNORECASE)


def test_format_failure_uses_supplied_timezone():
    failure = AiFailure(kind="usage_limit", provider="chatgpt", message="", action="wait", resets_at="2026-01-01T11:00:00Z")
    assert "13:00" in format_failure(failure, datetime(2026, 1, 1, 10, tzinfo=timezone.utc), ZoneInfo("Europe/Riga"))
