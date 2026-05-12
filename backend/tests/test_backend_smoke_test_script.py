import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from backend_smoke_test import format_analysis_summary


def test_format_analysis_summary_lists_clip_timings_scores_and_total_duration():
    analysis = {
        "clips": [
            {
                "start_sec": 32.0,
                "end_sec": 35.0,
                "duration_sec": 3.0,
                "overall_score": 8.4,
                "smoothness_score": 9.1,
                "ai_reason": "stable, sharp, and well exposed",
            },
            {
                "start_sec": 0.0,
                "end_sec": 15.0,
                "duration_sec": 15.0,
                "overall_score": 7.2,
                "smoothness_score": 7.8,
            },
        ],
        "sequence": {"total_duration_sec": 18.0},
    }

    assert format_analysis_summary(analysis) == [
        "Candidate clips: 2",
        "Timeline duration: 18.0s",
        "Clips:",
        "  1. 32.000s -> 35.000s (3.000s), overall 8.40, smoothness 9.10",
        "     reason: stable, sharp, and well exposed",
        "  2. 0.000s -> 15.000s (15.000s), overall 7.20, smoothness 7.80",
    ]
