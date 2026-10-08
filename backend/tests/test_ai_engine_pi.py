import json
from pathlib import Path

import pytest

from src.ai_engines.pi import PiEngine
from src.ai_engines.types import AiFailure, AiReply, AiRequest
from support import fake_engine

def request(samples, timeout=2):
    samples.mkdir(parents=True, exist_ok=True)
    image = samples / "source.jpg"
    image.write_bytes(b"jpeg")
    return AiRequest(images=[image], samples_dir=samples, text="return data", schema={"type": "object", "required": ["message"]}, timeout_sec=timeout)


def run_case(tmp_path, scenario, timeout=2, reply=None):
    pi_bin, log = fake_engine(tmp_path, scenario, reply=reply)
    result = PiEngine(str(pi_bin), "openai-codex", "fake").run(request(tmp_path / "samples", timeout))
    return result, log


@pytest.mark.parametrize("scenario,kind", [
    ("signed_out", "signed_out"), ("usage_limit", "usage_limit"),
    ("rate_limited", "rate_limited"), ("network", "network"),
    ("hang", "timed_out"), ("garbage", "unusable_reply"), ("crash", "engine_error"),
    ("runs_command", "unusable_reply"),
])
def test_fake_engine_scenarios_are_classified(tmp_path, scenario, kind):
    result, _ = run_case(tmp_path, scenario, timeout=1 if scenario == "hang" else 2)
    assert isinstance(result, AiFailure)
    assert result.kind == kind
    if scenario == "usage_limit":
        assert result.resets_at
    if scenario == "rate_limited":
        assert result.retry_after_sec == 30
    if scenario == "hang":
        assert result.timeout_sec == 1


def test_missing_executable_is_not_installed(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    result = PiEngine(str(tmp_path / "missing-pi"), "openai-codex", "fake").run(request(samples))
    assert isinstance(result, AiFailure) and result.kind == "not_installed"


def test_success_parses_json_reply(tmp_path):
    result, _ = run_case(tmp_path, "ok")
    assert isinstance(result, AiReply)
    assert result.data == {"message": "OK", "operations": []}


def test_argv_is_locked_down(tmp_path):
    result, log_path = run_case(tmp_path, "ok")
    record = json.loads(log_path.read_text().splitlines()[0])
    argv = record["argv"]
    assert argv[argv.index("--tools") + 1] == ""
    assert "read" not in argv[argv.index("--tools") + 1:]
    assert all(arg == "@frame-01.jpg" for arg in argv if arg.startswith("@"))
    scratch = Path(record["cwd"])
    assert isinstance(result, AiReply)
    assert record["cwd_listing"] == ["frame-01.jpg"]
    assert record["opened"] == [str(scratch / "frame-01.jpg")]
    assert all(not Path(arg).is_absolute() or Path(arg).is_relative_to(scratch) for arg in argv)
    # The wrapper adds the fake's own controls; /bin/sh, macOS and Python's
    # locale coercion (PEP 538, LC_CTYPE) add the rest.
    shell_added = {"ACA_FAKE_ENGINE", "ACA_FAKE_ENGINE_LOG", "PWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING", "LC_CTYPE"}
    assert set(record["env_keys"]) - shell_added == {"PATH", "HOME"}
    assert not scratch.exists()


def test_reply_mentioning_failure_words_is_still_a_reply(tmp_path):
    reply = '{"message": "Cut the timeout shot; the rate limit sign is distracting"}'
    result, _ = run_case(tmp_path, "ok", reply=reply)
    assert isinstance(result, AiReply)
    assert result.data["message"].startswith("Cut the timeout shot")
