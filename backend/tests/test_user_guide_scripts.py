"""Keep the Review scripting examples in the User Guide executable."""

import re
from pathlib import Path

from src.models import TimelineDocument, TimelineItem
from src.timeline_ops import SourceClip
from src.timeline_script import run_script_in_process


GUIDE_PATH = Path(__file__).parents[2] / "docs" / "USER_GUIDE.md"


def _scripts_from_guide() -> list[str]:
    guide = GUIDE_PATH.read_text()
    subsection = re.search(
        r"^### Scripting in Review\n(?P<body>.*?)(?=^### |\Z)",
        guide,
        re.MULTILINE | re.DOTALL,
    )
    assert subsection, "Scripting in Review subsection is missing"
    return re.findall(r"```lua\n(.*?)\n```", subsection.group("body"), re.DOTALL)


def _run(script: str):
    clips = [
        (f"clip-{index:02d}", 10.0 * index, 10.0 * index + 5.0, index / 20, 5.0, "included")
        for index in range(20)
    ] + [
        ("clip-excluded-smooth", 210.0, 218.0, 0.8, 8.0, "excluded"),
        ("clip-excluded-shaky", 220.0, 228.0, 0.7, 4.0, "excluded"),
        ("clip-unreviewed", 230.0, 235.0, 0.6, 9.0, "unreviewed"),
    ]
    sources = {
        clip_id: SourceClip(
            clip_id=clip_id,
            start_sec=start,
            end_sec=end,
            source_duration_sec=300.0,
        )
        for clip_id, start, end, _, _, _ in clips
    }
    library = [
        {
            "clip_id": clip_id,
            "file_name": f"{clip_id}.mp4",
            "start_sec": start,
            "end_sec": end,
            "overall_score": score,
            "smoothness_score": smoothness,
        }
        for clip_id, start, end, score, smoothness, _ in clips
    ]
    document = TimelineDocument(
        revision=1,
        items=[
            TimelineItem(item_id="item-1", source_clip_id="clip-00", start_sec=0, end_sec=8),
            TimelineItem(item_id="item-2", source_clip_id="clip-01", start_sec=10, end_sec=16),
            TimelineItem(item_id="item-3", source_clip_id="clip-02", start_sec=20, end_sec=28),
        ],
        decisions={clip_id: decision for clip_id, _, _, _, _, decision in clips},
    )
    return run_script_in_process(
        script,
        document=document,
        sources=sources,
        library=library,
        id_seed="guide-example",
    )


def test_user_guide_review_scripts_run_and_match_their_descriptions():
    scripts = _scripts_from_guide()
    assert len(scripts) == 3

    results = [_run(script) for script in scripts]
    for result in results:
        assert result.error is None, result.error
        assert result.operations

    goal = results[0]
    assert goal.document.items
    assert all(item.end_sec - item.start_sec <= 3 for item in goal.document.items)
    assert sum(item.effective_duration_sec for item in goal.document.items) >= 40

    restored = results[1]
    assert restored.document.decisions["clip-excluded-smooth"] == "included"
    assert restored.document.decisions["clip-excluded-shaky"] == "excluded"

    sped_up = results[2]
    assert all(
        item.effective_duration_sec <= 4
        for item in sped_up.document.items
        if item.end_sec - item.start_sec > 6
    )
    assert any(line.startswith("Item ") for line in sped_up.log)
    assert any(operation["operation"] == "set_speed" for operation in sped_up.operations)
