#!/usr/bin/env python3
"""Verify that a packaged backend can run one Timeline script."""

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {Path(sys.argv[0]).name} BACKEND_BINARY", file=sys.stderr)
        return 2

    request = {
        "document": {
            "revision": 1,
            "items": [
                {
                    "item_id": "item-1",
                    "source_clip_id": "clip-1",
                    "start_sec": 0,
                    "end_sec": 8,
                    "speed": 1,
                }
            ],
            "decisions": {"clip-1": "included"},
        },
        "sources": {
            "clip-1": {
                "clip_id": "clip-1",
                "start_sec": 0,
                "end_sec": 8,
                "source_duration_sec": 8,
            }
        },
        "library": [
            {
                "clip_id": "clip-1",
                "file_name": "clip-1.mp4",
                "start_sec": 0,
                "end_sec": 8,
                "overall_score": 1,
                "smoothness_score": 8,
            }
        ],
        "source": 'log("worker ok") timeline:item(1):set_speed(2)',
        "id_seed": "packaged-worker-check",
        "limits": {},
    }
    completed = subprocess.run(
        [sys.argv[1], "--script-worker"],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        print(completed.stderr, file=sys.stderr)
        return completed.returncode or 1

    lines = completed.stdout.splitlines()
    try:
        message = json.loads(lines[-1])
        if not isinstance(message, dict) or set(message) != {"result"}:
            raise ValueError("last worker line is not a result object")
        result = message["result"]
        if not isinstance(result, dict):
            raise ValueError("worker result is not an object")
    except (IndexError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        print(f"Worker did not end with a result JSON object: {exc}", file=sys.stderr)
        print(completed.stdout, file=sys.stderr)
        return 1

    if result.get("error") is not None or len(result.get("operations", [])) != 1:
        print(f"Unexpected worker result: {json.dumps(result)}", file=sys.stderr)
        return 1
    print(json.dumps({"result": {"error": result["error"], "operations": len(result["operations"]), "log": result["log"]}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
