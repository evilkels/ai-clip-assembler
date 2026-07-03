import sys
from importlib import util
from pathlib import Path


ENTRY_PATH = Path(__file__).resolve().parents[1] / "packaging" / "entry.py"
ENTRY_SPEC = util.spec_from_file_location("backend_packaging_entry", ENTRY_PATH)
assert ENTRY_SPEC is not None and ENTRY_SPEC.loader is not None
entry = util.module_from_spec(ENTRY_SPEC)
ENTRY_SPEC.loader.exec_module(entry)


def test_packaged_backend_uses_environment_port(monkeypatch):
    calls = []
    monkeypatch.setenv("CLIP_ASSEMBLER_PORT", "8765")
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))

    entry.main()

    assert calls == [(("src.api:app",), {"host": "127.0.0.1", "port": 8765, "log_level": "info"})]


def test_packaged_backend_runs_mcp_stdio_with_runtime_file(monkeypatch):
    calls = []
    monkeypatch.setattr(sys, "argv", ["ai-clip-backend", "--mcp-stdio", "--runtime-file", "/tmp/runtime.json"])
    monkeypatch.setattr("src.mcp_bridge.run_mcp_stdio", lambda runtime_file: calls.append(runtime_file))

    entry.main()

    assert calls == ["/tmp/runtime.json"]
