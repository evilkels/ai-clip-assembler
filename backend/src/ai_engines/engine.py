import os
import signal
import subprocess
import time
from dataclasses import dataclass
from typing import Optional, Protocol, Union

from .types import AiFailure, AiReply, AiRequest, EngineStatus, Provider

REVIEW_TIMEOUT_SEC = 240.0
SCORING_TIMEOUT_PER_CLIP_SEC = 120.0
PING_TIMEOUT_SEC = 30.0


class AiEngine(Protocol):
    provider: Provider

    def status(self) -> EngineStatus: ...

    def sign_in(self) -> None: ...

    def run(self, request: AiRequest) -> Union[AiReply, AiFailure]: ...

    def usage(self) -> Optional[dict]: ...


@dataclass
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool
    elapsed_sec: float


def run_process(argv, cwd, env, timeout_sec, stdin_bytes=None) -> ProcessResult:
    started = time.monotonic()
    process = subprocess.Popen(
        argv,
        cwd=str(cwd),
        env=env,
        stdin=subprocess.PIPE if stdin_bytes is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(input=stdin_bytes, timeout=timeout_sec)
        timed_out = False
    except subprocess.TimeoutExpired:
        _kill_group(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            _kill_group(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
        timed_out = True
    return ProcessResult(
        returncode=process.returncode,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
        timed_out=timed_out,
        elapsed_sec=time.monotonic() - started,
    )


def _kill_group(pid: int, sig: int) -> None:
    # The child can exit between the deadline and the signal.
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass
