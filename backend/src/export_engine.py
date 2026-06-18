import os
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


def edl_flatten_warnings(clips: List[dict]) -> List[str]:
    """EDL cannot faithfully represent Speed/Transform; warn when present.

    Returned to the caller so the GUI can surface that an EDL export dropped
    retime/reframe information (use FCPXML or Resolve XML to preserve it).
    """
    has_speed = any(float(clip.get("suggested_speed", 1.0) or 1.0) != 1.0 for clip in clips)
    has_transform = any(clip_transform(clip) is not None for clip in clips)
    if not (has_speed or has_transform):
        return []
    flattened = []
    if has_speed:
        flattened.append("Speed")
    if has_transform:
        flattened.append("Transform")
    return [
        f"EDL cannot represent {' and '.join(flattened)}; it was flattened. "
        "Export FCPXML or Resolve XML to preserve it."
    ]


def generate_edl(title: str, clips: List[dict], fps: float = 30) -> str:
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    for warning in edl_flatten_warnings(clips):
        lines.append(f"* NOTE: {warning} (flattened)")
    if len(lines) > 3:
        lines.append("")
    timeline_cursor = 0.0
    for index, clip in enumerate(clips, start=1):
        source_in = clip["start_sec"]
        source_out = clip["end_sec"]
        record_in = timeline_cursor
        record_out = timeline_cursor + effective_duration(clip)
        lines.append(
            f"{index:03d}  AX       V     C        "
            f"{seconds_to_timecode(source_in, fps)} "
            f"{seconds_to_timecode(source_out, fps)} "
            f"{seconds_to_timecode(record_in, fps)} "
            f"{seconds_to_timecode(record_out, fps)}"
        )
        lines.append(f"* FROM CLIP NAME: {clip['file_name']}")
        speed = float(clip.get("suggested_speed", 1.0) or 1.0)
        if speed != 1.0:
            lines.append(
                f"M2   AX      {speed * fps:.3f} {seconds_to_timecode(source_in, fps)}"
            )
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

    defined_file_ids = set()
    timeline_cursor = 0.0
    for index, clip in enumerate(clips, start=1):
        source = videos_by_id.get(clip["file_id"], {})
        source_metadata = source.get("metadata") or {}
        source_duration = float(source_metadata.get("duration_sec", 0) or 0)

        clipitem = ET.SubElement(track, "clipitem", {"id": f"clipitem-{index}"})
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

        file_id = f"file-{clip['file_id']}"
        file_element = ET.SubElement(clipitem, "file", {"id": file_id})
        if file_id not in defined_file_ids:
            defined_file_ids.add(file_id)
            ET.SubElement(file_element, "name").text = clip["file_name"]
            pathurl = ET.SubElement(file_element, "pathurl")
            if source.get("file_path"):
                pathurl.text = path_to_asset_src(source["file_path"], media_base_path)
            else:
                pathurl.text = clip["file_name"]
            append_xmeml_rate(file_element, fps)
            ET.SubElement(file_element, "duration").text = str(
                seconds_to_frames(source_duration, fps)
            )
            file_media = ET.SubElement(file_element, "media")
            file_video = ET.SubElement(file_media, "video")
            file_characteristics = ET.SubElement(file_video, "samplecharacteristics")
            ET.SubElement(file_characteristics, "width").text = str(width)
            ET.SubElement(file_characteristics, "height").text = str(height)

        speed = float(clip.get("suggested_speed", 1.0) or 1.0)
        if speed != 1.0:
            filter_element = ET.SubElement(clipitem, "filter")
            effect = ET.SubElement(filter_element, "effect")
            ET.SubElement(effect, "name").text = "Time Remap"
            ET.SubElement(effect, "effectid").text = "timeremap"
            parameter = ET.SubElement(effect, "parameter")
            ET.SubElement(parameter, "parameterid").text = "speed"
            ET.SubElement(parameter, "value").text = str(round(speed * 100, 3))

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

        timeline_cursor += timeline_duration

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
        ET.SubElement(
            resources,
            "asset",
            {
                "id": f"asset-{file_id}",
                "name": video["file_name"],
                "src": path_to_asset_src(video["file_path"], media_base_path),
                "duration": seconds_to_fcpx_duration(duration),
                "hasVideo": "1",
            },
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
