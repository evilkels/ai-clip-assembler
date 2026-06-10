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
        ),
    )

    assert [clip.duration_sec for clip in result.clips] == [5, 5]
    assert result.sequence.total_duration_sec == 10


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
