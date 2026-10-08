from typing import Optional

from ..app_settings import get_settings
from .engine import PING_TIMEOUT_SEC, REVIEW_TIMEOUT_SEC, SCORING_TIMEOUT_PER_CLIP_SEC
from .types import (
    AiFailure,
    AiFailureAction,
    AiFailureKind,
    AiReply,
    AiRequest,
    EngineStatus,
    Provider,
)
from .pi import PiEngine


def get_engine(provider: Optional[str] = None):
    settings = get_settings()
    return PiEngine(settings["pi_bin"], settings["pi_provider"], settings["pi_model"])


__all__ = [
    "AiFailure",
    "AiFailureAction",
    "AiFailureKind",
    "AiReply",
    "AiRequest",
    "EngineStatus",
    "Provider",
    "get_engine",
    "PING_TIMEOUT_SEC",
    "REVIEW_TIMEOUT_SEC",
    "SCORING_TIMEOUT_PER_CLIP_SEC",
]
