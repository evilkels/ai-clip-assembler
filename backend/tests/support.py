import hashlib
import math
from pathlib import Path

from lxml import etree


def assert_valid_fcpxml(xml_text: str) -> None:
    dtd_path = Path(__file__).parent / "fixtures" / "fcpxml" / "FCPXMLv1_10.dtd"
    dtd = etree.DTD(str(dtd_path))
    document = etree.fromstring(xml_text.encode())
    if not dtd.validate(document):
        raise AssertionError(str(dtd.error_log))


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
