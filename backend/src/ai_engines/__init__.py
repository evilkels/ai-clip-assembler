from typing import Optional

from .types import (
    AiFailure,
    AiFailureAction,
    AiFailureKind,
    AiReply,
    AiRequest,
    EngineStatus,
    Provider,
)


def get_engine(provider: Optional[str] = None):
    from ..app_settings import get_settings
    from .pi import PiEngine

    settings = get_settings()
    return PiEngine(settings["pi_bin"], settings["pi_provider"], settings["pi_model"])


__all__ = [
    "AiFailure", "AiFailureAction", "AiFailureKind", "AiReply", "AiRequest",
    "EngineStatus", "Provider", "get_engine",
]
