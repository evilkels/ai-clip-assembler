import xml.etree.ElementTree as ET

from src.export_engine import (
    choose_timeline_fps,
    fcpx_frame_duration,
    generate_edl,
    generate_fcpxml,
    seconds_to_timecode,
)


def test_seconds_to_timecode_uses_non_drop_frame_format():
    assert seconds_to_timecode(65.5, fps=30) == "00:01:05:15"


def test_generate_edl_includes_events_for_each_timeline_clip():
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
        },
        {
            "clip_id": "clip-2",
            "file_id": "file-2",
            "file_name": "DJI_0002.MP4",
            "start_sec": 20.0,
            "end_sec": 23.0,
            "duration_sec": 3.0,
        },
    ]

    edl = generate_edl("Drone MVP", clips, fps=30)

    assert "TITLE: Drone MVP" in edl
    assert "001  AX       V     C        00:00:10:00 00:00:14:00 00:00:00:00 00:00:04:00" in edl
    assert "* FROM CLIP NAME: DJI_0001.MP4" in edl
    assert "002  AX       V     C        00:00:20:00 00:00:23:00 00:00:04:00 00:00:07:00" in edl


def test_generate_fcpxml_references_assets_and_timeline_clips():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": "/Users/me/DJI_0001.MP4",
            "metadata": {"duration_sec": 120, "fps": 30, "resolution": [3840, 2160]},
        }
    }
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
        }
    ]

    fcpxml = generate_fcpxml("Drone MVP", clips, videos)
    root = ET.fromstring(fcpxml)

    assert root.tag == "fcpxml"
    assert root.attrib["version"] == "1.10"
    asset = root.find(".//asset")
    assert asset is not None
    assert asset.attrib["src"] == "file:///Users/me/DJI_0001.MP4"
    asset_clip = root.find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["ref"] == "asset-file-1"
    assert asset_clip.attrib["start"] == "10000/1000s"
    assert asset_clip.attrib["duration"] == "4000/1000s"


def test_generate_fcpxml_uses_source_fps_and_vertical_display_dimensions():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_VERTICAL.MP4",
            "file_path": "/Users/me/DJI_VERTICAL.MP4",
            "metadata": {
                "duration_sec": 35.936,
                "fps": 59.94,
                "resolution": [1920, 1080],
                "display_resolution": [1080, 1920],
                "rotation_degrees": 90,
            },
        }
    }
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_VERTICAL.MP4",
            "start_sec": 0,
            "end_sec": 3,
            "duration_sec": 3,
        }
    ]

    root = ET.fromstring(generate_fcpxml("Drone MVP", clips, videos))
    fmt = root.find(".//format")

    assert fmt is not None
    assert fmt.attrib["frameDuration"] == "1001/60000s"
    assert fmt.attrib["width"] == "1080"
    assert fmt.attrib["height"] == "1920"


def test_generate_edl_uses_timeline_fps_for_5994_sources():
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 1.0,
            "end_sec": 2.0,
            "duration_sec": 1.0,
        }
    ]

    edl = generate_edl("Drone MVP", clips, fps=60)

    assert "00:00:01:00 00:00:02:00 00:00:00:00 00:00:01:00" in edl


def test_fcp_frame_duration_handles_common_rates():
    assert fcpx_frame_duration(29.97) == "1001/30000s"
    assert fcpx_frame_duration(59.94) == "1001/60000s"
    assert fcpx_frame_duration(30) == "100/3000s"
    assert fcpx_frame_duration(60) == "100/6000s"


def test_choose_timeline_fps_uses_highest_source_rate():
    videos = {
        "file-1": {"metadata": {"fps": 29.97}},
        "file-2": {"metadata": {"fps": 59.94}},
    }

    assert choose_timeline_fps(videos) == 59.94
