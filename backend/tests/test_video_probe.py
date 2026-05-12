from pathlib import Path

from src.video_probe import FFprobeUnavailableError, parse_ffprobe_metadata, probe_video


def test_parse_ffprobe_metadata_extracts_primary_video_stream():
    payload = {
        "format": {"duration": "12.500000"},
        "streams": [
            {"codec_type": "audio", "codec_name": "aac"},
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 3840,
                "height": 2160,
                "avg_frame_rate": "60000/1001",
            },
        ],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/DJI_0001.MP4"), payload)

    assert metadata.file_name == "DJI_0001.MP4"
    assert metadata.duration_sec == 12.5
    assert metadata.fps == 59.94
    assert metadata.resolution == [3840, 2160]
    assert metadata.display_resolution == [3840, 2160]
    assert metadata.rotation_degrees == 0
    assert metadata.codec == "h264"


def test_parse_ffprobe_metadata_preserves_vertical_rotation_display_shape():
    payload = {
        "format": {"duration": "35.936000"},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "hevc",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "60000/1001",
                "side_data_list": [{"side_data_type": "Display Matrix", "rotation": 90}],
            },
        ],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/DJI_VERTICAL.MP4"), payload)

    assert metadata.fps == 59.94
    assert metadata.resolution == [1920, 1080]
    assert metadata.rotation_degrees == 90
    assert metadata.display_resolution == [1080, 1920]


def test_probe_video_reports_missing_ffprobe_clearly(tmp_path):
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"not a real video")

    def missing_runner(*args, **kwargs):
        raise FileNotFoundError("ffprobe")

    try:
        probe_video(video_path, runner=missing_runner)
    except FFprobeUnavailableError as exc:
        assert "ffprobe" in str(exc)
    else:
        raise AssertionError("Expected missing ffprobe to raise a clear domain error")
