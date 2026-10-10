import xml.etree.ElementTree as ET
import pytest
from fractions import Fraction
import difflib
from pathlib import Path
from urllib.parse import quote
from tests.support import assert_valid_fcpxml, assert_well_formed_xmeml
from src.api import round_edl_fps
from tests.fixtures.export.inputs import (
    CINEMA,
    ESTEPONA,
    IPHONE_MIXED,
    IPHONE_VFR_1080P5994_VERTICAL,
)

from src.export_engine import (
    generate_resolve_xml,
    choose_timeline_fps,
    fcpx_frame_duration,
    fcpx_frames,
    fcpx_time,
    fps_exact,
    generate_edl,
    generate_fcpxml,
    edl_flatten_warnings,
    seconds_to_frames,
    seconds_to_timecode,
    snap_frame_rate,
    timeline_dimensions,
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


def test_generate_edl_has_no_media_paths():
    videos, clips = make_resolve_videos_and_clips()
    edl = generate_edl("Drone MVP", clips, fps=30, videos_by_id=videos)
    event_lines = [line for line in edl.splitlines() if line[:3].isdigit()]
    assert event_lines
    assert all("file:" not in line and "/" not in line for line in event_lines)


def test_generate_fcpxml_references_assets_and_timeline_clips():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": "/Users/me/DJI_0001.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": True,
                "audio_channels": 2,
                "audio_sample_rate": 48000,
            },
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
    assert "src" not in asset.attrib
    media_rep = asset.find("media-rep")
    assert media_rep is not None
    assert media_rep.attrib["src"] == "file:///Users/me/DJI_0001.MP4"
    asset_clip = root.find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["ref"] == "a1"
    assert asset_clip.attrib["start"] == "30000/3000s"
    assert asset_clip.attrib["duration"] == "12000/3000s"


def test_generate_fcpxml_validates_against_the_1_10_dtd():
    assert_valid_fcpxml(generate_fcpxml(ESTEPONA["title"], ESTEPONA["clips"], ESTEPONA["videos"]))


def test_generate_fcpxml_asset_has_media_rep_and_no_src():
    root = ET.fromstring(generate_fcpxml(ESTEPONA["title"], ESTEPONA["clips"], ESTEPONA["videos"]))
    assets = root.findall("./resources/asset")
    assert [asset.attrib["id"] for asset in assets] == ["a1", "a2", "a3", "a4"]
    for asset, video in zip(assets, ESTEPONA["videos"].values()):
        assert "src" not in asset.attrib
        assert asset.attrib["start"] == "0s"
        assert asset.find("media-rep").attrib == {
            "kind": "original-media",
            "src": f"file://{quote(video['file_path'])}",
        }
    assert all("name" not in fmt.attrib for fmt in root.findall("./resources/format"))


def test_generate_fcpxml_ids_are_valid_for_file_names_with_spaces():
    videos = {"My clip.MOV": {
        "file_id": "My clip.MOV", "file_name": "My clip.MOV",
        "file_path": "/Users/me/My clip.MOV",
        "metadata": {"duration_sec": 12, "fps": 30, "resolution": [1920, 1080]},
    }}
    clips = [{"file_id": "My clip.MOV", "file_name": "My clip.MOV", "start_sec": 0, "end_sec": 4, "duration_sec": 4}]
    xml = generate_fcpxml("IDs", clips, videos)
    assert_valid_fcpxml(xml)
    assert ET.fromstring(xml).find("./resources/asset").attrib["id"] == "a1"


