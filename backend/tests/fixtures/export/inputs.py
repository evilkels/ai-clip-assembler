"""Synthetic export inputs based on representative source footage."""


def _source(file_id, file_name, path, fps, resolution, duration, audio_channels=2, display=None):
    metadata = {
        "duration_sec": duration,
        "fps": fps,
        "resolution": resolution,
        "has_audio": audio_channels > 0,
        "audio_channels": audio_channels or None,
        "audio_sample_rate": 48000 if audio_channels else None,
        "video_codec": "hevc",
    }
    if display:
        metadata["display_resolution"] = display
        metadata["rotation_degrees"] = 90
    return {
        "file_id": file_id,
        "file_name": file_name,
        "file_path": path,
        "metadata": metadata,
    }


def _clip(file_id, file_name, start, end, speed=1.0, transform=None):
    clip = {
        "clip_id": f"clip-{file_id}",
        "file_id": file_id,
        "file_name": file_name,
        "start_sec": start,
        "end_sec": end,
        "duration_sec": end - start,
    }
    if speed != 1.0:
        clip["suggested_speed"] = speed
    if transform:
        clip["transform"] = transform
    return clip


ESTEPONA = {
    "title": "Estepona Travel Edit",
    "videos": {
        "dji-001": _source("dji-001", "DJI_0001.MOV", "/Users/editor/Movies/Estepona/DJI_0001.MOV", 59.94, [1920, 1080], 35.936, display=[1080, 1920]),
        "dji-002": _source("dji-002", "DJI_0002.MOV", "/Users/editor/Movies/Estepona/DJI_0002.MOV", 59.94, [1920, 1080], 42.5, display=[1920, 1080]),
        "dji-003": _source("dji-003", "DJI_0003.MOV", "/Users/editor/Movies/Estepona/DJI_0003.MOV", 59.94, [1920, 1080], 51.2, display=[1920, 1080]),
        "dji-004": _source("dji-004", "DJI_0004.MOV", "/Users/editor/Movies/Estepona/DJI_0004.MOV", 59.94, [1920, 1080], 48.0, display=[1920, 1080]),
    },
    "clips": [
        _clip("dji-001", "DJI_0001.MOV", 2.0, 8.0),
        _clip("dji-002", "DJI_0002.MOV", 10.0, 16.0, speed=0.5),
        _clip("dji-003", "DJI_0003.MOV", 21.0, 27.0, transform={"scale": 1.2, "x": 0.05, "y": -0.02}),
        _clip("dji-004", "DJI_0004.MOV", 4.0, 9.0),
    ],
}

IPHONE_MIXED = {
    "title": "iPhone Mixed Rate",
    "videos": {
        "iphone-60": _source("iphone-60", "IMG_0060.MOV", "/Users/editor/Movies/iPhone/IMG_0060.MOV", 60, [3840, 2160], 30, 2),
        "iphone-30": _source("iphone-30", "IMG_0030.MOV", "/Users/editor/Movies/iPhone/IMG_0030.MOV", 30, [3840, 2160], 30, 2),
    },
    "clips": [
        _clip("iphone-60", "IMG_0060.MOV", 2, 8),
        _clip("iphone-30", "IMG_0030.MOV", 10, 16),
    ],
}

CINEMA = {
    "title": "Cinema 23.976",
    "videos": {
        "cinema-silent": _source("cinema-silent", "A001_C001.MOV", "/Users/editor/Movies/Cinema/A001_C001.MOV", 23.976, [1920, 1080], 60, 0),
        "cinema-mono": _source("cinema-mono", "A001_C002.MOV", "/Users/editor/Movies/Cinema/A001_C002.MOV", 23.976, [1920, 1080], 52, 1),
    },
    "clips": [
        _clip("cinema-silent", "A001_C001.MOV", 1, 7),
        _clip("cinema-mono", "A001_C002.MOV", 12, 18),
    ],
}
