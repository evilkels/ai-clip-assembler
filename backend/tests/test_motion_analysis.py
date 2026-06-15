import subprocess
from pathlib import Path

from src.motion_analysis import (
    FFmpegVidstabError,
    build_vidstabdetect_command,
    fit_rotation_degrees,
    parse_trf,
    run_vidstabdetect,
)


def test_build_vidstabdetect_command_writes_transform_file():
    command = build_vidstabdetect_command(
        input_path=Path("/videos/DJI_0001.MP4"),
        transforms_path=Path("/tmp/transforms.trf"),
    )

    assert command[:4] == ["ffmpeg", "-y", "-i", "/videos/DJI_0001.MP4"]
    assert "-vf" in command
    vf = command[command.index("-vf") + 1]
    # Runs on a downscaled proxy for speed, then detects motion.
    assert vf == "scale=640:-2,vidstabdetect=result=/tmp/transforms.trf:fileformat=ascii"
    assert command[-2:] == ["null", "-"]


def test_parse_trf_aggregates_local_motions_per_frame(tmp_path):
    path = tmp_path / "motion.trf"
    path.write_text(
        "VID.STAB 1\n"
        "Frame 1 (List 2 [(LM 2 4 10 10 16 0.8 1),(LM 4 8 20 20 16 0.8 1)])\n"
        "Frame 2 (List 1 [(LM 10 12 10 10 16 0.8 1)])\n",
        encoding="utf-8",
    )

    transforms = parse_trf(path, fps=2)

    assert [(item.t, item.dx, item.dy) for item in transforms] == [
        (0.0, 3.0, 6.0),
        (0.5, 10.0, 12.0),
    ]


def test_fit_rotation_recovers_pure_rotation():
    # Field points around centroid (100,100); tangential motion m = θ·perp(r).
    # With ‖r‖=50 and tangential speed 10, θ = 10/50 = 0.2 rad ≈ 11.46°.
    positions = [(150, 100), (100, 150), (50, 100), (100, 50)]
    motions = [(0, 10), (-10, 0), (0, -10), (10, 0)]

    angle = fit_rotation_degrees(motions, positions)

    assert abs(angle - 11.459) < 0.01


def test_fit_rotation_is_zero_for_pure_translation():
    positions = [(0, 0), (50, 0), (0, 50), (50, 50)]
    motions = [(7, -3)] * 4  # identical vectors -> no rotation

    assert fit_rotation_degrees(motions, positions) == 0.0


def test_parse_trf_fits_rotation_into_da(tmp_path):
    path = tmp_path / "rot.trf"
    path.write_text(
        "VID.STAB 1\n"
        "Frame 1 (List 4 ["
        "(LM 0 10 150 100 16 0.8 1),(LM -10 0 100 150 16 0.8 1),"
        "(LM 0 -10 50 100 16 0.8 1),(LM 10 0 100 50 16 0.8 1)])\n",
        encoding="utf-8",
    )

    transforms = parse_trf(path, fps=30)

    assert abs(transforms[0].da - 11.459) < 0.01


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
