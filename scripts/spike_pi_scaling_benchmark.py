#!/usr/bin/env python3
"""SPIKE — not production code (plan 002, pi-harness scaling).

Measures real per-call latency and parse-failure rate of the pi-CLI scoring
harness for two prompt variants:

  - per-clip:  one `pi` invocation per clip, 4 frames, single-JSON-object prompt
               (the production shape, via `pi_cli_harness._call_pi_cli`).
  - batched:   one `pi` invocation for 2 clips × 4 frames, JSON-array prompt
               (built here; the harness is NOT modified — we run our own
               subprocess to capture the raw array output).

Run from the repo root:

    backend/.venv/bin/python scripts/spike_pi_scaling_benchmark.py

Exit 0 on success (prints a summary table). Exits non-zero (STOP) if `pi` is
unauthenticated / every call fails. Delete this script when the follow-up
implementation plan lands — it pins a prompt format that will drift.
"""

import json
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from PIL import Image, ImageDraw  # noqa: E402

from src.pi_cli_harness import (  # noqa: E402
    DEFAULT_PROMPT_TEMPLATE,
    PI_BIN,
    PI_MODEL,
    PI_PROVIDER,
    PiCliUnavailableError,
    _build_prompt,
    _call_pi_cli,
)

PER_CLIP_RUNS = 5
FRAMES_PER_CLIP = 4
BATCH_CLIPS = 2
BATCH_RUNS = 2
CALL_TIMEOUT_SEC = 120

BATCH_PROMPT_TEMPLATE = (
    "You are a drone-video quality analyst. Use your read tool to view these "
    "{frame_count} frame image(s). They are sampled from "
    f"{BATCH_CLIPS} DIFFERENT candidate clips, {FRAMES_PER_CLIP} frames per clip "
    "in order (clip 0 first, then clip 1):\n"
    "{frame_list}\n"
    "Judge each clip as a whole and score it 0-10 for smoothness/stability and "
    "visual_interest. Respond with ONLY a JSON array of "
    f"{BATCH_CLIPS} objects and nothing else, in this exact format: "
    '[{"clip": 0, "smoothness": N, "visual_interest": N, "reason": "..."}, '
    '{"clip": 1, "smoothness": N, "visual_interest": N, "reason": "..."}]'
)


def make_frames(directory: Path, count: int) -> list[str]:
    """Generate distinct 960px JPEGs so the model has something to look at."""
    paths = []
    for index in range(count):
        image = Image.new("RGB", (960, 540), (20 + index * 12 % 200, 60, 120))
        draw = ImageDraw.Draw(image)
        for step in range(0, 960, 40):
            shade = (step + index * 30) % 255
            draw.line([(step, 0), (step - 200, 540)], fill=(shade, 255 - shade, 90), width=6)
        draw.ellipse([300 + index * 20, 150, 660 + index * 20, 420], outline=(255, 255, 255), width=8)
        path = directory / f"frame_{index:02d}.jpg"
        image.save(path, "JPEG", quality=85)
        paths.append(str(path))
    return paths


def run_batched(frame_paths: list[str]) -> tuple[float, bool]:
    """One pi invocation for BATCH_CLIPS clips; returns (latency, parsed_ok)."""
    prompt = _build_prompt(frame_paths, BATCH_PROMPT_TEMPLATE)
    command = [
        PI_BIN, "--provider", PI_PROVIDER, "--model", PI_MODEL,
        "--print", "--mode", "text", "--no-session", "--no-context-files",
        "--no-skills", "--no-extensions", "--tools", "read",
        *[f"@{path}" for path in frame_paths], prompt,
    ]
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command, capture_output=True, stdin=subprocess.DEVNULL, text=True,
            timeout=CALL_TIMEOUT_SEC, cwd=str(REPO_ROOT),
        )
    except (subprocess.TimeoutExpired, OSError):
        return time.monotonic() - started, False
    latency = time.monotonic() - started
    raw = (completed.stdout or "").strip()
    start, end = raw.find("["), raw.rfind("]")
    if completed.returncode != 0 or start == -1 or end == -1:
        return latency, False
    try:
        parsed = json.loads(raw[start : end + 1])
        ok = isinstance(parsed, list) and len(parsed) == BATCH_CLIPS
    except (json.JSONDecodeError, ValueError):
        ok = False
    return latency, ok


def p95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(values, n=20)[-1]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="pi-scaling-bench-") as tmp:
        directory = Path(tmp)
        all_frames = make_frames(directory, FRAMES_PER_CLIP * BATCH_CLIPS)
        clip_frames = all_frames[:FRAMES_PER_CLIP]

        print(f"pi: provider={PI_PROVIDER} model={PI_MODEL}")
        print(f"per-clip: {PER_CLIP_RUNS} runs × {FRAMES_PER_CLIP} frames\n")

        per_clip_latencies: list[float] = []
        per_clip_failures = 0
        for run in range(PER_CLIP_RUNS):
            started = time.monotonic()
            try:
                _call_pi_cli(clip_frames, DEFAULT_PROMPT_TEMPLATE, timeout_sec=CALL_TIMEOUT_SEC)
                latency = time.monotonic() - started
                ok = True
            except PiCliUnavailableError as exc:
                latency = time.monotonic() - started
                ok = False
                print(f"  run {run + 1}: FAIL after {latency:.1f}s — {str(exc)[:120]}")
            if ok:
                print(f"  run {run + 1}: ok in {latency:.1f}s")
            per_clip_latencies.append(latency)
            if not ok:
                per_clip_failures += 1

        print(f"\nbatched: {BATCH_RUNS} runs × {BATCH_CLIPS} clips ({FRAMES_PER_CLIP} frames each)\n")
        batch_latencies: list[float] = []
        batch_failures = 0
        for run in range(BATCH_RUNS):
            latency, ok = run_batched(all_frames)
            print(f"  run {run + 1}: {'ok' if ok else 'FAIL'} in {latency:.1f}s")
            batch_latencies.append(latency)
            if not ok:
                batch_failures += 1

        per_clip_ok = PER_CLIP_RUNS - per_clip_failures
        batch_ok = BATCH_RUNS - batch_failures
        if per_clip_ok == 0 and batch_ok == 0:
            print("\nAll benchmark calls failed — is `pi` authenticated? STOP.", file=sys.stderr)
            return 1

        ok_latencies = [
            latency for latency, idx in zip(per_clip_latencies, range(PER_CLIP_RUNS))
        ]
        mean_per_clip = statistics.mean(per_clip_latencies) if per_clip_latencies else 0.0
        batch_effective = (
            statistics.mean(batch_latencies) / BATCH_CLIPS if batch_latencies else 0.0
        )

        print("\n=== Summary ===")
        print(f"{'variant':<18}{'mean/clip':>12}{'p95/clip':>12}{'parse-fail':>12}")
        print(
            f"{'per-clip':<18}{f'{mean_per_clip:.1f}s':>12}"
            f"{f'{p95(per_clip_latencies):.1f}s':>12}"
            f"{f'{per_clip_failures}/{PER_CLIP_RUNS}':>12}"
        )
        print(
            f"{f'batched (k={BATCH_CLIPS})':<18}{f'{batch_effective:.1f}s':>12}"
            f"{f'{p95(batch_latencies) / BATCH_CLIPS:.1f}s':>12}"
            f"{f'{batch_failures}/{BATCH_RUNS}':>12}"
        )
        _ = ok_latencies
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
