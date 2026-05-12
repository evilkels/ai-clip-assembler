#!/usr/bin/env python3
"""Run a local backend smoke test against a real drone video."""

import argparse
import json
import mimetypes
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


def post_json(url: str, payload: Optional[dict] = None) -> dict:
    body = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body if payload is not None else b"",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def upload_file(url: str, field_name: str, path: Path) -> dict:
    boundary = "----ai-clip-assembler-smoke-test"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    file_bytes = path.read_bytes()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{path.name}"\r\n'
            ).encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            file_bytes,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def format_score(value: object) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):.2f}"
    return "n/a"


def format_seconds(value: object) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value):.3f}s"
    return "n/a"


def format_analysis_summary(analysis: dict) -> list[str]:
    clips = analysis.get("clips", [])
    total_duration = (analysis.get("sequence") or {}).get("total_duration_sec")
    lines = [f"Candidate clips: {len(clips)}"]
    if isinstance(total_duration, (int, float)):
        lines.append(f"Timeline duration: {float(total_duration):.1f}s")

    if clips:
        lines.append("Clips:")
    for index, clip in enumerate(clips, start=1):
        lines.append(
            f"  {index}. {format_seconds(clip.get('start_sec'))} -> "
            f"{format_seconds(clip.get('end_sec'))} "
            f"({format_seconds(clip.get('duration_sec'))}), "
            f"overall {format_score(clip.get('overall_score'))}, "
            f"smoothness {format_score(clip.get('smoothness_score'))}"
        )
        reason = clip.get("ai_reason")
        if reason:
            lines.append(f"     reason: {reason}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video_path", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--sample-fps", type=float, default=1.0)
    args = parser.parse_args()

    if not args.video_path.exists():
        print(f"Video not found: {args.video_path}", file=sys.stderr)
        return 2

    try:
        project = post_json(f"{args.base_url}/projects")
        project_id = project["project_id"]
        print(f"Project: {project_id}")

        upload = upload_file(
            f"{args.base_url}/projects/{project_id}/videos",
            "file",
            args.video_path,
        )
        print("Upload:")
        print(json.dumps(upload, indent=2))

        analysis = post_json(
            f"{args.base_url}/projects/{project_id}/analyze",
            {
                "project_id": project_id,
                "harness_id": "manual",
                "preferences": {
                    "sample_fps": args.sample_fps,
                    "smoothness_threshold": 7,
                    "min_clip_duration_sec": 3,
                    "max_clip_duration_sec": 15,
                    "target_duration_sec": 120,
                },
            },
        )
        print("\n".join(format_analysis_summary(analysis)))

        for export_format in ["edl", "fcpxml"]:
            export = post_json(f"{args.base_url}/projects/{project_id}/export?format={export_format}")
            print(f"{export_format.upper()} export: {export['file_path']}")
    except urllib.error.HTTPError as exc:
        print(exc.read().decode("utf-8"), file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Could not reach backend at {args.base_url}: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
