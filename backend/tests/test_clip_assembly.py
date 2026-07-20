from src.clip_assembly import AssemblyPreferences, assemble_smooth_clips
from src.models import FrameScore


def frame(
    timestamp,
    smoothness,
    sharpness=8.0,
    exposure=8.0,
    contrast=8.0,
    scene_id=1,
    turn_rate=0.0,
):
    return FrameScore(
        timestamp=timestamp,
        frame_path=f"/tmp/frame_{timestamp}.jpg",
        motion_stability=smoothness,
        smoothness_score=smoothness,
        sharpness_score=sharpness,
        exposure_score=exposure,
        contrast_score=contrast,
        visual_interest_score=0.0,
        overall_score=smoothness,
        blur_score=sharpness,
        brightness=exposure / 10,
        contrast=contrast / 10,
        scene_id=scene_id,
        is_keyframe=True,
        turn_rate_deg_per_sec=turn_rate,
    )


def test_assemble_smooth_clips_finds_ranked_segments_with_reason():
    frames = [
        frame(0, 5),
        frame(1, 8.2),
        frame(2, 8.5),
        frame(3, 8.4),
        frame(4, 8.1),
        frame(5, 4),
        frame(6, 9.1, scene_id=2),
        frame(7, 9.0, scene_id=2),
        frame(8, 9.2, scene_id=2),
        frame(9, 9.0, scene_id=2),
    ]

    result = assemble_smooth_clips(
        file_id="file-1",
        file_name="DJI_0001.MP4",
        frames=frames,
        preferences=AssemblyPreferences(
            min_clip_duration_sec=3,
            max_clip_duration_sec=15,
            smoothness_threshold=7.0,
            target_duration_sec=20,
        ),
    )

    assert len(result.clips) == 2
    assert result.clips[0].start_sec == 6
    assert result.clips[0].end_sec == 9
    assert result.clips[0].overall_score > result.clips[1].overall_score
    assert result.clips[0].sharpness_score == 8.0
    assert result.clips[0].exposure_score == 8.0
    assert result.clips[0].contrast_score == 8.0
    assert "Stable" in result.clips[0].ai_reason
    assert result.sequence.clips == [clip.clip_id for clip in result.clips]


def test_assemble_smooth_clips_respects_duration_and_thresholds():
    frames = [frame(second, 8.0) for second in range(20)]

    result = assemble_smooth_clips(
        file_id="file-1",
        file_name="DJI_0001.MP4",
        frames=frames,
        preferences=AssemblyPreferences(
            min_clip_duration_sec=3,
            max_clip_duration_sec=5,
            smoothness_threshold=7.0,
            target_duration_sec=8,
            max_clips_per_scene=2,
        ),
    )

    assert [clip.duration_sec for clip in result.clips] == [5]
    assert result.sequence.total_duration_sec == 5


def test_clip_ids_are_stable_for_the_same_source_range():
    frames = [frame(second, 8.0) for second in range(5)]

    first = assemble_smooth_clips("file-1", "DJI_0001.MP4", frames)
    second = assemble_smooth_clips("file-1", "DJI_0001.MP4", frames)

    assert first.clips[0].clip_id == second.clips[0].clip_id


def test_abrupt_turn_splits_candidates_but_slow_turn_is_allowed():
    frames = [
        frame(0, 9, turn_rate=2),
        frame(1, 9, turn_rate=4),
        frame(2, 9, turn_rate=30),
        frame(3, 9, turn_rate=4),
        frame(4, 9, turn_rate=2),
    ]

    result = assemble_smooth_clips(
        "file-1",
        "DJI_0001.MP4",
        frames,
        AssemblyPreferences(min_clip_duration_sec=1, max_turn_rate_deg_per_sec=12),
    )

    assert [(clip.start_sec, clip.end_sec) for clip in result.clips] == [(0, 1), (3, 4)]


def test_candidates_never_straddle_scene_boundaries():
    frames = [
        frame(0, 9, scene_id=1),
        frame(1, 9, scene_id=1),
        frame(2, 9, scene_id=1),
        frame(3, 9, scene_id=2),
        frame(4, 9, scene_id=2),
        frame(5, 9, scene_id=2),
    ]

    result = assemble_smooth_clips(
        "file-1",
        "DJI_0001.MP4",
        frames,
        AssemblyPreferences(min_clip_duration_sec=2, max_clip_duration_sec=10),
    )

    assert [(clip.start_sec, clip.end_sec, clip.scene_id) for clip in result.clips] == [
        (0, 2, 1),
        (3, 5, 2),
    ]


