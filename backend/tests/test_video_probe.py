from pathlib import Path

from src.models import VideoMetadata
from src.video_probe import FFprobeUnavailableError, parse_ffprobe_metadata, probe_video


def test_parse_ffprobe_metadata_extracts_primary_video_stream():
    payload = {
        "format": {"duration": "12.500000"},
        "streams": [
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "channels": "2",
                "sample_rate": "48000",
            },
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
    assert metadata.has_audio is True
    assert metadata.audio_channels == 2
    assert metadata.audio_sample_rate == 48000
    assert metadata.audio_codec == "aac"
    assert metadata.audio_bit_depth == 16


def test_parse_ffprobe_metadata_treats_video_only_payload_as_silent():
    payload = {
        "format": {"duration": "12.500000"},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30/1",
            }
        ],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/silent.MP4"), payload)

    assert metadata.has_audio is False
    assert metadata.audio_channels is None
    assert metadata.audio_sample_rate is None
    assert metadata.audio_codec is None
    assert metadata.audio_bit_depth is None


def test_old_video_metadata_payload_validates_with_silent_audio_defaults():
    metadata = VideoMetadata.model_validate(
        {
            "file_id": "file-1",
            "file_path": "/footage/old.MP4",
            "file_name": "old.MP4",
            "duration_sec": 3.0,
            "fps": 30.0,
            "resolution": [1920, 1080],
            "rotation_degrees": 0,
            "codec": "h264",
        }
    )

    assert metadata.has_audio is False
    assert metadata.audio_channels is None
    assert metadata.audio_sample_rate is None
    assert metadata.audio_codec is None
    assert metadata.audio_bit_depth is None


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
