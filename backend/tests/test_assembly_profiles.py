from src.assembly_profiles import build_draft_timeline, recommend_assembly_profile


def clip(clip_id, start, end, score=8.0, file_name="DJI_0001.MP4"):
    return {
        "clip_id": clip_id,
        "file_id": "file-1",
        "file_name": file_name,
        "start_sec": start,
        "end_sec": end,
        "duration_sec": end - start,
        "overall_score": score,
    }


def test_recommendation_prefers_long_scenic_when_sustained_ranges_exist():
    clips = [clip("a", 0, 25), clip("b", 30, 55), clip("c", 60, 85)]

    recommendation = recommend_assembly_profile(clips)

    assert recommendation["profile"] == "long_scenic"
    assert recommendation["target_duration_sec"] == 300


def test_draft_selects_strongest_clips_then_orders_them_chronologically():
    clips = [
        clip("early-weak", 0, 10, score=6),
        clip("middle-strong", 20, 30, score=9),
        clip("late-strong", 40, 50, score=8.5),
    ]

    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=20)

    assert [entry["clip_id"] for entry in draft["clips"]] == ["middle-strong", "late-strong"]
    assert draft["total_duration_sec"] == 20


def test_short_social_trims_long_candidates_without_padding_target():
    clips = [clip("only", 0, 20, score=9)]

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=60)

    assert draft["clips"][0]["end_sec"] - draft["clips"][0]["start_sec"] == 6
    assert draft["total_duration_sec"] == 6
