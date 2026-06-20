#!/usr/bin/env python3
"""End-to-end QA for the drone clip workflow using synthetic footage.

Answers `docs/plans/drone-workflow-qa-flows.md` open question 1:
a repeatable fixture that exercises the full pipeline without private footage.

Generates three synthetic videos (smooth hover, shaky jitter, mixed) and
drives the real backend in-process — real FFmpeg vidstab, frame extraction,
OpenCV scoring, scene detection — through the full folder workflow:

    create project from folder -> analyze (manual harness) -> review/trim ->
    export EDL + FCPXML + DaVinci XML -> close + reopen project

Run from the repo root:

    backend/.venv/bin/python scripts/synthetic_e2e_qa.py [--keep] [--folder PATH]

Exit code 0 means every check passed.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src import api  # noqa: E402

FPS = 30
WIDTH, HEIGHT = 1280, 720
SMOOTH_DURATION_SEC = 12
MIXED_SMOOTH_SEC = 8
MIXED_TOTAL_SEC = 16
JITTER_PX = 80

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"  [{PASS if condition else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


def run_ffmpeg(args: list[str]) -> None:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")


def generate_footage(folder: Path) -> None:
    """Three clips cropped from one large noise image.

    Noise decorrelates completely under any shift, so a static crop reads as
    a perfectly smooth hover while per-frame jitter reads as severe shake —
    a deterministic stand-in for stable vs shaky drone footage.
    """
    rng = np.random.default_rng(seed=42)
    canvas_height = HEIGHT + 2 * JITTER_PX + 200
    canvas_width = WIDTH + 2 * JITTER_PX + 200
    # Coarse binary blocks (8px) survive x264 quantization and the analysis
    # downscale; fine-grained noise gets averaged away and reads as "smooth".
    block = 8
    coarse = rng.integers(0, 2, size=(canvas_height // block + 1, canvas_width // block + 1), dtype=np.uint8) * 255
    gray = cv2.resize(coarse, (canvas_width, canvas_height), interpolation=cv2.INTER_NEAREST)
    canvas = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    noise_png = folder / "noise.png"
    cv2.imwrite(str(noise_png), canvas)

    common = ["-r", str(FPS), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
    center = f"{JITTER_PX + 100}"
    jitter_x = f"{JITTER_PX + 100}+(random(1)*2-1)*{JITTER_PX}"
    jitter_y = f"{JITTER_PX + 100}+(random(2)*2-1)*{JITTER_PX}"

    run_ffmpeg([
        "-loop", "1", "-i", str(noise_png), "-t", str(SMOOTH_DURATION_SEC),
        "-vf", f"crop={WIDTH}:{HEIGHT}:{center}:{center}",
        *common, str(folder / "hover_smooth.mp4"),
    ])
    run_ffmpeg([
        "-loop", "1", "-i", str(noise_png), "-t", str(SMOOTH_DURATION_SEC),
        "-vf", f"crop={WIDTH}:{HEIGHT}:x='{jitter_x}':y='{jitter_y}'",
        *common, str(folder / "jitter_shaky.mp4"),
    ])
    run_ffmpeg([
        "-loop", "1", "-i", str(noise_png), "-t", str(MIXED_TOTAL_SEC),
        "-vf", (
            f"crop={WIDTH}:{HEIGHT}"
            f":x='if(lt(t,{MIXED_SMOOTH_SEC}),{center},{jitter_x})'"
            f":y='if(lt(t,{MIXED_SMOOTH_SEC}),{center},{jitter_y})'"
        ),
        *common, str(folder / "mixed_smooth_then_shaky.mp4"),
    ])
    noise_png.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--folder", type=Path, default=None, help="Project folder to use (default: temp dir)")
    parser.add_argument("--keep", action="store_true", help="Keep the project folder after the run")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("ffmpeg not found in PATH", file=sys.stderr)
        return 2

    temp_root = None
    if args.folder:
        folder = args.folder.expanduser().resolve()
        folder.mkdir(parents=True, exist_ok=True)
    else:
        temp_root = Path(tempfile.mkdtemp(prefix="clip-assembler-qa-"))
        folder = temp_root / "synthetic-drone-footage"
        folder.mkdir()

    print(f"Project folder: {folder}")
    print("Generating synthetic footage (smooth hover / shaky jitter / mixed)…")
    generate_footage(folder)

    client = TestClient(api.app)
    api.projects.clear()

    print("\nFlow: create project from folder")
    created = client.post("/projects/from-folder", json={"folder_path": str(folder)})
    check("create project from folder", created.status_code == 200, f"status {created.status_code}")
    project_id = created.json()["project_id"]
    videos = created.json()["videos"]
    check("all three videos discovered", len(videos) == 3, f"found {len(videos)}")

    print("\nFlow: analyze (manual harness, real pipeline — takes ~a minute)")
    analysis = client.post(
        f"/projects/{project_id}/analyze",
        json={"project_id": project_id, "harness_id": "manual", "preferences": {}},
    )
    check("analysis completes", analysis.status_code == 200, f"status {analysis.status_code}")
    clips = analysis.json()["clips"] if analysis.status_code == 200 else []

    by_file: dict[str, list[dict]] = {}
    for clip in clips:
        by_file.setdefault(clip["file_id"], []).append(clip)
    print(f"  candidate clips: {len(clips)}")
    for clip in clips:
        print(
            f"    {clip['file_name']}  {clip['start_sec']:.1f}s–{clip['end_sec']:.1f}s"
            f"  smoothness {clip['smoothness_score']:.1f}  overall {clip['overall_score']:.1f}"
            f"  tags {','.join(clip.get('tags', []))}"
        )

    smooth_clips = by_file.get("hover_smooth.mp4", [])
    shaky_clips = by_file.get("jitter_shaky.mp4", [])
    mixed_clips = by_file.get("mixed_smooth_then_shaky.mp4", [])
    check("smooth hover produces at least one clip", len(smooth_clips) >= 1)
    check(
        "smooth hover clips score high",
        all(clip["smoothness_score"] >= 9 for clip in smooth_clips),
    )
    check(
        "shaky footage is retained only as low-scoring fallback",
        bool(shaky_clips)
        and all(
            "fallback" in clip.get("tags", []) and clip["smoothness_score"] < 7
            for clip in shaky_clips
        ),
    )
    check("mixed footage produces at least one clip", len(mixed_clips) >= 1)
    primary_mixed_clips = [
        clip for clip in mixed_clips if "fallback" not in clip.get("tags", [])
    ]
    check(
        "primary mixed clips come from the smooth half",
        bool(primary_mixed_clips)
        and all(
            clip["start_sec"] < MIXED_SMOOTH_SEC
            and clip["end_sec"] <= MIXED_SMOOTH_SEC + 1.5
            for clip in primary_mixed_clips
        ),
    )

    results_json = folder / "clipassembler" / "analysis" / "results.json"
    check("analysis results persisted to project folder", results_json.exists())

    print("\nFlow: review — accept two clips, trim one, save timeline")
    accepted = []
    if smooth_clips:
        keeper = smooth_clips[0]
        accepted.append({
            "clip_id": keeper["clip_id"],
            "start_sec": keeper["start_sec"] + 1.0,
            "end_sec": keeper["end_sec"],
            "included": True,
        })
    if mixed_clips:
        keeper = mixed_clips[0]
        accepted.append({
            "clip_id": keeper["clip_id"],
            "start_sec": keeper["start_sec"],
            "end_sec": keeper["end_sec"],
            "included": True,
        })
    timeline = client.put(f"/projects/{project_id}/timeline", json={"clips": accepted})
    check("timeline update accepted", timeline.status_code == 200, f"status {timeline.status_code}")

    print("\nFlow: export EDL + FCPXML + DaVinci XML")
    expected_files = {
        "edl": folder / "exports" / "edl" / "timeline.edl",
        "fcpxml": folder / "exports" / "fcp" / "timeline.fcpxml",
        "resolve_xml": folder / "exports" / "davinci" / "timeline.xml",
    }
    for export_format, expected_path in expected_files.items():
        response = client.post(f"/projects/{project_id}/export?format={export_format}&overwrite=true")
        ok = response.status_code == 200 and expected_path.exists()
        check(f"{export_format} export written", ok, str(expected_path))
    fcpxml_text = expected_files["fcpxml"].read_text(encoding="utf-8") if expected_files["fcpxml"].exists() else ""
    resolve_text = expected_files["resolve_xml"].read_text(encoding="utf-8") if expected_files["resolve_xml"].exists() else ""
    check("FCPXML references media relative to export dir", 'src="../../' in fcpxml_text)
    check("DaVinci XML references media relative to export dir", "<pathurl>../../" in resolve_text)
    check("DaVinci XML is XMEML v5", '<xmeml version="5">' in resolve_text)

    print("\nFlow: operations core (HTTP) — include, speed, split, undo/redo")
    op_clip = clips[0]["clip_id"]

    def op(operation, **args):
        return client.post(
            f"/projects/{project_id}/timeline/op",
            json={"operation": operation, "args": args},
        )

    doc = op("include", clip_id=op_clip).json()["document"]
    check("include keeps/creates a timeline item", any(i["source_clip_id"] == op_clip for i in doc["items"]))
    item = next(i for i in doc["items"] if i["source_clip_id"] == op_clip)
    item_id = item["item_id"]
    doc = op("set_speed", item_id=item_id, speed=0.5).json()["document"]
    check("set_speed records 0.5x", next(i for i in doc["items"] if i["item_id"] == item_id)["speed"] == 0.5)
    count_before_split = len(doc["items"])
    mid = round((item["start_sec"] + item["end_sec"]) / 2, 3)
    doc = op("split_item", item_id=item_id, at_sec=mid).json()["document"]
    check("split adds one item", len(doc["items"]) == count_before_split + 1)
    undo = client.post(f"/projects/{project_id}/timeline/undo").json()["document"]
    check("undo reverts the split", len(undo["items"]) == count_before_split)
    redo = client.post(f"/projects/{project_id}/timeline/redo").json()["document"]
    check("redo reapplies the split", len(redo["items"]) == count_before_split + 1)

    print("\nFlow: MCP round-trip — tools/list + tools/call drive the same core")
    api._mcp_server = None
    listed = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tool_names = {t["name"] for t in listed.json().get("result", {}).get("tools", [])}
    check(
        "MCP exposes mutating + read tools",
        {"include", "split_item", "list_candidates", "get_frame_paths"} <= tool_names,
    )
    second_clip = clips[1]["clip_id"] if len(clips) > 1 else op_clip
    called = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "include", "arguments": {"project_id": project_id, "clip_id": second_clip}},
        },
    )
    check(
        "MCP tools/call succeeds",
        called.status_code == 200 and called.json()["result"].get("isError") is not True,
    )
    after = client.get(f"/projects/{project_id}/timeline/document").json()["document"]
    check(
        "MCP edit visible via HTTP document (one shared core)",
        any(i["source_clip_id"] == second_clip for i in after["items"]),
    )

    print("\nFlow: export reflects speed + transform (Resolve) and warns (EDL)")
    op("set_transform", item_id=after["items"][0]["item_id"], transform={"scale": 1.4, "x": 0.1, "y": 0.0})
    client.post(f"/projects/{project_id}/export?format=resolve_xml&overwrite=true")
    resolve_doc_text = expected_files["resolve_xml"].read_text(encoding="utf-8")
    check("Resolve XML encodes Transform (Basic Motion)", "Basic Motion" in resolve_doc_text)
    edl_export = client.post(f"/projects/{project_id}/export?format=edl&overwrite=true")
    check("EDL export warns that speed/transform were flattened", bool(edl_export.json().get("warnings")))

    print("\nFlow: close and reopen the project")
    api.projects.clear()
    api._timeline_controllers.clear()
    reopened = client.post("/projects/from-folder", json={"folder_path": str(folder)})
    check("reopen succeeds", reopened.status_code == 200)
    restored_clips = reopened.json().get("clips", [])
    check(
        "candidate clips restored on reopen",
        len(restored_clips) == len(clips),
        f"{len(restored_clips)}/{len(clips)}",
    )
    restored_timeline = reopened.json().get("timeline") or {}
    restored_entries = restored_timeline.get("clips") or []
    check(
        "saved timeline (accepted clips + trims) restored on reopen",
        isinstance(restored_entries, list)
        and len(restored_entries) == len(accepted)
        and all(isinstance(entry, dict) for entry in restored_entries)
        and (not accepted or restored_entries[0]["start_sec"] == accepted[0]["start_sec"]),
    )

    if temp_root and not args.keep:
        shutil.rmtree(temp_root, ignore_errors=True)
    elif args.keep:
        print(f"\nKept project folder: {folder}")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