def test_generate_fcpxml_emits_audio_attributes_only_for_audio_assets():
    videos = {
        "stereo": {
            "file_id": "stereo",
            "file_name": "stereo.MP4",
            "file_path": "/Users/me/stereo.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": True,
                "audio_channels": 2,
                "audio_sample_rate": 48000,
                "audio_codec": "aac",
                "audio_bit_depth": 16,
            },
        },
        "silent": {
            "file_id": "silent",
            "file_name": "silent.MP4",
            "file_path": "/Users/me/silent.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": False,
                "audio_channels": None,
                "audio_sample_rate": None,
                "audio_codec": None,
                "audio_bit_depth": None,
            },
        },
    }
    clips = [
        {"file_id": "stereo", "file_name": "stereo.MP4", "start_sec": 0, "duration_sec": 4},
        {"file_id": "silent", "file_name": "silent.MP4", "start_sec": 0, "duration_sec": 4},
    ]

    root = ET.fromstring(generate_fcpxml("Audio", clips, videos))
    assets = {asset.attrib["id"]: asset for asset in root.findall("./resources/asset")}
    audio_asset = assets["a1"]
    silent_asset = assets["a2"]

    assert {
        key: audio_asset.attrib[key]
        for key in ("hasVideo", "hasAudio", "audioSources", "audioChannels", "audioRate")
    } == {
        "hasVideo": "1",
        "hasAudio": "1",
        "audioSources": "1",
        "audioChannels": "2",
        "audioRate": "48000",
    }
    assert all(
        key not in silent_asset.attrib
        for key in ("hasAudio", "audioSources", "audioChannels", "audioRate")
    )
    asset_clips = root.findall("./library/event/project/sequence/spine/asset-clip")
    assert asset_clips[0].attrib["audioRole"] == "dialogue"
    assert "audioRole" not in asset_clips[1].attrib
    assert asset_clips[1].find("./audio") is None
    assert [clip.attrib["ref"] for clip in asset_clips] == ["a1", "a2"]


def test_generate_fcpxml_emits_retime_for_suggested_speed():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": "/Users/me/DJI_0001.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": True,
                "audio_channels": 2,
                "audio_sample_rate": 48000,
            },
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

    generated = generate_fcpxml("Drone MVP", clips, videos)
    assert_valid_fcpxml(generated)
    asset_clip = ET.fromstring(generated).find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["start"] == "30000/3000s"
    assert asset_clip.attrib["duration"] == "24000/3000s"
    assert asset_clip.attrib["audioRole"] == "dialogue"
    # The map spans the clip's local range [start, start + duration].
    assert [
        (timept.attrib["time"], timept.attrib["value"])
        for timept in asset_clip.findall("./timeMap/timept")
    ] == [("30000/3000s", "30000/3000s"), ("18s", "42000/3000s")]


def test_generate_fcpxml_clips_butt_exactly():
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "one.mov",
            "file_path": "/tmp/one.mov",
            "metadata": {"duration_sec": 10, "fps": 30, "resolution": [1920, 1080]},
        }
    }
    clips = [
        {
            "file_id": "file-1",
            "file_name": "one.mov",
            "start_sec": 0,
            "end_sec": 1.02,
            "duration_sec": 1.02,
        }
        for _ in range(3)
    ]
    root = ET.fromstring(generate_fcpxml("Three clips", clips, videos))
    asset_clips = root.findall(".//sequence/spine/asset-clip")
    assert len(asset_clips) == 3
    for previous, current in zip(asset_clips, asset_clips[1:]):
        previous_end = Fraction(previous.attrib["offset"][:-1]) + Fraction(
            previous.attrib["duration"][:-1]
        )
        assert Fraction(current.attrib["offset"][:-1]) == previous_end


@pytest.mark.parametrize("fps,expected_timebase", [(47.952, "48"), (119.88, "120")])
def test_xmeml_declares_ntsc_for_high_ntsc_rates(fps, expected_timebase):
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": "one.mov",
            "file_path": "/tmp/one.mov",
            "metadata": {"duration_sec": 10, "fps": fps, "resolution": [1920, 1080]},
        }
    }
    clips = [
        {
            "file_id": "file-1",
            "file_name": "one.mov",
            "start_sec": 0,
            "end_sec": 1,
            "duration_sec": 1,
        }
    ]
    root = ET.fromstring(generate_resolve_xml("Rate", clips, videos).split("?>", 1)[1])
    rate = root.find("./sequence/rate")
    assert rate is not None
    assert rate.find("timebase").text == expected_timebase
    assert rate.find("ntsc").text == "TRUE"


def test_generate_fcpxml_links_media_by_absolute_file_url(tmp_path):
    source_video = tmp_path / "footage" / "Māris clip.MP4"
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": source_video.name,
            "file_path": str(source_video),
            "metadata": {"duration_sec": 120, "fps": 30, "resolution": [3840, 2160]},
        }
    }
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": source_video.name,
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
        }
    ]

    root = ET.fromstring(generate_fcpxml("Drone MVP", clips, videos))

    asset = root.find(".//asset")
    assert asset is not None
    assert asset.find("media-rep").attrib["src"] == f"file://{quote(str(source_video.absolute()))}"


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


