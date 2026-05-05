import subprocess
from pathlib import Path

from src.motion_analysis import FFmpegVidstabError, build_vidstabdetect_command, run_vidstabdetect


def test_build_vidstabdetect_command_writes_transform_file():
    command = build_vidstabdetect_command(
        input_path=Path("/videos/DJI_0001.MP4"),
        transforms_path=Path("/tmp/transforms.trf"),
    )

    assert command[:4] == ["ffmpeg", "-y", "-i", "/videos/DJI_0001.MP4"]
    assert "-vf" in command
    assert command[command.index("-vf") + 1] == "vidstabdetect=result=/tmp/transforms.trf"
    assert command[-2:] == ["null", "-"]


def test_run_vidstabdetect_wraps_ffmpeg_failures(tmp_path):
    def failing_runner(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0], stderr="No such filter: vidstabdetect")

    try:
        run_vidstabdetect(
            input_path=tmp_path / "clip.mp4",
            transforms_path=tmp_path / "transforms.trf",
            runner=failing_runner,
        )
    except FFmpegVidstabError as exc:
        assert "vidstabdetect" in str(exc)
    else:
        raise AssertionError("Expected vidstabdetect ffmpeg failure to be wrapped")
