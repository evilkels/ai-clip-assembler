import hashlib
import math
from typing import List, Optional, Protocol


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
