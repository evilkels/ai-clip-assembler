from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# Bump when the on-disk Timeline Document shape changes. The legacy
# `{clip_id, start_sec, end_sec}` timeline is treated as version 1.
TIMELINE_DOCUMENT_VERSION = 2


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
    size_bytes: int = 0
    # ISO 8601 recording time from container metadata, or file mtime fallback.
    created_at: Optional[str] = None


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
    turn_rate_deg_per_sec: float = 0.0


class ClipSuggestion(BaseModel):
    clip_id: str
    file_id: str
    file_name: str
    scene_id: int = 0
    start_sec: float
    end_sec: float
    duration_sec: float
    smoothness_score: float
    sharpness_score: Optional[float] = None
    exposure_score: Optional[float] = None
    contrast_score: Optional[float] = None
    max_turn_rate_deg_per_sec: Optional[float] = None
    visual_interest_score: float
    overall_score: float
    ai_reason: str
    suggested_speed: float = 1.0
    suggested_transition: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    # Carried from the source file's metadata during analysis (see
    # run_analysis_pipeline in api.py) so the UI can place clips on a per-file
    # track and sort by true capture time. Declared here so the contract is
    # explicit rather than bolted on after model_dump().
    source_created_at: Optional[str] = None
    source_duration_sec: Optional[float] = None
    # Set of Candidate Clips judged visually near-identical by embedding
    # similarity (see clip_diversity.assign_look_groups). None when no
    # embedding model was available for this clip (degrades to "unique look").
    look_group: Optional[int] = None


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


class Proposal(BaseModel):
    proposal_id: str
    project_id: str
    message: str
    operations: List[dict] = Field(default_factory=list)
    summary: List[str] = Field(default_factory=list)
    before_item_count: int = 0
    after_item_count: int = 0
    based_on_timeline_revision: int = 0
    status: Literal["pending", "accepted", "rejected"] = "pending"


class ReviewMessage(BaseModel):
    message_id: str
    role: Literal["agent", "editor"]
    text: str
    created_at: str
    reply_to_message_id: Optional[str] = None
    proposal: Optional[Proposal] = None
    payload: dict = Field(default_factory=dict)


class ReviewSession(BaseModel):
    schema_version: int = 2
    session_id: str
    messages: List[ReviewMessage] = Field(default_factory=list)
    updated_at: str


class CreativeVersionItem(BaseModel):
    source_clip_id: str
    file_id: str
    file_name: str
    start_sec: float
    end_sec: float
    speed: float = 1.0
    transform: dict = Field(default_factory=lambda: {"scale": 1.0, "x": 0.0, "y": 0.0})


class CreativeVersion(BaseModel):
    version_id: str
    title: str
    vibe: str
    rationale: str
    profile: Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]
    total_duration_sec: float
    items: List[CreativeVersionItem]
    sequence_fingerprint: str


class VersionSet(BaseModel):
    version_set_id: str
    versions: List[CreativeVersion]
    created_at: str
    based_on_timeline_revision: int
    based_on_sequence_fingerprint: str
    based_on_review_context_fingerprint: str


class Transform(BaseModel):
    """A Timeline Item's digital zoom/pan/crop. Identity by default.

    ``scale`` is the zoom factor (1.0 = no zoom). ``x`` / ``y`` are pan offsets
    in normalized frame units. Validated so a transform can never be degenerate.
    """

    scale: float = 1.0
    x: float = 0.0
    y: float = 0.0

    @field_validator("scale")
    @classmethod
    def scale_must_be_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("transform scale must be > 0")
        return value


class TimelineItem(BaseModel):
    """One placement of a Candidate Clip on the Timeline.

    The same candidate may appear as more than one item (multi-instance); each
    placement has its own in/out bounds within the source video, Speed, and
    Transform.
    """

    item_id: str
    source_clip_id: str
    start_sec: float
    end_sec: float
    speed: float = 1.0
    transform: Transform = Field(default_factory=Transform)

    @property
    def effective_duration_sec(self) -> float:
        """Duration this item occupies on the timeline, after Speed retime."""
        return (self.end_sec - self.start_sec) / self.speed

    @model_validator(mode="after")
    def validate_bounds_and_speed(self) -> "TimelineItem":
        if self.start_sec < 0:
            raise ValueError("start_sec must be >= 0")
        if self.end_sec <= self.start_sec:
            raise ValueError("end_sec must be greater than start_sec")
        if self.speed <= 0:
            raise ValueError("speed must be > 0")
        return self


class TimelineDocument(BaseModel):
    """The single backend-authoritative record of the Timeline.

    Ordered Timeline Items plus the assembly knobs (profile, target duration)
    and a schema version. The GUI and agents are clients of this document.
    """

    version: int = TIMELINE_DOCUMENT_VERSION
    # Monotonic concurrency token bumped by the TimelineController after every
    # committed state transition. It is *not* a content identity — fingerprints
    # (see src.review_state) determine equality and staleness. Absent in legacy
    # persisted data, where it backfills to 0 on load.
    revision: int = 0
    items: List[TimelineItem] = Field(default_factory=list)
    profile: Optional[str] = None
    target_duration_sec: Optional[float] = None
    # Review-board decisions per Candidate Clip ("included" / "excluded").
    # Item presence drives the timeline; this preserves an explicit "rejected"
    # state distinct from "not yet reviewed" so the Review Board can grey it out.
    decisions: Dict[str, str] = Field(default_factory=dict)
