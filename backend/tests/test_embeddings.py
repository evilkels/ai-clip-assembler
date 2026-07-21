import math

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
