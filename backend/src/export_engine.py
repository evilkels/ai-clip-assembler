import os
import math
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote
import xml.etree.ElementTree as ET


def seconds_to_timecode(seconds: float, fps: float = 30) -> str:
    fps = int(round(fps))
    if fps <= 0:
        fps = 30
    total_frames = int(round(seconds * fps))
    frames = total_frames % fps
    total_seconds = total_frames // fps
    secs = total_seconds % 60
    total_minutes = total_seconds // 60
    minutes = total_minutes % 60
    hours = total_minutes // 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}:{frames:02d}"


def seconds_to_fcpx_duration(seconds: float) -> str:
    milliseconds = int(round(seconds * 1000))
    return f"{milliseconds}/1000s"


def fcpx_frame_duration(fps: float) -> str:
    if abs(fps - 29.97) < 0.02:
        return "1001/30000s"
    if abs(fps - 59.94) < 0.02:
        return "1001/60000s"
    rounded = int(round(fps or 30))
    return f"100/{rounded * 100}s"


def choose_timeline_fps(videos_by_id: Dict[str, dict]) -> float:
    rates = []
    for video in videos_by_id.values():
        fps_val = (video.get("metadata") or {}).get("fps")
        if fps_val is None:
            continue
        try:
            fps = float(fps_val)
        except (TypeError, ValueError):
            continue
        if fps > 0:
            rates.append(fps)
    return max(rates) if rates else 30.0


def timeline_dimensions(videos_by_id: Dict[str, dict]) -> list[int]:
    for video in videos_by_id.values():
        metadata = video.get("metadata") or {}
        display = metadata.get("display_resolution") or metadata.get("resolution")
        if display and len(display) == 2:
            return [int(display[0]), int(display[1])]
    return [1920, 1080]


def path_to_file_url(path: str) -> str:
    return "file://" + quote(str(Path(path).absolute()))


def path_to_asset_src(path: str, media_base_path: Optional[Path] = None) -> str:
    if media_base_path is None:
        return path_to_file_url(path)
    return Path(os.path.relpath(Path(path).resolve(), media_base_path.resolve())).as_posix()


def effective_duration(clip: dict) -> float:
    return float(clip["duration_sec"]) / max(0.01, float(clip.get("suggested_speed", 1.0) or 1.0))


def _positive_int(value: object) -> Optional[int]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0 or not number.is_integer():
        return None
    return int(number)


def source_audio_channels(source: dict) -> int:
    metadata = source.get("metadata") or {}
    if metadata.get("has_audio") is not True:
        return 0
    return _positive_int(metadata.get("audio_channels")) or 1


def source_audio_sample_rate(source: dict) -> int:
    metadata = source.get("metadata") or {}
    return _positive_int(metadata.get("audio_sample_rate")) or 48000


def source_audio_bit_depth(source: dict) -> int:
    metadata = source.get("metadata") or {}
    return _positive_int(metadata.get("audio_bit_depth")) or 16


def clip_transform(clip: dict) -> Optional[dict]:
    """A clip's non-identity Transform, or ``None`` for identity/absent."""
    transform = clip.get("transform")
    if not transform:
        return None
    scale = float(transform.get("scale", 1.0) or 1.0)
    x = float(transform.get("x", 0.0) or 0.0)
    y = float(transform.get("y", 0.0) or 0.0)
    if scale == 1.0 and x == 0.0 and y == 0.0:
        return None
    return {"scale": scale, "x": x, "y": y}


def edl_flatten_warnings(
    clips: List[dict], videos_by_id: Optional[Dict[str, dict]] = None
) -> List[str]:
    """EDL cannot faithfully represent Speed/Transform; warn when present.

    Returned to the caller so the GUI can surface that an EDL export dropped
    retime/reframe information (use FCPXML or Resolve XML to preserve it).
    """
    has_speed = any(float(clip.get("suggested_speed", 1.0) or 1.0) != 1.0 for clip in clips)
    has_transform = any(clip_transform(clip) is not None for clip in clips)
    flattened = []
    flattened_warnings = []
    if has_speed:
        flattened.append("Speed")
    if has_transform:
        flattened.append("Transform")
    if flattened:
        flattened_warnings.append(
            f"EDL cannot represent {' and '.join(flattened)}; it was flattened. "
            "Export FCPXML or Resolve XML to preserve it."
        )
    if videos_by_id:
        has_more_than_two_channels = any(
            source_audio_channels(videos_by_id.get(clip["file_id"], {})) > 2 for clip in clips
        )
        if has_more_than_two_channels:
            flattened_warnings.append(
                "EDL carries only audio channels 1–2; additional source channels were dropped."
            )
    return flattened_warnings


