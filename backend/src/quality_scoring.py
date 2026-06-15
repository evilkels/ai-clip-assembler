from typing import Dict, List, Optional

import cv2
import numpy as np

from .models import FrameSample, FrameScore
from .motion_analysis import FrameTransform, VIDSTAB_ANALYSIS_WIDTH
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


def stability_scores_for_samples(
    samples: List[FrameSample],
    transforms: List[FrameTransform],
) -> List[float]:
    if not transforms:
        return [10.0] * len(samples)
    aligned = [min(transforms, key=lambda transform: abs(transform.t - sample.timestamp)) for sample in samples]
    scores = [10.0]
    previous_velocity = (aligned[0].dx, aligned[0].dy)
    for transform in aligned[1:]:
        velocity = (transform.dx, transform.dy)
        jerk = (
            abs(velocity[0] - previous_velocity[0])
            + abs(velocity[1] - previous_velocity[1])
        ) / VIDSTAB_ANALYSIS_WIDTH
        scores.append(clamp_score(10.0 - jerk * 240.0))
        previous_velocity = velocity
    return scores


def turn_rates_for_samples(
    samples: List[FrameSample],
    transforms: List[FrameTransform],
) -> List[float]:
    """Per-sample turn rate (deg/sec) from the fitted per-frame rotations.

    Transforms are spaced at the *video* frame rate, so deg/sec is the aligned
    transform's per-frame rotation scaled by that rate, recovered from the
    transform timestamp spacing.
    """
    if len(transforms) < 2:
        return [0.0] * len(samples)
    dt = transforms[1].t - transforms[0].t
    video_fps = 1.0 / dt if dt > 0 else 30.0
    aligned = [min(transforms, key=lambda transform: abs(transform.t - sample.timestamp)) for sample in samples]
    return [abs(transform.da) * video_fps for transform in aligned]


def score_samples_from_images(
    samples: List[FrameSample],
    transforms: Optional[List[FrameTransform]] = None,
) -> List[FrameScore]:
    scores = []
    transform_stability = stability_scores_for_samples(samples, transforms or []) if transforms else None
    turn_rates = turn_rates_for_samples(samples, transforms or []) if transforms else None
    previous_gray: Optional[np.ndarray] = None
    for index, sample in enumerate(samples):
        gray = cv2.imread(sample.frame_path, cv2.IMREAD_GRAYSCALE)
        if gray is None:
            raise ValueError(f"Could not read frame image: {sample.frame_path}")

        blur_laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean() / 255.0)
        contrast = float(gray.std() / 255.0)
        visual_interest = clamp_score(float(cv2.Canny(gray, 80, 160).mean() / 255.0) * 20.0)
        if previous_gray is None:
            motion_magnitude = 0.0
        else:
            comparable_previous = previous_gray
            if previous_gray.shape != gray.shape:
                comparable_previous = cv2.resize(previous_gray, (gray.shape[1], gray.shape[0]))
            motion_magnitude = float(np.mean(cv2.absdiff(gray, comparable_previous)) / 25.5)
        if transform_stability is not None:
            motion_magnitude = 10.0 - transform_stability[index]

        score = score_frame_metrics(
                timestamp=sample.timestamp,
                motion_magnitude=motion_magnitude,
                blur_laplacian_variance=blur_laplacian_variance,
                brightness=brightness,
                contrast=contrast,
                scene_id=sample.scene_id,
                frame_path=sample.frame_path,
                turn_rate_deg_per_sec=turn_rates[index] if turn_rates is not None else 0.0,
        )
        score.visual_interest_score = visual_interest
        score.overall_score = clamp_score(score.overall_score * 0.9 + visual_interest * 0.1)
        scores.append(score)
        previous_gray = gray
    return scores
