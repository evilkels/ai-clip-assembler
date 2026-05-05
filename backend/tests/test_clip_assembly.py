from src.clip_assembly import AssemblyPreferences, assemble_smooth_clips
from src.models import FrameScore


def frame(timestamp, smoothness, sharpness=8.0, exposure=8.0, contrast=8.0, scene_id=1):
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
