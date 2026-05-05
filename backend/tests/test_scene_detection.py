from pathlib import Path

from src.models import FrameSample
from src.scene_detection import SceneBoundary, assign_scene_ids, detect_scenes


def test_assign_scene_ids_maps_samples_to_boundaries():
    samples = [
        FrameSample(timestamp=0.5, frame_path="/tmp/000500.jpg"),
        FrameSample(timestamp=2.0, frame_path="/tmp/002000.jpg"),
        FrameSample(timestamp=4.8, frame_path="/tmp/004800.jpg"),
    ]
    scenes = [
        SceneBoundary(scene_id=1, start_sec=0.0, end_sec=2.5),
        SceneBoundary(scene_id=2, start_sec=2.5, end_sec=5.0),
    ]

    mapped = assign_scene_ids(samples, scenes)

    assert [sample.scene_id for sample in mapped] == [1, 1, 2]


def test_detect_scenes_uses_injected_detector_for_testability():
    def fake_detector(path, threshold, min_scene_len):
        assert path == Path("/videos/DJI_0001.MP4")
        assert threshold == 27.0
        assert min_scene_len == 48
        return [(0.0, 2.0), (2.0, 5.5)]

    scenes = detect_scenes(
        Path("/videos/DJI_0001.MP4"),
        threshold=27.0,
        min_scene_len=48,
        detector=fake_detector,
    )

    assert scenes == [
        SceneBoundary(scene_id=1, start_sec=0.0, end_sec=2.0),
        SceneBoundary(scene_id=2, start_sec=2.0, end_sec=5.5),
    ]
