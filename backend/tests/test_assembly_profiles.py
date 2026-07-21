from src.assembly_profiles import (
    FORMATS,
    PROFILE_DEFAULTS,
    build_draft_timeline,
    recommend_assembly_profile,
    recommend_format,
)


def clip(clip_id, start, end, score=8.0, file_name="DJI_0001.MP4", scene_id=0, smoothness=0.0, max_turn=999.0):
    return {
        "clip_id": clip_id,
        "file_id": "file-1",
        "file_name": file_name,
        "start_sec": start,
        "end_sec": end,
        "duration_sec": end - start,
        "overall_score": score,
        "scene_id": scene_id,
        "smoothness_score": smoothness,
        "max_turn_rate_deg_per_sec": max_turn,
    }


def test_recommendation_prefers_long_scenic_when_sustained_ranges_exist():
    clips = [clip("a", 0, 25), clip("b", 30, 55), clip("c", 60, 85)]

    recommendation = recommend_assembly_profile(clips)

    assert recommendation["profile"] == "long_scenic"
    assert recommendation["target_duration_sec"] == 480


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

    assert draft["clips"][0]["end_sec"] - draft["clips"][0]["start_sec"] == 7
    assert draft["total_duration_sec"] == 7


def test_profiles_alternate_clip_lengths_for_rhythm():
    clips = [clip(str(i), i * 20, i * 20 + 20, score=10 - i / 10) for i in range(4)]

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=30)

    assert [entry["duration_sec"] for entry in draft["clips"][:3]] == [7.0, 4.0, 6.0]


def test_short_social_orders_strongest_first_not_chronologically():
    clips = [
        clip("late-best", 40, 50, score=9.5),
        clip("early-weak", 0, 10, score=6.0),
        clip("mid", 20, 30, score=8.0),
    ]

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=30)

    assert [entry["clip_id"] for entry in draft["clips"]] == ["late-best", "mid", "early-weak"]


def test_long_scenic_caps_clips_per_scene():
    clips = [
        clip("s0-a", 0, 30, score=9.5, scene_id=0),
        clip("s0-b", 40, 70, score=9.0, scene_id=0),
        clip("s0-c", 80, 110, score=8.5, scene_id=0),
        clip("s0-d", 120, 150, score=8.0, scene_id=0),
        clip("s1-a", 160, 190, score=7.5, scene_id=1),
    ]

    draft = build_draft_timeline(clips, profile="long_scenic", target_duration_sec=480)
    scene_ids = [entry["scene_id"] for entry in draft["clips"]]

    # Up to 3 clips per scene, so the weakest scene-0 candidate (s0-d) is dropped.
    assert sorted(scene_ids) == [0, 0, 0, 1]
    assert "s0-d" not in {entry["clip_id"] for entry in draft["clips"]}


def test_cinematic_applies_slowmo_to_very_smooth_clips_only():
    clips = [
        clip("smooth", 0, 30, score=9.0, scene_id=0, smoothness=9.5, max_turn=1.0),
        clip("shaky", 40, 70, score=8.0, scene_id=1, smoothness=7.0, max_turn=8.0),
    ]

    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=300)
    by_id = {entry["clip_id"]: entry for entry in draft["clips"]}

    assert by_id["smooth"]["suggested_speed"] == 0.5
    assert by_id["shaky"]["suggested_speed"] == 1.0


def test_short_social_never_applies_slowmo():
    clips = [clip("smooth", 0, 30, score=9.0, smoothness=9.8, max_turn=0.5)]

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=30)

    assert draft["clips"][0]["suggested_speed"] == 1.0


def test_draft_skips_overlapping_windows_from_same_footage():
    # Candidate generation emits many overlapping windows over one smooth run;
    # only non-overlapping selections should survive so the edit has no dupes.
    clips = [
        clip("w-a", 10, 17, score=9.9, scene_id=0),
        clip("w-b", 10, 14, score=9.8, scene_id=0),  # overlaps w-a
        clip("w-c", 12, 18, score=9.7, scene_id=0),  # overlaps w-a
        clip("later", 40, 50, score=9.0, scene_id=0),  # distinct footage
    ]

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=60)
    kept = [entry["clip_id"] for entry in draft["clips"]]

    assert kept == ["w-a", "later"]


def test_draft_skips_overlap_per_file_not_across_files():
    # Identical ranges in different source files are distinct footage, not dupes.
    clips = [
        clip("f1", 10, 17, score=9.9, file_name="A.MP4"),
        clip("f2", 10, 17, score=9.8, file_name="B.MP4"),
    ]
    clips[0]["file_id"] = "file-A"
    clips[1]["file_id"] = "file-B"

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=60)

    assert {entry["clip_id"] for entry in draft["clips"]} == {"f1", "f2"}


def test_draft_uses_one_clip_per_look_group():
    clips = [
        clip("a", 0, 30, score=9.5), clip("b", 40, 70, score=9.0),   # same look
        clip("c", 80, 110, score=8.0),                                # different look
    ]
    clips[0]["look_group"] = 0
    clips[1]["look_group"] = 0
    clips[2]["look_group"] = 1

    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=300)
    kept = [entry["clip_id"] for entry in draft["clips"]]

    assert "a" in kept and "c" in kept and "b" not in kept  # b is a look-dupe of a


def test_draft_ignores_look_group_constraint_when_absent():
    # No look_group set anywhere -> no diversity constraint, existing behavior.
    clips = [clip("a", 0, 30, score=9.5), clip("b", 40, 70, score=9.0)]

    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=300)
    kept = {entry["clip_id"] for entry in draft["clips"]}

    assert kept == {"a", "b"}


def test_formats_registry_maps_to_existing_profiles():
    assert FORMATS["short"]["profile"] == "short_social"
    assert FORMATS["medium"]["profile"] == "cinematic_highlight"
    assert FORMATS["long"]["profile"] == "long_scenic"
    for info in FORMATS.values():
        assert info["target_duration_sec"] == PROFILE_DEFAULTS[info["profile"]]["target_duration_sec"]


def test_recommend_format_wraps_recommend_assembly_profile():
    clips = [clip("a", 0, 25), clip("b", 30, 55), clip("c", 60, 85)]

    assert recommend_format(clips) == "long"


def test_slowmo_is_sparing_not_blanket():
    # Six very-smooth low-turn clips -> at most a couple end up slowed, not all.
    clips = [
        clip(f"s{i}", i * 40, i * 40 + 30, score=9.5 - i / 10, smoothness=9.6, max_turn=1.0)
        for i in range(6)
    ]
    for i, c in enumerate(clips):
        c["look_group"] = i

    draft = build_draft_timeline(clips, profile="long_scenic", target_duration_sec=480)
    slowed = [entry for entry in draft["clips"] if entry["suggested_speed"] != 1.0]

    assert len(slowed) <= 2


def test_short_format_never_slowmos():
    clips = [clip("x", 0, 30, score=9, smoothness=9.9, max_turn=0.2)]
    clips[0]["look_group"] = 0

    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=30)

    assert draft["clips"][0]["suggested_speed"] == 1.0


def test_draft_does_not_emit_sliver_tail_to_hit_target():
    # Six distinct 30s clips, target lands mid-clip. The final clip must not be
    # truncated below the profile's shortest cut (cinematic min = 7s).
    clips = [clip(f"s{i}", i * 100, i * 100 + 30, score=9.5 - i / 10, scene_id=i) for i in range(6)]

    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=50)
    durations = [entry["duration_sec"] for entry in draft["clips"]]

    assert min(durations) >= 7.0
    assert draft["total_duration_sec"] <= 50