def edl_channel_code(clip: dict, videos_by_id: Optional[Dict[str, dict]]) -> str:
    if not videos_by_id:
        return "V"
    channels = source_audio_channels(videos_by_id.get(clip["file_id"], {}))
    if channels <= 0:
        return "V"
    if channels == 1:
        return "B"
    return "AA/V"


def generate_edl(
    title: str,
    clips: List[dict],
    fps: float = 30,
    videos_by_id: Optional[Dict[str, dict]] = None,
) -> str:
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    for warning in edl_flatten_warnings(clips, videos_by_id):
        lines.append(f"* NOTE: {warning}")
    if len(lines) > 3:
        lines.append("")
    timeline_cursor = 0.0
    for index, clip in enumerate(clips, start=1):
        source_in = clip["start_sec"]
        source_out = clip["end_sec"]
        record_in = timeline_cursor
        record_out = timeline_cursor + float(clip["duration_sec"])
        lines.append(
            f"{index:03d}  AX       {edl_channel_code(clip, videos_by_id):<5} C        "
            f"{seconds_to_timecode(source_in, fps)} "
            f"{seconds_to_timecode(source_out, fps)} "
            f"{seconds_to_timecode(record_in, fps)} "
            f"{seconds_to_timecode(record_out, fps)}"
        )
        lines.append(f"* FROM CLIP NAME: {clip['file_name']}")
        lines.append("")
        timeline_cursor = record_out
    return "\n".join(lines)


def is_ntsc_rate(fps: float) -> bool:
    return abs(fps - 29.97) < 0.02 or abs(fps - 59.94) < 0.02 or abs(fps - 23.976) < 0.02


def xmeml_timebase(fps: float) -> int:
    if abs(fps - 29.97) < 0.02:
        return 30
    if abs(fps - 59.94) < 0.02:
        return 60
    if abs(fps - 23.976) < 0.02:
        return 24
    return int(round(fps or 30))


def append_xmeml_rate(parent: ET.Element, fps: float) -> None:
    rate = ET.SubElement(parent, "rate")
    ET.SubElement(rate, "timebase").text = str(xmeml_timebase(fps))
    ET.SubElement(rate, "ntsc").text = "TRUE" if is_ntsc_rate(fps) else "FALSE"


def seconds_to_frames(seconds: float, fps: float) -> int:
    return int(round(seconds * xmeml_timebase(fps)))


def append_xmeml_time_remap(clipitem: ET.Element, speed: float, mediatype: str) -> None:
    filter_element = ET.SubElement(clipitem, "filter")
    effect = ET.SubElement(filter_element, "effect")
    ET.SubElement(effect, "name").text = "Time Remap"
    ET.SubElement(effect, "effectid").text = "timeremap"
    ET.SubElement(effect, "mediatype").text = mediatype
    parameter = ET.SubElement(effect, "parameter")
    ET.SubElement(parameter, "parameterid").text = "speed"
    ET.SubElement(parameter, "value").text = str(round(speed * 100, 3))


