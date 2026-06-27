"""Tests for runtime-editable application settings.

Settings merge environment-variable defaults with a persisted JSON override
file, read fresh per call so UI edits apply without a backend restart.
"""

import json

import pytest

from src import app_settings


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Point the override file at a temp path and clear the cached overrides."""
    monkeypatch.setattr(app_settings, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(app_settings, "_overrides", None)
    yield


def test_defaults_come_from_env(monkeypatch):
    monkeypatch.setenv("PI_PROVIDER", "openai-codex")
    monkeypatch.setenv("PI_MODEL", "gpt-5.4-mini")
    monkeypatch.setenv("PI_TIMEOUT_SEC", "180")
    settings = app_settings.get_settings()
    assert settings["pi_provider"] == "openai-codex"
    assert settings["pi_model"] == "gpt-5.4-mini"
    assert settings["pi_timeout_sec"] == 180.0


def test_update_persists_and_overrides_defaults():
    updated = app_settings.update_settings({"pi_model": "gpt-5.4", "pi_timeout_sec": 90})
    assert updated["pi_model"] == "gpt-5.4"
    assert updated["pi_timeout_sec"] == 90.0
    # The override file holds only the edited keys.
    saved = json.loads(app_settings.SETTINGS_FILE.read_text(encoding="utf-8"))
    assert saved == {"pi_model": "gpt-5.4", "pi_timeout_sec": 90.0}


def test_persisted_overrides_survive_cache_reset(monkeypatch):
    app_settings.update_settings({"pi_provider": "anthropic"})
    # Simulate a fresh process: drop the in-memory cache, reload from disk.
    monkeypatch.setattr(app_settings, "_overrides", None)
    assert app_settings.get_settings()["pi_provider"] == "anthropic"


def test_timeout_is_coerced_to_float():
    settings = app_settings.update_settings({"pi_timeout_sec": "120"})
    assert settings["pi_timeout_sec"] == 120.0


def test_non_editable_keys_are_ignored():
    app_settings.update_settings({"pi_bin": "/usr/local/bin/pi"})  # type: ignore[arg-type]
    saved = json.loads(app_settings.SETTINGS_FILE.read_text(encoding="utf-8"))
    assert "pi_bin" not in saved


@pytest.mark.parametrize(
    "changes",
    [
        {"pi_provider": "   "},
        {"pi_model": ""},
        {"pi_timeout_sec": 0},
        {"pi_timeout_sec": -5},
    ],
)
def test_invalid_values_raise(changes):
    with pytest.raises(ValueError):
        app_settings.update_settings(changes)


def test_corrupt_override_file_falls_back_to_defaults():
    app_settings.SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    app_settings.SETTINGS_FILE.write_text("not json", encoding="utf-8")
    # Should not raise; merged view is just the env defaults.
    assert "pi_model" in app_settings.get_settings()
