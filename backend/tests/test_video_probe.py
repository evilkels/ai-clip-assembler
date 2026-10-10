from pathlib import Path

from src.assembly_profiles import _capture_order_key
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


def test_quicktime_creationdate_precedes_creation_time_and_normalizes_to_utc():
    payload = {
        "format": {
            "tags": {
                "creation_time": "2026-10-10T14:00:00Z",
                "com.apple.quicktime.creationdate": "2026-10-10T12:48:28+0300",
            }
        },
        "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.created_at == "2026-10-10T09:48:28.000000Z"


def test_creationdate_accepts_colon_offset_and_z_timestamp():
    for creationdate, expected in (
        ("2026-10-10T12:48:28+03:00", "2026-10-10T09:48:28.000000Z"),
        ("2026-10-10T09:48:28Z", "2026-10-10T09:48:28.000000Z"),
    ):
        payload = {
            "format": {"tags": {"COM.APPLE.QUICKTIME.CREATIONDATE": creationdate}},
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }

        metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

        assert metadata.created_at == expected


def test_unparseable_creationdate_falls_back_to_creation_time():
    payload = {
        "format": {
            "tags": {
                "com.apple.quicktime.creationdate": "not a timestamp",
                "creation_time": "2026-10-10T09:52:00Z",
            }
        },
        "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.created_at == "2026-10-10T09:52:00.000000Z"



def test_out_of_range_creationdate_falls_back_to_creation_time():
    payload = {
        "format": {
            "tags": {
                "com.apple.quicktime.creationdate": "0001-01-01T00:00:00+0300",
                "creation_time": "2026-10-10T09:52:00Z",
            }
        },
        "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.created_at == "2026-10-10T09:52:00.000000Z"

def test_stream_creation_time_is_used_when_format_tags_are_missing():
    payload = {
        "format": {"tags": {}},
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "tags": {"Creation_Time": "2026-10-10T12:52:00+0300"},
            }
        ],
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.created_at == "2026-10-10T09:52:00.000000Z"


def test_mtime_fallback_uses_ffprobe_timestamp_format(tmp_path):
    video_path = tmp_path / "iphone.mov"
    video_path.write_bytes(b"video")
    payload = {"format": {"tags": {}}, "streams": [{"codec_type": "video", "width": 1, "height": 1}]}

    metadata = parse_ffprobe_metadata(video_path, payload)

    assert metadata.created_at is not None
    assert metadata.created_at.endswith("Z")
    assert "+00:00" not in metadata.created_at


def test_capture_order_uses_quicktime_creationdate_instead_of_transfer_time():
    captures = [
        ("shot-1.mov", "2026-10-10T12:48:00+0300", "2026-10-10T13:15:00Z"),
        ("shot-2.mov", "2026-10-10T12:52:00+0300", "2026-10-10T14:55:00Z"),
        ("shot-3.mov", "2026-10-10T13:33:00+0300", "2026-10-10T13:10:00Z"),
        ("shot-4.mov", "2026-10-10T13:58:00+0300", "2026-10-10T14:30:00Z"),
    ]
    clips = []
    for index, (filename, capture_time, transfer_time) in enumerate(captures):
        payload = {
            "format": {
                "tags": {
                    "com.apple.quicktime.creationdate": capture_time,
                    "creation_time": transfer_time,
                }
            },
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }
        metadata = parse_ffprobe_metadata(Path(filename), payload)
        clips.append(
            {
                "file_name": filename,
                "start_sec": float(index),
                "source_created_at": metadata.created_at,
            }
        )

    assert [clip["file_name"] for clip in sorted(clips, key=_capture_order_key)] == [
        "shot-1.mov",
        "shot-2.mov",
        "shot-3.mov",
        "shot-4.mov",
    ]


def test_nominal_frame_rate_preferred_when_close_to_average():
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "60000/1001",
                "avg_frame_rate": "117400/1959",
            }
        ]
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.fps == 59.94


def test_average_frame_rate_used_when_r_frame_rate_is_timebase_artifact():
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "90000/1",
                "avg_frame_rate": "30000/1001",
            }
        ]
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.fps == 29.97


def test_r_frame_rate_used_when_average_frame_rate_is_zero():
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "25/1",
                "avg_frame_rate": "0/0",
            }
        ]
    }

    metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

    assert metadata.fps == 25.0


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


def test_unusable_frame_rates_report_zero():
    for r_frame_rate in ("-25/1", "NaN"):
        payload = {
            "streams": [
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": r_frame_rate,
                    "avg_frame_rate": "0/0",
                }
            ]
        }

        metadata = parse_ffprobe_metadata(Path("/footage/iphone.mov"), payload)

        assert metadata.fps == 0.0
