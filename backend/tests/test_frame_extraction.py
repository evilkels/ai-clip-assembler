from pathlib import Path
import subprocess

from src.frame_extraction import (
    FFmpegError,
    build_frame_extract_command,
    extract_frames,
    frame_output_path,
)


def test_frame_output_path_uses_millisecond_timestamp():
    output = frame_output_path(Path("/tmp/project/frames"), "file-123", 42.375)

    assert output == Path("/tmp/project/frames/file-123_042375.jpg")


def test_build_frame_extract_command_samples_by_fps_and_scales_for_analysis():
    command = build_frame_extract_command(
        input_path=Path("/videos/DJI_0001.MP4"),
        output_pattern=Path("/tmp/frames/DJI_0001_%06d.jpg"),
        sample_fps=2.0,
        max_width=960,
    )

    assert command[:2] == ["ffmpeg", "-y"]
    assert "-i" in command
    assert "/videos/DJI_0001.MP4" in command
    assert "-vf" in command
    vf = command[command.index("-vf") + 1]
    assert "fps=2" in vf
    assert "scale='min(960,iw)':-2" in vf
    assert command[-1] == "/tmp/frames/DJI_0001_%06d.jpg"


def test_extract_frames_cleans_stale_frames_and_returns_timestamp_named_paths(tmp_path):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    stale = frames_dir / "file-1_999999.jpg"
    stale.write_bytes(b"stale")

    def fake_runner(*args, **kwargs):
        (frames_dir / "file-1_raw_000001.jpg").write_bytes(b"first")
        (frames_dir / "file-1_raw_000002.jpg").write_bytes(b"second")
        return subprocess.CompletedProcess(args[0], 0, "", "")

    samples = extract_frames(
        input_path=tmp_path / "input.mp4",
        frames_dir=frames_dir,
        file_id="file-1",
        sample_fps=2.0,
        runner=fake_runner,
    )

    assert not stale.exists()
    assert [Path(sample.frame_path).name for sample in samples] == [
        "file-1_000000.jpg",
        "file-1_000500.jpg",
    ]
    assert [sample.timestamp for sample in samples] == [0.0, 0.5]


def test_extract_frames_wraps_ffmpeg_command_failures(tmp_path):
    def failing_runner(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0], stderr="unsupported codec")

    try:
        extract_frames(
            input_path=tmp_path / "bad.mp4",
            frames_dir=tmp_path / "frames",
            file_id="file-1",
            runner=failing_runner,
        )
    except FFmpegError as exc:
        assert "unsupported codec" in str(exc)
    else:
        raise AssertionError("Expected ffmpeg failure to be wrapped in a domain error")
