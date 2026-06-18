import xml.etree.ElementTree as ET

from src.export_engine import (
    generate_resolve_xml,
    choose_timeline_fps,
    fcpx_frame_duration,
    generate_edl,
    generate_fcpxml,
    edl_flatten_warnings,
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


def test_generate_fcpxml_emits_retime_for_suggested_speed():
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
            "suggested_speed": 0.5,
        }
    ]

    root = ET.fromstring(generate_fcpxml("Drone MVP", clips, videos))
    asset_clip = root.find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["duration"] == "8000/1000s"
    assert asset_clip.find("timeMap/timept") is not None


def test_generate_fcpxml_can_reference_assets_relative_to_export_dir(tmp_path):
    project_folder = tmp_path / "footage"
    export_dir = project_folder / "exports" / "fcp"
    source_video = project_folder / "DJI_0001.MP4"
    export_dir.mkdir(parents=True)
    source_video.write_bytes(b"video")
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(source_video),
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

    root = ET.fromstring(generate_fcpxml("Drone MVP", clips, videos, media_base_path=export_dir))

    asset = root.find(".//asset")
    assert asset is not None
    assert asset.attrib["src"] == "../../DJI_0001.MP4"


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


def test_choose_timeline_fps_returns_30_when_no_fps():
    assert choose_timeline_fps({}) == 30.0
    assert choose_timeline_fps({"f1": {"metadata": {}}}) == 30.0
    assert choose_timeline_fps({"f1": {"metadata": None}}) == 30.0
    assert choose_timeline_fps({"f1": {}}) == 30.0


def test_choose_timeline_fps_ignores_zero_and_negative():
    videos = {
        "f1": {"metadata": {"fps": 0}},
        "f2": {"metadata": {"fps": -5}},
        "f3": {"metadata": {"fps": 29.97}},
    }
    assert choose_timeline_fps(videos) == 29.97


def test_choose_timeline_fps_ignores_non_numeric_fps():
    videos = {
        "f1": {"metadata": {"fps": "not_a_number"}},
        "f2": {"metadata": {"fps": 29.97}},
    }
    assert choose_timeline_fps(videos) == 29.97


def test_choose_timeline_fps_ignores_none_fps():
    videos = {
        "f1": {"metadata": {"fps": None}},
        "f2": {"metadata": {"fps": 60}},
    }
    assert choose_timeline_fps(videos) == 60.0


def test_choose_timeline_fps_all_invalid_defaults_to_30():
    videos = {
        "f1": {"metadata": {"fps": 0}},
        "f2": {"metadata": {"fps": -10}},
        "f3": {"metadata": {"fps": "abc"}},
        "f4": {"metadata": {}},
    }
    assert choose_timeline_fps(videos) == 30.0


def make_resolve_videos_and_clips():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": "/Users/me/footage/DJI_0001.MP4",
            "metadata": {"duration_sec": 120, "fps": 30, "resolution": [3840, 2160]},
        },
        "file-2": {
            "file_id": "file-2",
            "file_name": "DJI_0002.MP4",
            "file_path": "/Users/me/footage/DJI_0002.MP4",
            "metadata": {"duration_sec": 90, "fps": 30, "resolution": [3840, 2160]},
        },
    }
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
            "start_sec": 5.0,
            "end_sec": 8.0,
            "duration_sec": 3.0,
        },
        {
            "clip_id": "clip-3",
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "start_sec": 30.0,
            "end_sec": 32.0,
            "duration_sec": 2.0,
        },
    ]
    return videos, clips


def test_generate_resolve_xml_builds_xmeml_timeline():
    videos, clips = make_resolve_videos_and_clips()

    xml = generate_resolve_xml("Drone MVP", clips, videos)

    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert "<!DOCTYPE xmeml>" in xml
    root = ET.fromstring(xml.split("?>", 1)[1])
    assert root.tag == "xmeml"
    assert root.attrib["version"] == "5"
    assert root.find("./sequence/name").text == "Drone MVP"
    assert root.find("./sequence/rate/timebase").text == "30"

    clipitems = root.findall(".//clipitem")
    assert len(clipitems) == 3
    first = clipitems[0]
    # Source range 10s-14s at timeline position 0s-4s, all in frames.
    assert first.find("in").text == "300"
    assert first.find("out").text == "420"
    assert first.find("start").text == "0"
    assert first.find("end").text == "120"
    second = clipitems[1]
    assert second.find("start").text == "120"
    assert second.find("end").text == "210"

    width = root.find(".//format/samplecharacteristics/width")
    assert width is not None and width.text == "3840"


