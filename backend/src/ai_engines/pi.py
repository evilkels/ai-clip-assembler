import json
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from .engine import run_process
from .messages import make_failure
from .payload import staged
from .types import AiReply, AiRequest, EngineStatus


def parse_json_object(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:-1] if lines and lines[-1].strip().startswith("```") else lines[1:]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])
    if isinstance(parsed, list):
        if not parsed:
            raise ValueError("Empty JSON array")
        parsed = parsed[0]
    if not isinstance(parsed, dict):
        raise ValueError("Expected a JSON object")
    return parsed


def classify_pi_error(text: str) -> Tuple[str, dict]:
    lowered = text.lower()
    if re.search(
        r'no api key (?:found for "?|for provider: )\S+|provider is not configured|token refresh failed \(401\)|failed to extract accountid from token|authentication failed for ',
        lowered,
    ):
        return "signed_out", {}
    if re.search(
        r"you have hit your chatgpt usage limit|usage_limit_reached|usage_not_included", lowered
    ):
        match = re.search(r"try again in ~?(\d+) min", text, re.IGNORECASE)
        extra = {}
        if match:
            reset = datetime.now(timezone.utc) + timedelta(minutes=int(match.group(1)))
            extra["resets_at"] = reset.replace(microsecond=0).isoformat()
        return "usage_limit", extra
    if re.search(r"rate.?limit|too many requests|\b429\b", lowered):
        match = re.search(r"Server requested (\d+)s retry delay", text, re.IGNORECASE)
        return "rate_limited", {"retry_after_sec": float(match.group(1))} if match else {}
    if re.search(r"timed? out|timeout", lowered):
        return "timed_out", {}
    if re.search(
        r"fetch failed|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|network.?error|connection.?(error|refused|lost)|socket hang up|websocket.?(error|closed)",
        text,
        re.IGNORECASE,
    ):
        return "network", {}
    return "engine_error", {"detail": text}


class PiEngine:
    def __init__(self, pi_bin: str, pi_provider: str, pi_model: str):
        self.pi_bin = pi_bin
        self.pi_provider = pi_provider
        self.pi_model = pi_model
        self.provider = "claude" if pi_provider.startswith("anthropic") else "chatgpt"

    @property
    def cache_identity(self) -> str:
        return f"{self.pi_provider}/{self.pi_model}"

    def run(self, request: AiRequest):
        with staged(request) as staged_request:
            prompt = (
                request.text
                + "\n\nRespond with ONLY one JSON object and nothing else. It must match this JSON Schema:\n"
                + json.dumps(request.schema_)
            )
            argv = [
                self.pi_bin,
                "--provider",
                self.pi_provider,
                "--model",
                self.pi_model,
                "--print",
                "--mode",
                "text",
                "--no-session",
                "--no-context-files",
                "--no-skills",
                "--no-extensions",
                "--tools",
                "",
                *[f"@{name}" for name in staged_request.names],
                prompt,
            ]
            env = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")}
            try:
                result = run_process(argv, staged_request.cwd, env, request.timeout_sec)
            except (FileNotFoundError, PermissionError):
                return make_failure("not_installed", self.provider)
            if result.timed_out:
                return make_failure("timed_out", self.provider, timeout_sec=request.timeout_sec)
            combined = (result.stderr + "\n" + result.stdout).strip()
            if result.returncode != 0 or not result.stdout.strip():
                kind, extra = classify_pi_error(combined)
                return make_failure(kind, self.provider, **extra)
            try:
                data = parse_json_object(result.stdout)
                required = request.schema_.get("required", [])
                if any(key not in data for key in required):
                    raise ValueError("Missing required response key")
            except (ValueError, json.JSONDecodeError):
                return make_failure("unusable_reply", self.provider)
            return AiReply(
                provider=self.provider,
                data=data,
                raw_text=result.stdout,
                elapsed_sec=result.elapsed_sec,
            )

    def status(self) -> EngineStatus:
        path = shutil.which(self.pi_bin)
        if path is None and os.path.isfile(self.pi_bin) and os.access(self.pi_bin, os.X_OK):
            path = self.pi_bin
        if not path:
            return EngineStatus(
                provider=self.provider, installed=False, signed_in=False, ready=False
            )
        version = None
        try:
            result = run_process(
                [self.pi_bin, "--version"],
                ".",
                {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")},
                5,
            )
            if not result.timed_out and result.returncode == 0 and result.stdout.strip():
                version = result.stdout.strip().split()[0]
        except (FileNotFoundError, PermissionError):
            pass
        return EngineStatus(
            provider=self.provider,
            installed=True,
            version=version,
            path=path,
            signed_in=True,
            ready=True,
        )

    def sign_in(self) -> None:
        raise NotImplementedError

    def usage(self) -> Optional[dict]:
        return None