def test_fcpx_frame_duration_covers_the_rate_table():
    expected = {
        23.976: (Fraction(1001, 24000), "1001/24000s", Fraction(24000, 1001)),
        24: (Fraction(1, 24), "100/2400s", Fraction(24)),
        25: (Fraction(1, 25), "100/2500s", Fraction(25)),
        29.97: (Fraction(1001, 30000), "1001/30000s", Fraction(30000, 1001)),
        30: (Fraction(1, 30), "100/3000s", Fraction(30)),
        47.952: (Fraction(1001, 48000), "1001/48000s", Fraction(48000, 1001)),
        50: (Fraction(1, 50), "100/5000s", Fraction(50)),
        59.94: (Fraction(1001, 60000), "1001/60000s", Fraction(60000, 1001)),
        60: (Fraction(1, 60), "100/6000s", Fraction(60)),
        119.88: (Fraction(1001, 120000), "1001/120000s", Fraction(120000, 1001)),
    }
    for rate, (duration, duration_text, exact_rate) in expected.items():
        assert fcpx_frame_duration(rate) == duration
        assert fcpx_frames(1, rate) == duration_text
        assert fps_exact(rate) == exact_rate


def test_fcpx_time_is_frame_aligned():
    assert fcpx_time(10, 23.976) == "240240/24000s"
    assert fcpx_time(0, 23.976) == "0s"


def test_generate_fcpxml_23976_source_exports_24000_1001():
    video = {"cinema": {"file_id": "cinema", "file_name": "cinema.mov", "file_path": "/Users/me/cinema.mov",
                        "metadata": {"duration_sec": 30, "fps": 23.976, "resolution": [1920, 1080]}}}
    clips = [{"file_id": "cinema", "file_name": "cinema.mov", "start_sec": 1.0, "end_sec": 4.0, "duration_sec": 3.0,
              "suggested_speed": 0.5}]
    root = ET.fromstring(generate_fcpxml("Cinema", clips, video))
    assert root.find("./resources/format").attrib["frameDuration"] == "1001/24000s"
    timepoints = root.findall(".//timept")
    assert [point.attrib["value"] for point in timepoints] == ["24024/24000s", "96096/24000s"]


def test_generate_fcpxml_mixed_30_and_60_sources_get_their_own_formats():
    root = ET.fromstring(generate_fcpxml(IPHONE_MIXED["title"], IPHONE_MIXED["clips"], IPHONE_MIXED["videos"]))
    formats = root.findall("./resources/format")
    assert [fmt.attrib["frameDuration"] for fmt in formats] == ["100/6000s", "100/3000s"]
    clips = root.findall(".//sequence/spine/asset-clip")
    assert clips[1].attrib["format"] == "r2"
    assert clips[1].attrib["start"] == "30000/3000s"
    assert clips[1].attrib["offset"] == "36000/6000s"
    assert_valid_fcpxml(ET.tostring(root, encoding="unicode"))


def test_generate_fcpxml_sequence_audio_layout_follows_sources():
    for channels, expected in ((2, "stereo"), (1, "mono"), (6, "surround"), (0, None)):
        case = {"layout": {"file_id": "layout", "file_name": "layout.mov", "file_path": "/Users/me/layout.mov",
                            "metadata": {"duration_sec": 12, "fps": 30, "resolution": [1920, 1080],
                                         "has_audio": channels > 0, "audio_channels": channels or None}}}
        clip = [{"file_id": "layout", "file_name": "layout.mov", "start_sec": 0, "end_sec": 4, "duration_sec": 4}]
        root = ET.fromstring(generate_fcpxml("Audio", clip, case))
        sequence = root.find(".//sequence")
        assert sequence.attrib.get("audioLayout") == expected
        assert_valid_fcpxml(ET.tostring(root, encoding="unicode"))


