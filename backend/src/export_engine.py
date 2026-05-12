from pathlib import Path
from typing import Dict, List
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
    rates = [
        float(fps)
        for video in videos_by_id.values()
        if (fps := (video.get("metadata") or {}).get("fps")) and float(fps) > 0
    ]
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


def generate_edl(title: str, clips: List[dict], fps: float = 30) -> str:
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    timeline_cursor = 0.0
    for index, clip in enumerate(clips, start=1):
        source_in = clip["start_sec"]
        source_out = clip["end_sec"]
        record_in = timeline_cursor
        record_out = timeline_cursor + clip["duration_sec"]
        lines.append(
            f"{index:03d}  AX       V     C        "
            f"{seconds_to_timecode(source_in, fps)} "
            f"{seconds_to_timecode(source_out, fps)} "
            f"{seconds_to_timecode(record_in, fps)} "
            f"{seconds_to_timecode(record_out, fps)}"
        )
        lines.append(f"* FROM CLIP NAME: {clip['file_name']}")
        lines.append("")
        timeline_cursor = record_out
    return "\n".join(lines)


def generate_fcpxml(title: str, clips: List[dict], videos_by_id: Dict[str, dict]) -> str:
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
        metadata = video.get("metadata", {})
        duration = float(metadata.get("duration_sec", 0) or 0)
        ET.SubElement(
            resources,
            "asset",
            {
                "id": f"asset-{file_id}",
                "name": video["file_name"],
                "src": path_to_file_url(video["file_path"]),
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
        ET.SubElement(
            spine,
            "asset-clip",
            {
                "name": clip["file_name"],
                "ref": f"asset-{clip['file_id']}",
                "offset": seconds_to_fcpx_duration(timeline_cursor),
                "start": seconds_to_fcpx_duration(clip["start_sec"]),
                "duration": seconds_to_fcpx_duration(clip["duration_sec"]),
            },
        )
        timeline_cursor += clip["duration_sec"]

    return ET.tostring(fcpxml, encoding="unicode")
