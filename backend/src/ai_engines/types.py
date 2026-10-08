import re
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Provider = Literal["claude", "chatgpt"]
AiFailureKind = Literal[
    "not_installed", "incompatible_version", "signed_out", "usage_limit", "rate_limited",
    "timed_out", "network", "unusable_reply", "engine_error", "cancelled",
    "ai_not_connected", "ai_off_for_project",
]
AiFailureAction = Literal["open_providers", "sign_in", "retry", "wait", "none"]


class AiFailure(BaseModel):
    kind: AiFailureKind
    provider: Optional[Provider] = None
    message: str
    action: AiFailureAction
    detail: Optional[str] = None
    resets_at: Optional[str] = None
    window: Optional[Literal["5h", "weekly"]] = None
    retry_after_sec: Optional[float] = None
    timeout_sec: Optional[float] = None

    @field_validator("detail")
    @classmethod
    def sanitize_detail(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = " ".join(value.strip().split())
        return re.sub(r"(?<!\S)/(?:[^/\s]+/)+([^/\s]+)", r"\1", value)[:500]


class AiReply(BaseModel):
    provider: Provider
    data: Dict
    raw_text: str
    elapsed_sec: float


class AiRequest(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    images: List[Path] = Field(default_factory=list)
    text: str
    schema_: dict = Field(alias="schema")
    timeout_sec: float
    samples_dir: Optional[Path] = None
    image_limit: int = 12
    image_names: Optional[List[str]] = None


class EngineStatus(BaseModel):
    provider: Provider
    installed: bool
    version: Optional[str] = None
    path: Optional[str] = None
    source: Optional[Literal["chosen", "path", "desktop_app"]] = None
    signed_in: bool = False
    ready: bool = False
    failure: Optional[AiFailure] = None