def test_export_xml_golden_fixtures_are_unchanged(request):
    fixture_dir = Path(__file__).parent / "fixtures" / "export"
    cases = (
        ("estepona-1080p5994.fcpxml", ESTEPONA),
        ("iphone-4k60-mixed.fcpxml", IPHONE_MIXED),
        ("cinema-23976-silent.fcpxml", CINEMA),
        ("iphone-vfr-1080p5994-vertical.fcpxml", IPHONE_VFR_1080P5994_VERTICAL),
        ("estepona-1080p5994.xml", ESTEPONA),
        ("cinema-23976-silent.xml", CINEMA),
        ("iphone-vfr-1080p5994-vertical.xml", IPHONE_VFR_1080P5994_VERTICAL),
    )
    for filename, case in cases:
        if filename.endswith(".fcpxml"):
            generated = generate_fcpxml(case["title"], case["clips"], case["videos"])
            assert_valid_fcpxml(generated)
        else:
            generated = generate_resolve_xml(case["title"], case["clips"], case["videos"])
            assert_well_formed_xmeml(generated)
        path = fixture_dir / filename
        if request.config.getoption("--update-export-fixtures"):
            path.write_text(generated)
            continue
        expected = path.read_text()
        if generated != expected:
            diff = difflib.unified_diff(
                expected.splitlines(keepends=True),
                generated.splitlines(keepends=True),
                fromfile=str(path),
                tofile="generated",
            )
            import pytest
            pytest.fail(f"XML golden fixture mismatch ({filename}):\n" + "".join(diff))


def test_seconds_to_frames_uses_exact_ntsc_rate():
    assert seconds_to_frames(60, 23.976) == 1438
    assert seconds_to_frames(60, 59.94) == 3596


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


@pytest.mark.parametrize(
    ("fps", "expected"),
    [
        (59.96, 59.94),
        (59.93, 59.94),
        (60, 60),
        (29.98, 29.97),
        (23.98, 23.976),
        (25.02, 25),
        (15, 15),
        (0, 30),
    ],
)
def test_snap_frame_rate(fps, expected):
    assert snap_frame_rate(fps) == expected


def test_choose_timeline_fps_ignores_unused_source():
    videos = {
        "used": {"metadata": {"fps": 59.94}},
        "unused": {"metadata": {"fps": 119.88}},
    }
    clips = [{"file_id": "used"}]
    assert choose_timeline_fps(videos, clips) == 59.94


def test_choose_timeline_fps_majority_tie_uses_higher_rate():
    videos = {
        "low-1": {"metadata": {"fps": 25}},
        "low-2": {"metadata": {"fps": 25}},
        "high-1": {"metadata": {"fps": 30}},
        "high-2": {"metadata": {"fps": 30}},
    }
    clips = [{"file_id": file_id} for file_id in videos]
    assert choose_timeline_fps(videos, clips) == 30


def test_edl_record_out_uses_exact_ntsc_rate():
    clips = [
        {
            "file_id": "file-1",
            "file_name": "clip.mov",
            "start_sec": 0,
            "end_sec": 30.4,
            "duration_sec": 30.4,
        }
    ]
    edl = generate_edl("NTSC", clips, fps=59.94)
    record = next(line for line in edl.splitlines() if line.startswith("001"))
    assert record.split()[-1] == "00:00:30:22"
    assert round_edl_fps(59.96) == 59.94


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


def make_audio_resolve_videos_and_clips():
    videos = {
        "stereo": {
            "file_id": "stereo",
            "file_name": "stereo.MP4",
            "file_path": "/Users/me/footage/stereo.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": True,
                "audio_channels": 2,
                "audio_sample_rate": 48000,
                "audio_bit_depth": 16,
            },
        },
        "mono": {
            "file_id": "mono",
            "file_name": "mono.MP4",
            "file_path": "/Users/me/footage/mono.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": True,
                "audio_channels": 1,
                "audio_sample_rate": 44100,
                "audio_bit_depth": 24,
            },
        },
        "silent": {
            "file_id": "silent",
            "file_name": "silent.MP4",
            "file_path": "/Users/me/footage/silent.MP4",
            "metadata": {
                "duration_sec": 120,
                "fps": 30,
                "resolution": [3840, 2160],
                "has_audio": False,
                "audio_channels": None,
                "audio_sample_rate": None,
                "audio_bit_depth": None,
            },
        },
    }
    clips = [
        {
            "clip_id": "clip-stereo",
            "file_id": "stereo",
            "file_name": "stereo.MP4",
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
        },
        {
            "clip_id": "clip-silent",
            "file_id": "silent",
            "file_name": "silent.MP4",
            "start_sec": 5.0,
            "end_sec": 8.0,
            "duration_sec": 3.0,
        },
        {
            "clip_id": "clip-mono",
            "file_id": "mono",
            "file_name": "mono.MP4",
            "start_sec": 20.0,
            "end_sec": 22.0,
            "duration_sec": 2.0,
            "suggested_speed": 0.5,
        },
    ]
    return videos, clips


