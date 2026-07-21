import math

import pytest

from src.embeddings import FakeEmbeddingProvider, embed_candidate


def test_embed_candidate_is_unit_norm_and_deterministic(tmp_path):
    path = tmp_path / "f.jpg"
    path.write_bytes(b"abc")
    provider = FakeEmbeddingProvider(dim=8)
    first = embed_candidate(provider, [str(path)])
    second = embed_candidate(provider, [str(path)])
    assert first == second
    assert abs(math.sqrt(sum(value * value for value in first)) - 1.0) < 1e-6


def test_embed_candidate_none_without_frames():
    assert embed_candidate(FakeEmbeddingProvider(dim=8), []) is None


@pytest.mark.parametrize("dim", [0, -1])
def test_fake_embedding_provider_rejects_non_positive_dimensions(dim):
    with pytest.raises(ValueError, match="positive"):
        FakeEmbeddingProvider(dim=dim)


def test_embed_candidate_normalizes_each_frame_before_averaging():
    provider = StaticEmbeddingProvider([[3.0, 4.0], [0.0, 10.0]])

    embedding = embed_candidate(provider, ["first", "second"])

    assert embedding == pytest.approx([0.316227766, 0.948683298])


def test_embed_candidate_none_when_provider_returns_only_zero_vectors():
    provider = StaticEmbeddingProvider([[0.0, 0.0], [0.0, 0.0]])

    assert embed_candidate(provider, ["first", "second"]) is None


class StaticEmbeddingProvider:
    def __init__(self, vectors):
        self.vectors = vectors

    def embed_images(self, paths):
        return self.vectors
