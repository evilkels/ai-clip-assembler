import math
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
    turn_rate_deg_per_sec: float = 0.0,
) -> Dict[str, float]:
    smoothness_score = clamp_score(10.0 - motion_magnitude)
    if turn_rate_deg_per_sec > 6.0:
        smoothness_score = min(
            smoothness_score,
            clamp_score(10.0 - (turn_rate_deg_per_sec - 6.0) * 0.5),
        )
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
    turn_rate_deg_per_sec: float = 0.0,
) -> FrameScore:
    normalized = normalize_frame_metrics(
        motion_magnitude=motion_magnitude,
        blur_laplacian_variance=blur_laplacian_variance,
        brightness=brightness,
        contrast=contrast,
        turn_rate_deg_per_sec=turn_rate_deg_per_sec,
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
        turn_rate_deg_per_sec=turn_rate_deg_per_sec,
    )


def estimate_rotation_degrees(previous_gray: np.ndarray, gray: np.ndarray) -> float:
    points = cv2.goodFeaturesToTrack(previous_gray, maxCorners=200, qualityLevel=0.01, minDistance=8)
    if points is None or len(points) < 4:
        return 0.0
    tracked, status, _ = cv2.calcOpticalFlowPyrLK(previous_gray, gray, points, None)
    if tracked is None or status is None:
        return 0.0
    mask = status.reshape(-1) == 1
    if int(mask.sum()) < 4:
        return 0.0
    transform, _ = cv2.estimateAffinePartial2D(points.reshape(-1, 2)[mask], tracked.reshape(-1, 2)[mask])
    if transform is None:
        return 0.0
    return abs(math.degrees(math.atan2(float(transform[0, 1]), float(transform[0, 0]))))


def score_samples_from_images(samples: List[FrameSample]) -> List[FrameScore]:
    scores = []
    previous_gray: Optional[np.ndarray] = None
    previous_timestamp: Optional[float] = None
    for index, sample in enumerate(samples):
        gray = cv2.imread(sample.frame_path, cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise ValueError(f"Could not read frame image: {sample.frame_path}")

        blur_laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean() / 255.0)
        contrast = float(gray.std() / 255.0)
        if previous_gray is None:
            motion_magnitude = 0.0
            turn_rate = 0.0
        else:
            comparable_previous = previous_gray
            if previous_gray.shape != gray.shape:
                comparable_previous = cv2.resize(previous_gray, (gray.shape[1], gray.shape[0]))
            motion_magnitude = float(np.mean(cv2.absdiff(gray, comparable_previous)) / 25.5)
            elapsed = max(0.001, sample.timestamp - (previous_timestamp or 0.0))
            turn_rate = estimate_rotation_degrees(comparable_previous, gray) / elapsed

        scores.append(
            score_frame_metrics(
                timestamp=sample.timestamp,
                motion_magnitude=motion_magnitude,
                blur_laplacian_variance=blur_laplacian_variance,
                brightness=brightness,
                contrast=contrast,
                scene_id=sample.scene_id,
                frame_path=sample.frame_path,
                turn_rate_deg_per_sec=turn_rate,
            )
        )
        previous_gray = gray
        previous_timestamp = sample.timestamp
    return scores