def test_assembly_picks_highest_scoring_window_in_scene():
    frames = [
        frame(0, 7.1),
        frame(1, 7.2),
        frame(2, 9.7),
        frame(3, 9.8),
        frame(4, 9.9),
        frame(5, 7.1),
    ]

    result = assemble_smooth_clips(
        "file-1",
        "DJI_0001.MP4",
        frames,
        AssemblyPreferences(min_clip_duration_sec=2, max_clip_duration_sec=2),
    )

    assert (result.clips[0].start_sec, result.clips[0].end_sec) == (2, 4)


def test_assembly_caps_clips_per_scene():
    frames = [frame(second, 8 + (second % 3) / 10, scene_id=1) for second in range(20)]

    result = assemble_smooth_clips(
        "file-1",
        "DJI_0001.MP4",
        frames,
        AssemblyPreferences(
            min_clip_duration_sec=2,
            max_clip_duration_sec=3,
            max_clips_per_scene=2,
            target_duration_sec=60,
        ),
    )

    assert len(result.clips) == 1


def test_candidate_pool_keeps_each_scene_and_counts_sample_interval_at_boundary():
    frames = [
        *[frame(second, 9.0, scene_id=1) for second in range(0, 19)],
        *[frame(second, 9.0, scene_id=2) for second in range(34, 38)],
        *[frame(second, 9.0, scene_id=3) for second in range(38, 41)],
        *[frame(second, 2.0, scene_id=3, turn_rate=20) for second in range(41, 49)],
    ]

    result = assemble_smooth_clips(
        "file-1",
        "IMG_0888.MOV",
        frames,
        AssemblyPreferences(
            min_clip_duration_sec=3,
            max_clip_duration_sec=10,
            max_clips_per_scene=4,
            max_candidates_per_video=12,
        ),
        scene_bounds={1: (0.0, 21.21), 2: (21.21, 37.21), 3: (37.21, 49.03)},
        source_duration_sec=49.03,
    )

    assert {clip.scene_id for clip in result.clips} == {1, 2, 3}
    scene_three = [clip for clip in result.clips if clip.scene_id == 3]
    assert any(clip.start_sec == 38 and clip.end_sec == 41 for clip in scene_three)
    assert all(clip.duration_sec >= 3 for clip in result.clips)
    assert len(result.clips) <= 12


def test_candidate_pool_keeps_one_honestly_scored_fallback_for_weak_scene():
    frames = [frame(second, 3.0, scene_id=4, turn_rate=18) for second in range(10, 16)]

    result = assemble_smooth_clips(
        "file-1",
        "weak.MOV",
        frames,
        AssemblyPreferences(
            min_clip_duration_sec=3,
            max_clip_duration_sec=10,
            max_clips_per_scene=4,
            max_candidates_per_video=12,
        ),
        scene_bounds={4: (10.0, 16.0)},
        source_duration_sec=16.0,
    )

    assert len(result.clips) == 1
    assert result.clips[0].scene_id == 4
    assert result.clips[0].smoothness_score == 3.0
    assert "fallback" in result.clips[0].tags


def test_one_best_window_per_run_no_overlaps():
    # A single smooth run 0..10s must yield exactly ONE candidate, not the
    # O(n^2) family of overlapping windows.
    frames = [frame(second, 9.0, scene_id=0, turn_rate=1.0) for second in range(11)]

    result = assemble_smooth_clips(
        "file-1",
        "DJI.MP4",
        frames,
        AssemblyPreferences(min_clip_duration_sec=3.0, max_clip_duration_sec=10.0),
        source_duration_sec=10.0,
    )

    assert len(result.clips) == 1
    only = result.clips[0]
    assert only.scene_id == 0
    assert (only.end_sec - only.start_sec) >= 3.0


def test_candidate_pool_skips_scene_shorter_than_minimum_duration():
    result = assemble_smooth_clips(
        "file-1",
        "short.MOV",
        [frame(0, 9.0, scene_id=1), frame(1, 9.0, scene_id=1)],
        AssemblyPreferences(min_clip_duration_sec=3),
        scene_bounds={1: (0.0, 2.0)},
        source_duration_sec=2.0,
    )

    assert result.clips == []
