#!/usr/bin/env python3
"""Measure clip extraction and draft-format coverage for a folder project.

The p90 duration uses the nearest-rank percentile: the value at rank
``ceil(0.9 * n)`` in the sorted durations (with ranks starting at one).
"""

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

from src import api
from src.assembly_profiles import FORMATS, build_draft_timeline, recommend_format
from src.clip_assembly import assemble_smooth_clips, candidate_runs
from src.models import FrameScore
from src.project_store import read_frame_scores


def _covered_seconds(clips: list[dict]) -> float:
    ranges = sorted((float(clip["start_sec"]), float(clip["end_sec"])) for clip in clips)
    total = 0.0
    current_start = current_end = None
    for start, end in ranges:
        if current_end is None:
            current_start, current_end = start, end
        elif start > current_end:
            total += current_end - current_start
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None:
        total += current_end - current_start
    return total


def _nearest_rank(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    return ordered[math.ceil(percentile * len(ordered)) - 1]


def collect_stats(folder: Path, max_clip_sec: float | None = None) -> dict:
    manifest_path = folder / "clipassembler" / "project.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    frame_scores = read_frame_scores(folder)
    if frame_scores is None:
        raise FileNotFoundError("Analyze this folder in the app first; frame_scores.json is missing")

    preferences = api.preferences_from_request(
        {"max_clip_duration_sec": max_clip_sec} if max_clip_sec is not None else {}
    )
    per_file = frame_scores["per_file"]
    files = []
    clips = []
    steady_seconds = 0
    for source in manifest.get("source_videos", []):
        file_id = source["filename"]
        entry = per_file.get(file_id, {})
        frames = [FrameScore.model_validate(frame) for frame in entry.get("frames", [])]
        scene_bounds = {
            int(scene_id): (float(bounds[0]), float(bounds[1]))
            for scene_id, bounds in (entry.get("scene_bounds") or {}).items()
            if isinstance(bounds, list) and len(bounds) == 2
        }
        result = assemble_smooth_clips(
            file_id=file_id,
            file_name=file_id,
            frames=frames,
            preferences=preferences,
            scene_bounds=scene_bounds,
            source_duration_sec=entry.get("source_duration_sec"),
        )
        file_clips = [clip.model_dump() for clip in result.clips]
        files.append({"file_id": file_id, "clips": len(file_clips)})
        clips.extend(file_clips)
        steady_seconds += sum(
            len(run)
            for run in candidate_runs(
                frames,
                preferences.smoothness_threshold,
                preferences.max_turn_rate_deg_per_sec,
            )
        )

    durations = [float(clip["duration_sec"]) for clip in clips]
    drafts = {}
    for format_name, format_info in FORMATS.items():
        draft = build_draft_timeline(
            clips,
            profile=format_info["profile"],
            target_duration_sec=format_info["target_duration_sec"],
        )
        drafts[format_name] = {
            "total_duration_sec": draft["total_duration_sec"],
            "clips": len(draft["clips"]),
        }

    return {
        "max_clip_sec": preferences.max_clip_duration_sec,
        "files": files,
        "total": len(clips),
        "median_sec": statistics.median(durations) if durations else 0.0,
        "p90_sec": _nearest_rank(durations, 0.9),
        "steady_sec": steady_seconds,
        "covered_sec": _covered_seconds(clips),
        "drafts": drafts,
        "recommended": recommend_format(clips),
    }


def _markdown_row(stats: dict) -> str:
    clip_counts = " / ".join(str(entry["clips"]) for entry in stats["files"])
    drafts = stats["drafts"]
    values = [
        "",
        str(stats["max_clip_sec"]),
        clip_counts,
        str(stats["total"]),
        f"{stats['median_sec']:.1f}",
        f"{stats['p90_sec']:.1f}",
        f"{stats['steady_sec']:.1f}",
        f"{stats['covered_sec']:.1f}",
        f"{drafts['short']['total_duration_sec']:.1f}",
        f"{drafts['medium']['total_duration_sec']:.1f}",
        f"{drafts['long']['total_duration_sec']:.1f}",
        str(stats["recommended"]),
    ]
    return "| " + " | ".join(values) + " |"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--max-clip-sec", type=float)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        stats = collect_stats(args.folder, args.max_clip_sec)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc
    if args.json:
        print(json.dumps(stats))
    else:
        print(_markdown_row(stats))


if __name__ == "__main__":
    main()
