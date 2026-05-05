from typing import Dict, List, Optional

import cv2
import numpy as np

from .models import FrameSample, FrameScore
from .scoring_weights import DRONE_SCORE_WEIGHTS


def clamp_score(value: float) -> float:
    return round(max(0.0, min(10.0, value)), 2)


def normalize_frame_metrics(
    motion_magnitude: float,
    blur_laplacian_variance: float,
    brightness: float,
    contrast: float,
) -> Dict[str, float]:
    smoothness_score = clamp_score(10.0 - motion_magnitude)
    sharpness_score = clamp_score((blur_laplacian_variance / 300.0) * 10.0)
    exposure_score = clamp_score(10.0 - (abs(brightness - 0.5) * 25.0))
    contrast_score = clamp_score(contrast * 20.0)
    overall_score = clamp_score(
        smoothness_score * DRONE_SCORE_WEIGHTS["smoothness"]
        + sharpness_score * DRONE_SCORE_WEIGHTS["sharpness"]
        + exposure_score * DRONE_SCORE_WEIGHTS["exposure"]
        + contrast_score * DRONE_SCORE_WEIGHTS["contrast"]
    )
    return {
        "smoothness_score": smoothness_score,
        "sharpness_score": sharpness_score,
        "exposure_score": exposure_score,
        "contrast_score": contrast_score,
        "overall_score": overall_score,
    }


def score_frame_metrics(
    timestamp: float,
    motion_magnitude: float,
    blur_laplacian_variance: float,
    brightness: float,
    contrast: float,
    scene_id: int,
    frame_path: str = "",
) -> FrameScore:
    normalized = normalize_frame_metrics(
        motion_magnitude=motion_magnitude,
        blur_laplacian_variance=blur_laplacian_variance,
        brightness=brightness,
        contrast=contrast,
    )
    return FrameScore(
        timestamp=timestamp,
        frame_path=frame_path,
        motion_stability=normalized["smoothness_score"],
        smoothness_score=normalized["smoothness_score"],
        sharpness_score=normalized["sharpness_score"],
        exposure_score=normalized["exposure_score"],
        contrast_score=normalized["contrast_score"],
        visual_interest_score=0.0,
        overall_score=normalized["overall_score"],
        blur_score=normalized["sharpness_score"],
        brightness=brightness,
        contrast=contrast,
        scene_id=scene_id,
        is_keyframe=True,
    )


def score_samples_from_images(samples: List[FrameSample]) -> List[FrameScore]:
    scores = []
    previous_gray: Optional[np.ndarray] = None
    for index, sample in enumerate(samples):
        gray = cv2.imread(sample.frame_path, cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise ValueError(f"Could not read frame image: {sample.frame_path}")

        blur_laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean() / 255.0)
        contrast = float(gray.std() / 255.0)
        if previous_gray is None:
            motion_magnitude = 0.0
        else:
            comparable_previous = previous_gray
            if previous_gray.shape != gray.shape:
                comparable_previous = cv2.resize(previous_gray, (gray.shape[1], gray.shape[0]))
            motion_magnitude = float(np.mean(cv2.absdiff(gray, comparable_previous)) / 25.5)

        scores.append(
            score_frame_metrics(
                timestamp=sample.timestamp,
                motion_magnitude=motion_magnitude,
                blur_laplacian_variance=blur_laplacian_variance,
                brightness=brightness,
                contrast=contrast,
                scene_id=sample.scene_id,
                frame_path=sample.frame_path,
            )
        )
        previous_gray = gray
    return scores
