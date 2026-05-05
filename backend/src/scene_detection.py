from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Sequence, Tuple

from .models import FrameSample


@dataclass(frozen=True)
class SceneBoundary:
    scene_id: int
    start_sec: float
    end_sec: float


Detector = Callable[[Path, float, int], Sequence[Tuple[float, float]]]


def pyscenedetect_detector(
    video_path: Path,
    threshold: float,
    min_scene_len: int,
) -> Sequence[Tuple[float, float]]:
    from scenedetect import ContentDetector, SceneManager, open_video

    video = open_video(str(video_path))
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_scene_len))
    scene_manager.detect_scenes(video)
    return [
        (scene[0].get_seconds(), scene[1].get_seconds())
        for scene in scene_manager.get_scene_list()
    ]


def detect_scenes(
    video_path: Path,
    threshold: float = 27.0,
    min_scene_len: int = 48,
    detector: Detector = pyscenedetect_detector,
) -> List[SceneBoundary]:
    return [
        SceneBoundary(scene_id=index + 1, start_sec=start, end_sec=end)
        for index, (start, end) in enumerate(detector(video_path, threshold, min_scene_len))
    ]


def assign_scene_ids(samples: List[FrameSample], scenes: List[SceneBoundary]) -> List[FrameSample]:
    if not scenes:
        return samples

    mapped = []
    for sample in samples:
        scene_id = next(
            (
                scene.scene_id
                for scene in scenes
                if scene.start_sec <= sample.timestamp < scene.end_sec
            ),
            scenes[-1].scene_id,
        )
        mapped.append(sample.model_copy(update={"scene_id": scene_id}))
    return mapped
