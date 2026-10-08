import hashlib
import math


class FakeEmbeddingProvider:
    def __init__(self, dim: int = 32):
        self.dim = dim

    def embed_images(self, paths: list[str]) -> list[list[float]]:
        return [self._embed_path(path) for path in paths]

    def _embed_path(self, path: str) -> list[float]:
        with open(path, "rb") as image_file:
            digest = hashlib.sha256(image_file.read()).digest()
        vector = [float(digest[index % len(digest)]) for index in range(self.dim)]
        norm = math.sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm else []