def test_generate_resolve_xml_defines_each_source_file_once():
    videos, clips = make_resolve_videos_and_clips()

    root = ET.fromstring(generate_resolve_xml("Drone MVP", clips, videos).split("?>", 1)[1])

    files = [item.find("file") for item in root.findall(".//clipitem")]
    assert files[0].attrib["id"] == files[2].attrib["id"]
    assert files[0].find("pathurl") is not None
    assert len(files[2]) == 0  # repeat reference carries only the id
    assert files[0].find("pathurl").text == "file:///Users/me/footage/DJI_0001.MP4"


def test_generate_resolve_xml_uses_relative_pathurl_for_folder_projects(tmp_path):
    project_folder = tmp_path / "footage"
    export_dir = project_folder / "exports" / "davinci"
    export_dir.mkdir(parents=True)
    source_video = project_folder / "DJI_0001.MP4"
    source_video.write_bytes(b"video")
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(source_video),
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

    root = ET.fromstring(
        generate_resolve_xml("Drone MVP", clips, videos, media_base_path=export_dir).split("?>", 1)[1]
    )

    pathurl = root.find(".//clipitem/file/pathurl")
    assert pathurl is not None
    assert pathurl.text == "../../DJI_0001.MP4"


# --- A2.5: Speed + Transform in exports ------------------------------------


def _transform_clip(**transform):
    return {
        "clip_id": "clip-t",
        "file_id": "file-1",
        "file_name": "DJI_0001.MP4",
        "start_sec": 0.0,
        "end_sec": 4.0,
        "duration_sec": 4.0,
        "transform": transform,
    }


def _transform_videos():
    return {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": "/Users/me/footage/DJI_0001.MP4",
            "metadata": {"duration_sec": 20, "fps": 30, "resolution": [1920, 1080]},
        }
    }


def test_generate_fcpxml_emits_adjust_transform_for_non_identity_transform():
    clips = [_transform_clip(scale=1.5, x=0.1, y=-0.2)]
    root = ET.fromstring(generate_fcpxml("T", clips, _transform_videos()))
    adjust = root.find(".//asset-clip/adjust-transform")
    assert adjust is not None
    assert adjust.get("scale", "").startswith("1.5")


def test_generate_fcpxml_omits_adjust_transform_for_identity():
    clips = [_transform_clip(scale=1.0, x=0.0, y=0.0)]
    root = ET.fromstring(generate_fcpxml("T", clips, _transform_videos()))
    assert root.find(".//asset-clip/adjust-transform") is None


def test_generate_resolve_xml_emits_basic_motion_for_transform():
    clips = [_transform_clip(scale=1.5, x=0.1, y=-0.2)]
    xml = generate_resolve_xml("T", clips, _transform_videos())
    root = ET.fromstring(xml.split("?>", 1)[1])
    effect_names = [e.text for e in root.findall(".//clipitem/filter/effect/name")]
    assert "Basic Motion" in effect_names
    scale_values = [
        p.find("value").text
        for p in root.findall(".//clipitem/filter/effect/parameter")
        if p.find("parameterid") is not None and p.find("parameterid").text == "scale"
    ]
    assert scale_values  # a scale parameter was written


def test_edl_flatten_warnings_flags_speed_and_transform():
    plain = [{"clip_id": "c", "file_id": "f", "file_name": "x.MP4", "start_sec": 0, "end_sec": 2, "duration_sec": 2}]
    assert edl_flatten_warnings(plain) == []

    speedy = [{**plain[0], "suggested_speed": 0.5}]
    assert edl_flatten_warnings(speedy)

    zoomed = [_transform_clip(scale=1.4)]
    assert edl_flatten_warnings(zoomed)


def test_generate_edl_notes_flattening_when_transform_present():
    edl = generate_edl("T", [_transform_clip(scale=1.4)], fps=30)
    assert "flatten" in edl.lower()