def append_xmeml_clip_timing(
    clipitem: ET.Element,
    clip: dict,
    source_duration: float,
    timeline_cursor: float,
    fps: float,
) -> None:
    ET.SubElement(clipitem, "name").text = clip["file_name"]
    ET.SubElement(clipitem, "enabled").text = "TRUE"
    ET.SubElement(clipitem, "duration").text = str(
        seconds_to_frames(source_duration or clip["duration_sec"], fps)
    )
    append_xmeml_rate(clipitem, fps)
    ET.SubElement(clipitem, "start").text = str(seconds_to_frames(timeline_cursor, fps))
    timeline_duration = effective_duration(clip)
    ET.SubElement(clipitem, "end").text = str(
        seconds_to_frames(timeline_cursor + timeline_duration, fps)
    )
    ET.SubElement(clipitem, "in").text = str(seconds_to_frames(clip["start_sec"], fps))
    ET.SubElement(clipitem, "out").text = str(seconds_to_frames(clip["end_sec"], fps))


def generate_resolve_xml(
    title: str,
    clips: List[dict],
    videos_by_id: Dict[str, dict],
    media_base_path: Optional[Path] = None,
) -> str:
    """FCP7 XMEML v5 timeline for DaVinci Resolve's XML importer.

    With media_base_path set, pathurl is written relative to the export
    directory so the project folder stays portable (QA Flow C).
    """
    fps = choose_timeline_fps(videos_by_id)
    width, height = timeline_dimensions(videos_by_id)
    total_frames = seconds_to_frames(sum(effective_duration(clip) for clip in clips), fps)

    xmeml = ET.Element("xmeml", {"version": "5"})
    sequence = ET.SubElement(xmeml, "sequence", {"id": "sequence-1"})
    ET.SubElement(sequence, "name").text = title
    ET.SubElement(sequence, "duration").text = str(total_frames)
    append_xmeml_rate(sequence, fps)
    timecode = ET.SubElement(sequence, "timecode")
    append_xmeml_rate(timecode, fps)
    ET.SubElement(timecode, "string").text = "00:00:00:00"
    ET.SubElement(timecode, "frame").text = "0"
    ET.SubElement(timecode, "displayformat").text = "DF" if is_ntsc_rate(fps) else "NDF"

    media = ET.SubElement(sequence, "media")
    video = ET.SubElement(media, "video")
    video_format = ET.SubElement(video, "format")
    characteristics = ET.SubElement(video_format, "samplecharacteristics")
    ET.SubElement(characteristics, "width").text = str(width)
    ET.SubElement(characteristics, "height").text = str(height)
    append_xmeml_rate(characteristics, fps)
    track = ET.SubElement(video, "track")

    audio_channel_counts = [
        source_audio_channels(videos_by_id.get(clip["file_id"], {})) for clip in clips
    ]
    max_audio_channels = max(audio_channel_counts, default=0)
    audio_tracks = []
    if max_audio_channels:
        audio = ET.SubElement(media, "audio")
        ET.SubElement(audio, "channelcount").text = str(max_audio_channels)
        audio_format = ET.SubElement(audio, "format")
        audio_characteristics = ET.SubElement(audio_format, "samplecharacteristics")
        first_audio_source = next(
            videos_by_id.get(clip["file_id"], {})
            for clip in clips
            if source_audio_channels(videos_by_id.get(clip["file_id"], {}))
        )
        ET.SubElement(audio_characteristics, "depth").text = str(
            source_audio_bit_depth(first_audio_source)
        )
        ET.SubElement(audio_characteristics, "samplerate").text = str(
            source_audio_sample_rate(first_audio_source)
        )
        audio_tracks = [ET.SubElement(audio, "track") for _ in range(max_audio_channels)]

    defined_file_ids = set()
    timeline_cursor = 0.0
    for index, clip in enumerate(clips, start=1):
        source = videos_by_id.get(clip["file_id"], {})
        source_metadata = source.get("metadata") or {}
        source_duration = float(source_metadata.get("duration_sec", 0) or 0)
        item_id = f"clipitem-{index}"

        clipitem = ET.SubElement(track, "clipitem", {"id": item_id})
        append_xmeml_clip_timing(clipitem, clip, source_duration, timeline_cursor, fps)
        sourcetrack = ET.SubElement(clipitem, "sourcetrack")
        ET.SubElement(sourcetrack, "mediatype").text = "video"
        ET.SubElement(sourcetrack, "trackindex").text = "1"

        file_id = f"file-{clip['file_id']}"
        file_element = ET.SubElement(clipitem, "file", {"id": file_id})
        if file_id not in defined_file_ids:
            defined_file_ids.add(file_id)
            ET.SubElement(file_element, "name").text = clip["file_name"]
            pathurl = ET.SubElement(file_element, "pathurl")
            pathurl.text = (
                path_to_asset_src(source["file_path"], media_base_path)
                if source.get("file_path")
                else clip["file_name"]
            )
            append_xmeml_rate(file_element, fps)
            ET.SubElement(file_element, "duration").text = str(
                seconds_to_frames(source_duration, fps)
            )
            file_media = ET.SubElement(file_element, "media")
            file_video = ET.SubElement(file_media, "video")
            file_characteristics = ET.SubElement(file_video, "samplecharacteristics")
            ET.SubElement(file_characteristics, "width").text = str(width)
            ET.SubElement(file_characteristics, "height").text = str(height)
            if audio_channel_counts[index - 1]:
                file_audio = ET.SubElement(file_media, "audio")
                ET.SubElement(file_audio, "channelcount").text = str(audio_channel_counts[index - 1])
                file_audio_format = ET.SubElement(file_audio, "format")
                file_audio_characteristics = ET.SubElement(
                    file_audio_format, "samplecharacteristics"
                )
                ET.SubElement(file_audio_characteristics, "depth").text = str(
                    source_audio_bit_depth(source)
                )
                ET.SubElement(file_audio_characteristics, "samplerate").text = str(
                    source_audio_sample_rate(source)
                )

        speed = float(clip.get("suggested_speed", 1.0) or 1.0)
        if speed != 1.0:
            append_xmeml_time_remap(clipitem, speed, "video")

        transform = clip_transform(clip)
        if transform is not None:
            motion_filter = ET.SubElement(clipitem, "filter")
            motion = ET.SubElement(motion_filter, "effect")
            ET.SubElement(motion, "name").text = "Basic Motion"
            ET.SubElement(motion, "effectid").text = "basic"
            ET.SubElement(motion, "effectcategory").text = "motion"
            ET.SubElement(motion, "effecttype").text = "motion"
            ET.SubElement(motion, "mediatype").text = "video"
            scale_param = ET.SubElement(motion, "parameter")
            ET.SubElement(scale_param, "parameterid").text = "scale"
            ET.SubElement(scale_param, "name").text = "Scale"
            ET.SubElement(scale_param, "value").text = str(round(transform["scale"] * 100, 3))
            center_param = ET.SubElement(motion, "parameter")
            ET.SubElement(center_param, "parameterid").text = "center"
            ET.SubElement(center_param, "name").text = "Center"
            center_value = ET.SubElement(center_param, "value")
            ET.SubElement(center_value, "horiz").text = str(transform["x"])
            ET.SubElement(center_value, "vert").text = str(transform["y"])

        if audio_channel_counts[index - 1]:
            video_link = ET.SubElement(clipitem, "link")
            ET.SubElement(video_link, "mediatype").text = "video"
            ET.SubElement(video_link, "trackindex").text = "1"
            ET.SubElement(video_link, "clipindex").text = str(index)
            for channel in range(1, audio_channel_counts[index - 1] + 1):
                audio_item = ET.SubElement(audio_tracks[channel - 1], "clipitem", {"id": item_id})
                append_xmeml_clip_timing(audio_item, clip, source_duration, timeline_cursor, fps)
                audio_sourcetrack = ET.SubElement(audio_item, "sourcetrack")
                ET.SubElement(audio_sourcetrack, "mediatype").text = "audio"
                ET.SubElement(audio_sourcetrack, "trackindex").text = str(channel)
                ET.SubElement(audio_item, "file", {"id": file_id})
                if speed != 1.0:
                    append_xmeml_time_remap(audio_item, speed, "audio")

                audio_link = ET.SubElement(clipitem, "link")
                ET.SubElement(audio_link, "mediatype").text = "audio"
                ET.SubElement(audio_link, "trackindex").text = str(channel)
                # clipindex counts items within the linked track, and a silent
                # item occupies the video track without an audio companion.
                ET.SubElement(audio_link, "clipindex").text = str(
                    len(audio_tracks[channel - 1].findall("clipitem"))
                )
                if channel % 2 == 0:
                    ET.SubElement(audio_link, "groupindex").text = str((channel + 1) // 2)
                    previous_link = clipitem.findall("link")[-2]
                    ET.SubElement(previous_link, "groupindex").text = str((channel + 1) // 2)

        timeline_cursor += effective_duration(clip)

    body = ET.tostring(xmeml, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + body


def generate_fcpxml(
    title: str,
    clips: List[dict],
    videos_by_id: Dict[str, dict],
    media_base_path: Optional[Path] = None,
) -> str:
    fcpxml = ET.Element("fcpxml", {"version": "1.10"})
    resources = ET.SubElement(fcpxml, "resources")
    fps = choose_timeline_fps(videos_by_id)
    width, height = timeline_dimensions(videos_by_id)
    ET.SubElement(
        resources,
        "format",
        {
            "id": "r1",
            "name": f"FFVideoFormat{width}x{height}p{round(fps, 2)}",
            "frameDuration": fcpx_frame_duration(fps),
            "width": str(width),
            "height": str(height),
        },
    )

    for file_id, video in videos_by_id.items():
        metadata = video.get("metadata") or {}
        duration = float(metadata.get("duration_sec", 0) or 0)
        asset_attributes = {
            "id": f"asset-{file_id}",
            "name": video["file_name"],
            "src": path_to_asset_src(video["file_path"], media_base_path),
            "duration": seconds_to_fcpx_duration(duration),
            "hasVideo": "1",
        }
        audio_channels = source_audio_channels(video)
        if audio_channels:
            asset_attributes.update(
                {
                    "hasAudio": "1",
                    "audioSources": "1",
                    "audioChannels": str(audio_channels),
                    "audioRate": str(source_audio_sample_rate(video)),
                }
            )
        ET.SubElement(
            resources,
            "asset",
            asset_attributes,
        )

    library = ET.SubElement(fcpxml, "library")
    event = ET.SubElement(library, "event", {"name": title})
    project = ET.SubElement(event, "project", {"name": title})
    sequence = ET.SubElement(project, "sequence", {"format": "r1", "tcStart": "0s", "tcFormat": "NDF"})
    spine = ET.SubElement(sequence, "spine")

    timeline_cursor = 0.0
    for clip in clips:
        speed = max(0.01, float(clip.get("suggested_speed", 1.0) or 1.0))
        timeline_duration = clip["duration_sec"] / speed
        asset_clip = ET.SubElement(
            spine,
            "asset-clip",
            {
                "name": clip["file_name"],
                "ref": f"asset-{clip['file_id']}",
                "offset": seconds_to_fcpx_duration(timeline_cursor),
                "start": seconds_to_fcpx_duration(clip["start_sec"]),
                "duration": seconds_to_fcpx_duration(timeline_duration),
            },
        )
        if source_audio_channels(videos_by_id.get(clip["file_id"], {})):
            asset_clip.set("audioRole", "dialogue")
        if speed != 1.0:
            time_map = ET.SubElement(asset_clip, "timeMap")
            ET.SubElement(
                time_map,
                "timept",
                {"time": "0s", "value": seconds_to_fcpx_duration(clip["start_sec"])},
            )
            ET.SubElement(
                time_map,
                "timept",
                {
                    "time": seconds_to_fcpx_duration(timeline_duration),
                    "value": seconds_to_fcpx_duration(clip["end_sec"]),
                },
            )
        transform = clip_transform(clip)
        if transform is not None:
            # Digital zoom/pan/crop. Position is in this format's points; x/y are
            # normalized offsets scaled to the frame so the reframe is visible.
            ET.SubElement(
                asset_clip,
                "adjust-transform",
                {
                    "scale": f"{transform['scale']} {transform['scale']}",
                    "position": f"{transform['x'] * width} {transform['y'] * height}",
                },
            )
        timeline_cursor += timeline_duration

    return ET.tostring(fcpxml, encoding="unicode")