def test_generate_resolve_xml_emits_linked_per_channel_audio_tracks():
    videos, clips = make_audio_resolve_videos_and_clips()

    root = ET.fromstring(generate_resolve_xml("Audio", clips, videos).split("?>", 1)[1])
    sequence_media = root.find("./sequence/media")
    assert sequence_media is not None
    audio = sequence_media.find("./audio")
    assert audio is not None
    assert audio.find("./channelcount").text == "2"
    assert audio.find("./format/samplecharacteristics/depth").text == "16"
    assert audio.find("./format/samplecharacteristics/samplerate").text == "48000"

    video_track = sequence_media.find("./video/track")
    audio_tracks = sequence_media.findall("./audio/track")
    assert video_track is not None
    assert len(video_track.findall("./clipitem")) == 3
    assert len(audio_tracks) == 2
    assert [len(track.findall("./clipitem")) for track in audio_tracks] == [2, 1]

    video_item = video_track.findall("./clipitem")[0]
    audio_items = [track.findall("./clipitem")[0] for track in audio_tracks]
    assert video_item.attrib["id"] == audio_items[0].attrib["id"] == audio_items[1].attrib["id"]
    assert video_item.find("./sourcetrack/mediatype").text == "video"
    assert video_item.find("./sourcetrack/trackindex").text == "1"
    assert [item.find("./sourcetrack/mediatype").text for item in audio_items] == ["audio", "audio"]
    assert [item.find("./sourcetrack/trackindex").text for item in audio_items] == ["1", "2"]
    assert [item.find("./start").text for item in audio_items] == [video_item.find("./start").text] * 2
    assert [link.find("./mediatype").text for link in video_item.findall("./link")] == [
        "video",
        "audio",
        "audio",
    ]
    assert [link.find("./trackindex").text for link in video_item.findall("./link")] == ["1", "1", "2"]
    assert [link.find("./clipindex").text for link in video_item.findall("./link")] == ["1", "1", "1"]
    assert [link.find("./groupindex").text for link in video_item.findall("./link")[1:]] == ["1", "1"]

    silent_item = video_track.findall("./clipitem")[1]
    assert silent_item.findall("./link/mediatype") == []
    assert root.find("./sequence/media/video/track/clipitem[2]/file/media/audio") is None
    assert root.find("./sequence/media/video/track/clipitem[2]/file/media/video") is not None

    mono_item = video_track.findall("./clipitem")[2]
    mono_link_media = [link.find("./mediatype").text for link in mono_item.findall("./link")]
    assert mono_link_media == ["video", "audio"]
    # The silent middle item holds a video slot but no audio slot, so the mono
    # item is video clip 3 and audio clip 2 on its track.
    assert [link.find("./clipindex").text for link in mono_item.findall("./link")] == ["3", "2"]
    assert mono_item.findall("./link/groupindex") == []
    mono_audio = audio_tracks[0].findall("./clipitem")[1]
    mono_video = video_track.findall("./clipitem")[2]
    assert mono_audio.find("./filter/effect/mediatype").text == "audio"
    assert mono_audio.find("./filter/effect/parameter/value").text == "50.0"
    assert mono_video.find("./filter/effect/mediatype").text == "video"
    for path in ("name", "duration", "rate/timebase", "start", "end", "in", "out"):
        assert mono_audio.find(path).text == mono_video.find(path).text


def test_generate_resolve_xml_declares_audio_on_first_file_use_only():
    videos, clips = make_audio_resolve_videos_and_clips()
    repeated_clips = [clips[0], {**clips[0], "clip_id": "clip-stereo-2"}]

    root = ET.fromstring(generate_resolve_xml("Repeated", repeated_clips, videos).split("?>", 1)[1])
    video_items = root.findall("./sequence/media/video/track/clipitem")
    audio_items = root.findall("./sequence/media/audio/track/clipitem")
    first_file = video_items[0].find("./file")
    repeated_file = video_items[1].find("./file")

    assert first_file.find("./media/audio/channelcount").text == "2"
    assert first_file.find("./media/audio/format/samplecharacteristics/depth").text == "16"
    assert first_file.find("./media/audio/format/samplecharacteristics/samplerate").text == "48000"
    assert repeated_file.attrib["id"] == first_file.attrib["id"]
    assert list(repeated_file) == []
    assert all(list(item.find("./file")) == [] for item in audio_items)


