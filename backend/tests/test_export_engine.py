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
    assert asset.attrib["src"] == "file:///Users/me/DJI_0001.MP4"
    asset_clip = root.find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["ref"] == "asset-file-1"
    assert asset_clip.attrib["start"] == "10000/1000s"
    assert asset_clip.attrib["duration"] == "4000/1000s"


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
    audio_asset = assets["asset-stereo"]
    silent_asset = assets["asset-silent"]

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
    assert [clip.attrib["ref"] for clip in asset_clips] == ["asset-stereo", "asset-silent"]


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

    root = ET.fromstring(generate_fcpxml("Drone MVP", clips, videos))
    asset_clip = root.find(".//asset-clip")
    assert asset_clip is not None
    assert asset_clip.attrib["duration"] == "8000/1000s"
    assert asset_clip.attrib["audioRole"] == "dialogue"
    assert asset_clip.find("timeMap/timept") is not None
    assert [timept.attrib["value"] for timept in asset_clip.findall("./timeMap/timept")] == [
        "10000/1000s",
        "14000/1000s",
    ]


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


def test_generate_resolve_xml_defines_each_source_file_once():
    videos, clips = make_resolve_videos_and_clips()

    root = ET.fromstring(generate_resolve_xml("Drone MVP", clips, videos).split("?>", 1)[1])

    files = [item.find("file") for item in root.findall("./sequence/media/video/track/clipitem")]
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
