from pathlib import Path

from src.frame_extraction import build_frame_extract_command, frame_output_path


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
