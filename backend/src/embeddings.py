import hashlib
import math
import os
from pathlib import Path
from typing import List, Optional, Protocol

import numpy as np

# google/siglip-base-patch16-224, Apache-2.0, pinned HF revision
# 7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed. Vision-tower-only preprocessing per
# the model's own preprocessor_config.json: direct bicubic resize to 224x224
# (no center-crop), rescale 1/255, normalize with mean/std 0.5.
_SIGLIP_INPUT_SIZE = 224
_SIGLIP_MEAN = 0.5
_SIGLIP_STD = 0.5
_SIGLIP_OUTPUT_DIM = 768
_DEFAULT_MODEL_FILENAME = "siglip_image_encoder.onnx"


class EmbeddingProvider(Protocol):
    def embed_images(self, paths: List[str]) -> List[List[float]]:
        ...


class FakeEmbeddingProvider:
    def __init__(self, dim: int = 32):
        if dim <= 0:
            raise ValueError("Embedding dimension must be positive")
        self.dim = dim

    def embed_images(self, paths: List[str]) -> List[List[float]]:
        return [self._embed_path(path) for path in paths]

    def _embed_path(self, path: str) -> List[float]:
        with open(path, "rb") as image_file:
            digest = hashlib.sha256(image_file.read()).digest()
        vector = [float(digest[index % len(digest)]) for index in range(self.dim)]
        return _l2_normalize(vector)


def embed_candidate(
    provider: EmbeddingProvider, frame_paths: List[str]
) -> Optional[List[float]]:
    if not frame_paths:
        return None

    vectors = provider.embed_images(frame_paths)
    if not vectors:
        return None

    normalized = [_l2_normalize(vector) for vector in vectors]
    usable_vectors = [vector for vector in normalized if vector]
    if not usable_vectors:
        return None

    mean = [
        sum(vector[index] for vector in usable_vectors) / len(usable_vectors)
        for index in range(len(usable_vectors[0]))
    ]
    return _l2_normalize(mean) or None


def _l2_normalize(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return []
    return [value / norm for value in vector]


def _preprocess_siglip_image(path: str) -> np.ndarray:
    """SigLIP's own processor: direct resize to 224x224 (no center-crop),
    bicubic resample, rescale 1/255, normalize by mean/std 0.5, HWC -> CHW."""
    from PIL import Image

    image = Image.open(path).convert("RGB").resize(
        (_SIGLIP_INPUT_SIZE, _SIGLIP_INPUT_SIZE), Image.BICUBIC
    )
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - _SIGLIP_MEAN) / _SIGLIP_STD
    return np.transpose(array, (2, 0, 1))


class OnnxClipEmbeddingProvider:
    """Local ONNX SigLIP vision-tower image encoder.

    Runtime input is float32 ``pixel_values`` shaped (batch, 3, 224, 224);
    output is the pooled 768-dim image embedding. ``onnxruntime`` is imported
    lazily so the rest of the app works when it isn't installed.
    """

    def __init__(self, model_path: str) -> None:
        import onnxruntime

        self._session = onnxruntime.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name

    def embed_images(self, paths: List[str]) -> List[List[float]]:
        if not paths:
            return []
        batch = np.stack([_preprocess_siglip_image(path) for path in paths]).astype(
            np.float32
        )
        outputs = self._session.run(None, {self._input_name: batch})[0]
        return [row.astype(np.float64).tolist() for row in outputs]


def default_embedding_provider() -> Optional[EmbeddingProvider]:
    """A local SigLIP ONNX provider, or ``None`` to degrade to unique look groups.

    Resolution order: the ``CLIP_ONNX_PATH`` env override, then the bundled
    ``backend/models/siglip_image_encoder.onnx``. Never downloads at runtime
    and never raises: a missing runtime, a missing file, or a corrupt/mismatched
    model all return ``None`` so analysis proceeds without embeddings.
    """
    model_path = os.environ.get("CLIP_ONNX_PATH") or str(
        Path(__file__).resolve().parent.parent / "models" / _DEFAULT_MODEL_FILENAME
    )
    if not os.path.exists(model_path):
        return None
    try:
        return OnnxClipEmbeddingProvider(model_path)
    except Exception:
        return None
