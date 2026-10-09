import hashlib
import math
import shlex
import sys
from pathlib import Path
from typing import Optional

FAKE_ENGINES = Path(__file__).parent / "fixtures" / "engines"


class FakeEmbeddingProvider:
    def __init__(self, dim: int = 32):
        self.dim = dim

    def embed_images(self, paths: list[str]) -> list[list[float]]:
        return [self._embed_path(path) for path in paths]

    def _embed_path(self, path: str) -> list[float]:
        with open(path, "rb") as image_file:
            digest = hashlib.sha256(image_file.read()).digest()
        vector = [float(digest[index % len(digest)]) for index in range(self.dim)]
        norm = math.sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm else []


def fake_engine(
    tmp_path: Path, scenario: str = "ok", name: str = "pi", reply: Optional[str] = None
) -> tuple[Path, Path]:
    """Write an executable that runs the fake *name* engine in *scenario*.

    Engines start their program with a stripped environment, so the scenario
    travels inside the wrapper rather than through the test's environment.
    Returns the wrapper path and the JSON-lines call log the fake appends to.
    """
    log = tmp_path / f"{name}-calls.jsonl"
    controls = {"ACA_FAKE_ENGINE": scenario, "ACA_FAKE_ENGINE_LOG": str(log)}
    if reply is not None:
        controls["ACA_FAKE_REPLY"] = reply
    exports = "".join(f"export {key}={shlex.quote(value)}\n" for key, value in controls.items())
    wrapper = tmp_path / f"fake-{name}-bin" / name
    wrapper.parent.mkdir(parents=True, exist_ok=True)
    wrapper.write_text(
        f"#!/bin/sh\n{exports}exec {shlex.quote(sys.executable)} "
        f"{shlex.quote(str(FAKE_ENGINES / name))} \"$@\"\n"
    )
    wrapper.chmod(0o755)
    return wrapper, log
