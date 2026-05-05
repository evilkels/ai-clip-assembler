import cv2
import numpy as np

from src.models import FrameSample
from src.quality_scoring import normalize_frame_metrics, score_frame_metrics, score_samples_from_images


def test_score_frame_metrics_weights_smoothness_first_for_drone_footage():
    frame = score_frame_metrics(
        timestamp=3.0,
        motion_magnitude=0.8,
        blur_laplacian_variance=240.0,
        brightness=0.52,
        contrast=0.42,
        scene_id=1,
    )

    assert frame.smoothness_score >= 8.0
    assert frame.sharpness_score >= 8.0
    assert frame.overall_score >= 8.0
    assert frame.visual_interest_score == 0.0


def test_normalize_frame_metrics_penalizes_shake_blur_and_bad_exposure():
    bad = normalize_frame_metrics(
        motion_magnitude=9.0,
        blur_laplacian_variance=45.0,
        brightness=0.95,
        contrast=0.05,
    )

    assert bad["smoothness_score"] <= 2.0
    assert bad["sharpness_score"] <= 4.5
    assert bad["exposure_score"] <= 2.0
    assert bad["contrast_score"] <= 2.0


def test_score_samples_from_images_uses_image_quality_and_motion(tmp_path):
    first = tmp_path / "first.jpg"
    second = tmp_path / "second.jpg"
    third = tmp_path / "third.jpg"
    checker = np.indices((40, 40)).sum(axis=0) % 2 * 255
    cv2.imwrite(str(first), checker.astype("uint8"))
    cv2.imwrite(str(second), checker.astype("uint8"))
    cv2.imwrite(str(third), np.full((40, 40), 255, dtype="uint8"))

    scores = score_samples_from_images(
        [
            FrameSample(timestamp=0, frame_path=str(first)),
            FrameSample(timestamp=1, frame_path=str(second)),
            FrameSample(timestamp=2, frame_path=str(third)),
        ]
    )

    assert scores[1].smoothness_score >= 9.0
    assert scores[1].sharpness_score >= 9.0
    assert scores[2].smoothness_score < scores[1].smoothness_score
    assert scores[2].exposure_score < scores[1].exposure_score


def test_score_samples_from_images_preserves_scene_ids(tmp_path):
    frame_path = tmp_path / "scene.jpg"
    cv2.imwrite(str(frame_path), np.full((20, 20), 127, dtype="uint8"))

    scores = score_samples_from_images(
        [FrameSample(timestamp=12.0, frame_path=str(frame_path), scene_id=4)]
    )

    assert scores[0].scene_id == 4