def test_generate_resolve_xml_groups_each_true_audio_pair():
    videos, clips = make_audio_resolve_videos_and_clips()
    videos["surround"] = {
        "file_id": "surround",
        "file_name": "surround.MP4",
        "file_path": "/Users/me/footage/surround.MP4",
        "metadata": {
            "duration_sec": 120,
            "fps": 30,
            "resolution": [3840, 2160],
            "has_audio": True,
            "audio_channels": 4,
            "audio_sample_rate": 48000,
            "audio_bit_depth": 24,
        },
    }
    surround_clip = {**clips[0], "file_id": "surround", "file_name": "surround.MP4"}

    root = ET.fromstring(generate_resolve_xml("Surround", [surround_clip], videos).split("?>", 1)[1])
    links = root.findall("./sequence/media/video/track/clipitem/link")

    assert len(root.findall("./sequence/media/audio/track")) == 4
    assert [link.find("./trackindex").text for link in links] == ["1", "1", "2", "3", "4"]
    assert [
        link.find("./groupindex").text if link.find("./groupindex") is not None else None
        for link in links
    ] == [None, "1", "1", "2", "2"]


def test_generate_resolve_xml_keeps_silent_timeline_video_only():
    videos, clips = make_audio_resolve_videos_and_clips()
    silent_clips = [clips[1]]

    root = ET.fromstring(generate_resolve_xml("Silent", silent_clips, videos).split("?>", 1)[1])

    assert root.find("./sequence/media/audio") is None
    assert len(root.findall("./sequence/media/video/track/clipitem")) == 1
    assert root.find("./sequence/media/video/track/clipitem/file/media/audio") is None
    assert root.findall("./sequence/media/video/track/clipitem/link") == []


def test_generate_resolve_xml_builds_xmeml_timeline():
    videos, clips = make_resolve_videos_and_clips()

    xml = generate_resolve_xml("Drone MVP", clips, videos)

    root = ET.fromstring(xml.split("?>", 1)[1])
    assert root.tag == "xmeml"
    assert root.attrib["version"] == "5"
    assert root.find("./sequence/name").text == "Drone MVP"
    assert root.find("./sequence/rate/timebase").text == "30"

    clipitems = root.findall("./sequence/media/video/track/clipitem")
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


def test_generate_resolve_xml_passes_structure_checks():
    assert_well_formed_xmeml(
        generate_resolve_xml(ESTEPONA["title"], ESTEPONA["clips"], ESTEPONA["videos"])
    )


def test_generate_resolve_xml_defines_each_source_file_once():
    videos, clips = make_resolve_videos_and_clips()

    root = ET.fromstring(generate_resolve_xml("Drone MVP", clips, videos).split("?>", 1)[1])

    files = [item.find("file") for item in root.findall("./sequence/media/video/track/clipitem")]
    assert files[0].attrib["id"] == files[2].attrib["id"]
    assert files[0].find("pathurl") is not None
    assert len(files[2]) == 0  # repeat reference carries only the id
    assert files[0].find("pathurl").text == "file://localhost/Users/me/footage/DJI_0001.MP4"


