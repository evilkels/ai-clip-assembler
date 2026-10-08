import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import extraction_stats  # noqa: E402
from src.models import FrameScore  # noqa: E402


def frame(timestamp, smoothness, turn_rate=0.0):
    return FrameScore(
        timestamp=timestamp,
        frame_path=f"/tmp/frame_{timestamp}.jpg",
        motion_stability=smoothness,
        smoothness_score=smoothness,
        sharpness_score=8.0,
        exposure_score=8.0,
        contrast_score=8.0,
        visual_interest_score=0.0,
        overall_score=smoothness,
        blur_score=8.0,
        brightness=0.8,
        contrast=0.8,
        scene_id=1,
        is_keyframe=True,
        turn_rate_deg_per_sec=turn_rate,
    ).model_dump()


def write_folder_project(folder: Path) -> None:
    state = folder / "clipassembler"
    (state / "analysis").mkdir(parents=True)
    (state / "project.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "name": "fixture",
                "created_at": "2026-10-08T00:00:00Z",
                "source_videos": [
                    {"filename": "STEADY.MP4", "imported_at": "2026-10-08T00:00:00Z"},
                    {"filename": "SHAKY.MP4", "imported_at": "2026-10-08T00:00:00Z"},
                ],
            }
        ),
        encoding="utf-8",
    )
    steady = [frame(second, 9.0) for second in range(30)]
    half_shaky = [
        frame(second, 9.0) if second < 15 else frame(second, 2.0, turn_rate=30.0)
        for second in range(30)
    ]
    (state / "analysis" / "frame_scores.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "per_file": {
                    name: {
                        "frames": frames,
                        "scene_bounds": {"1": [0.0, 30.0]},
                        "source_duration_sec": 30.0,
                    }
                    for name, frames in (("STEADY.MP4", steady), ("SHAKY.MP4", half_shaky))
                },
            }
        ),
        encoding="utf-8",
    )


def test_reports_candidates_steady_seconds_and_drafts_for_a_folder_project(tmp_path, capsys):
    write_folder_project(tmp_path)

    extraction_stats.main([str(tmp_path), "--max-clip-sec", "30", "--json"])

    stats = json.loads(capsys.readouterr().out)
    assert [(entry["file_id"], entry["clips"]) for entry in stats["files"]] == [
        ("STEADY.MP4", 1),
        ("SHAKY.MP4", 1),
    ]
    assert stats["total"] == 2
    assert stats["steady_sec"] == 45
    for format_name in ("short", "medium", "long"):
        assert isinstance(stats["drafts"][format_name]["total_duration_sec"], (int, float))


def test_prints_one_markdown_row_without_json_flag(tmp_path, capsys):
    write_folder_project(tmp_path)

    extraction_stats.main([str(tmp_path), "--max-clip-sec", "30"])

    output = capsys.readouterr().out.strip()
    assert output.count("\n") == 0
    assert output.startswith("|") and output.endswith("|")
    assert "| 1 / 1 |" in output


def test_exits_2_when_frame_scores_are_missing(tmp_path, capsys):
    write_folder_project(tmp_path)
    (tmp_path / "clipassembler" / "analysis" / "frame_scores.json").unlink()

    with pytest.raises(SystemExit) as exit_info:
        extraction_stats.main([str(tmp_path)])

    assert exit_info.value.code == 2
    assert "Analyze this folder in the app first; frame_scores.json is missing" in capsys.readouterr().err
