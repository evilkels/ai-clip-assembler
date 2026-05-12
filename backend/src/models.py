from typing import List, Optional

from pydantic import BaseModel, Field


class VideoMetadata(BaseModel):
    file_id: str
    file_path: str
    file_name: str
    duration_sec: float
    fps: float
    resolution: List[int]
    display_resolution: List[int] = Field(default_factory=list)
    rotation_degrees: int = 0
    codec: str


class FrameSample(BaseModel):
    timestamp: float
    frame_path: str
    scene_id: int = 0
    is_keyframe: bool = True


class FrameScore(BaseModel):
    timestamp: float
    frame_path: str
    motion_stability: float
    smoothness_score: float
    sharpness_score: float
    exposure_score: float
    contrast_score: float
    visual_interest_score: float = 0.0
    overall_score: float
    blur_score: float
    brightness: float
    contrast: float
    scene_id: int = 0
    is_keyframe: bool = True


class ClipSuggestion(BaseModel):
    clip_id: str
    file_id: str
    file_name: str
    start_sec: float
    end_sec: float
    duration_sec: float
    smoothness_score: float
    visual_interest_score: float
    overall_score: float
    ai_reason: str
    suggested_speed: float = 1.0
    suggested_transition: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class TimelineSequence(BaseModel):
    total_duration_sec: float
    clips: List[str]


class AssemblyResult(BaseModel):
    harness_id: str = "manual"
    harness_version: str = "1.0.0"
    processing_time_sec: float = 0.0
    clips: List[ClipSuggestion]
    sequence: TimelineSequence
    metadata: dict = Field(default_factory=dict)