def test_generate_resolve_xml_pathurl_is_absolute_localhost_url(tmp_path):
    source_video = tmp_path / "footage" / "Māris clip.MP4"
    videos = {
        "file-1": {
            "file_id": "file-1",
            "file_name": source_video.name,
            "file_path": str(source_video),
            "metadata": {"duration_sec": 120, "fps": 30, "resolution": [3840, 2160]},
        }
    }
    clips = [
        {
            "clip_id": "clip-1",
            "file_id": "file-1",
            "file_name": source_video.name,
            "start_sec": 10.0,
            "end_sec": 14.0,
            "duration_sec": 4.0,
        }
    ]

    root = ET.fromstring(generate_resolve_xml("Drone MVP", clips, videos).split("?>", 1)[1])

    pathurl = root.find(".//clipitem/file/pathurl")
    assert pathurl is not None
    assert pathurl.text == f"file://localhost{quote(str(source_video.absolute()))}"


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
    # 0.1 * 1920 = 192; -0.2 * 1080 = -216; scale is preserved on both axes.
    assert adjust.get("position") == "192.0 -216.0"
    assert adjust.get("scale") == "1.5 1.5"


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
    scale = next(
        p.find("value")
        for p in root.findall(".//clipitem/filter/effect/parameter")
        if p.find("parameterid") is not None and p.find("parameterid").text == "scale"
    )
    center = next(
        p.find("value")
        for p in root.findall(".//clipitem/filter/effect/parameter")
        if p.find("parameterid") is not None and p.find("parameterid").text == "center"
    )
    # 1.5 * 100 = 150%; the normalized center offsets remain 0.1 and -0.2.
    assert scale.text == "150.0"
    assert center.find("horiz").text == "0.1"
    assert center.find("vert").text == "-0.2"


def test_edl_flatten_warnings_flags_speed_and_transform():
    plain = [{"clip_id": "c", "file_id": "f", "file_name": "x.MP4", "start_sec": 0, "end_sec": 2, "duration_sec": 2}]
    assert edl_flatten_warnings(plain) == []

    speedy = [{**plain[0], "suggested_speed": 0.5}]
    assert edl_flatten_warnings(speedy)

    zoomed = [_transform_clip(scale=1.4)]
    assert edl_flatten_warnings(zoomed)


def test_generate_edl_uses_source_audio_channel_codes_and_warns_only_for_loss():
    videos, clips = make_audio_resolve_videos_and_clips()
    videos["surround"] = {
        "metadata": {"has_audio": True, "audio_channels": 4},
        "file_name": "surround.MP4",
    }
    mono, silent, stereo = clips[2], clips[1], clips[0]
    surround = {
        "clip_id": "clip-surround",
        "file_id": "surround",
        "file_name": "surround.MP4",
        "start_sec": 0.0,
        "end_sec": 2.0,
        "duration_sec": 2.0,
    }

    edl = generate_edl("Audio", [mono, stereo, silent, surround], fps=30, videos_by_id=videos)

    assert "001  AX       B     C" in edl
    assert "002  AX       AA/V  C" in edl
    assert "003  AX       V     C" in edl
    assert "004  AX       AA/V  C" in edl
    assert "channels 1–2" in "\n".join(edl_flatten_warnings([surround], videos))
    assert edl_flatten_warnings([silent], videos) == []
    assert edl_flatten_warnings([stereo], videos) == []


def test_generate_edl_flattens_speed_instead_of_emitting_retime_commands():
    clip = {
        "clip_id": "c",
        "file_id": "f",
        "file_name": "x.MP4",
        "start_sec": 10,
        "end_sec": 14,
        "duration_sec": 4,
        "suggested_speed": 2,
    }

    edl = generate_edl("T", [clip], fps=30)

    assert "00:00:10:00 00:00:14:00 00:00:00:00 00:00:04:00" in edl
    assert "M2" not in edl
    assert "Speed" in edl


def test_generate_edl_notes_flattening_when_transform_present():
    edl = generate_edl("T", [_transform_clip(scale=1.4)], fps=30)
    assert "flatten" in edl.lower()


def test_choose_timeline_fps_majority_counts_timeline_items_not_max_rate():
    videos = {
        "pal": {"metadata": {"fps": 25}},
        "fast": {"metadata": {"fps": 60}},
    }
    clips = [{"file_id": "pal"}, {"file_id": "pal"}, {"file_id": "pal"}, {"file_id": "fast"}]

    assert choose_timeline_fps(videos, clips) == 25


def test_timeline_dimensions_follow_the_first_timeline_source_not_the_first_project_source():
    videos = {
        "unused-landscape": {"metadata": {"display_resolution": [1920, 1080]}},
        "iphone-portrait": {"metadata": {"display_resolution": [1080, 1920]}},
    }

    assert timeline_dimensions(videos, [{"file_id": "iphone-portrait"}]) == [1080, 1920]


def test_sub_one_fps_rates_keep_a_nonzero_frame_base():
    assert seconds_to_timecode(30.4, fps=0.25) == "00:00:30:00"
    assert fcpx_frame_duration(0.25) == 1
