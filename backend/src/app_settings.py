"""Runtime-editable application settings.

The AI model configuration (pi provider, model, per-call timeout) historically
came from environment variables read once at import time. This module turns
those into runtime-editable settings: environment variables provide the
defaults, an optional JSON file persists user overrides, and the merged view is
read fresh on every call so edits made through the UI take effect without a
backend restart.

The non-editable ``pi_bin`` (path to the executable) stays env-only — it is
surfaced for diagnostics but not changeable from the app.
"""

import json
import os
import threading
from pathlib import Path
from typing import Optional

# Persisted alongside project state (relative to the backend working directory,
# matching how PROJECTS_DIR is rooted).
SETTINGS_FILE = Path(".ai-clip-assembler/settings.json")

# Keys the UI is allowed to change and persist.
EDITABLE_KEYS = ("pi_provider", "pi_model", "pi_timeout_sec")

_lock = threading.Lock()
_overrides: Optional[dict] = None


def _env_defaults() -> dict:
    """Default settings sourced from environment variables."""
    return {
        "pi_bin": os.environ.get("PI_BIN", "pi"),
        "pi_provider": os.environ.get("PI_PROVIDER", "openai-codex"),
        "pi_model": os.environ.get("PI_MODEL", "gpt-5.4-mini"),
        "pi_timeout_sec": float(os.environ.get("PI_TIMEOUT_SEC", "180")),
    }


def _load_overrides() -> dict:
    """Read persisted overrides from disk once, caching the result."""
    global _overrides
    if _overrides is None:
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            _overrides = data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            _overrides = {}
    return _overrides


def _coerce(key: str, value):
    """Coerce a raw override value to the type its default uses."""
    if key == "pi_timeout_sec":
        return float(value)
    return str(value)


def get_settings() -> dict:
    """Return the merged settings (env defaults overlaid with persisted edits)."""
    merged = _env_defaults()
    for key, value in _load_overrides().items():
        if key in EDITABLE_KEYS and value is not None:
            try:
                merged[key] = _coerce(key, value)
            except (TypeError, ValueError):
                continue
    return merged


def update_settings(changes: dict) -> dict:
    """Validate, persist, and apply *changes*; return the new merged settings."""
    global _overrides
    with _lock:
        overrides = dict(_load_overrides())
        for key in EDITABLE_KEYS:
            if key not in changes or changes[key] is None:
                continue
            value = _coerce(key, changes[key])
            if key in ("pi_provider", "pi_model") and not value.strip():
                raise ValueError(f"{key} must not be blank")
            if key == "pi_timeout_sec" and value <= 0:
                raise ValueError("pi_timeout_sec must be greater than 0")
            overrides[key] = value
        _overrides = overrides
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(
            json.dumps(overrides, indent=2) + "\n", encoding="utf-8"
        )
    return get_settings()
