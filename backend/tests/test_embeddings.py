import math

import numpy as np
import pytest

from src.embeddings import (
    FakeEmbeddingProvider,
    default_embedding_provider,
    embed_candidate,
)


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


def _synthetic_siglip_onnx(path):
    """A tiny valid ONNX graph matching the real SigLIP vision-tower I/O contract
    (pixel_values float32 [batch,3,224,224] -> pooled float32 [batch,768]) so the
    provider's session/preprocessing wiring can be exercised with real onnxruntime
    inference, without downloading or committing the actual multi-hundred-MB model.
    """
    onnx = pytest.importorskip("onnx")
    from onnx import TensorProto, helper

    pixel_values = helper.make_tensor_value_info(
        "pixel_values", TensorProto.FLOAT, [None, 3, 224, 224]
    )
    image_embeds = helper.make_tensor_value_info(
        "image_embeds", TensorProto.FLOAT, [None, 768]
    )
    pooled = helper.make_node("GlobalAveragePool", ["pixel_values"], ["pooled"])
    flattened = helper.make_node("Flatten", ["pooled"], ["flat"], axis=1)
    rng = np.random.default_rng(0)
    weight = rng.standard_normal((3, 768)).astype(np.float32)
    bias = np.zeros(768, dtype=np.float32)
    gemm = helper.make_node("Gemm", ["flat", "weight", "bias"], ["image_embeds"])
    graph = helper.make_graph(
        [pooled, flattened, gemm],
        "synthetic-siglip-vision-tower",
        [pixel_values],
        [image_embeds],
        initializer=[
            helper.make_tensor("weight", TensorProto.FLOAT, weight.shape, weight.flatten()),
            helper.make_tensor("bias", TensorProto.FLOAT, bias.shape, bias.flatten()),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    onnx.checker.check_model(model)
    onnx.save(model, str(path))


def test_preprocess_siglip_image_shape_dtype_and_range(tmp_path):
    from PIL import Image

    from src.embeddings import _preprocess_siglip_image

    path = tmp_path / "img.jpg"
    Image.new("RGB", (64, 96), (10, 20, 30)).save(path)

    array = _preprocess_siglip_image(str(path))

    assert array.shape == (3, 224, 224)
    assert array.dtype == np.float32
    assert array.min() >= -1.0 - 1e-6
    assert array.max() <= 1.0 + 1e-6


def test_default_embedding_provider_none_when_no_env_and_no_bundled_model(monkeypatch):
    monkeypatch.delenv("CLIP_ONNX_PATH", raising=False)
    assert default_embedding_provider() is None


def test_default_embedding_provider_none_when_env_path_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("CLIP_ONNX_PATH", str(tmp_path / "missing.onnx"))
    assert default_embedding_provider() is None


def test_default_embedding_provider_none_on_corrupt_model_file(monkeypatch, tmp_path):
    pytest.importorskip("onnxruntime")
    bad_path = tmp_path / "corrupt.onnx"
    bad_path.write_bytes(b"not a real onnx model")
    monkeypatch.setenv("CLIP_ONNX_PATH", str(bad_path))

    assert default_embedding_provider() is None


def test_onnx_provider_real_inference_with_synthetic_model(tmp_path, monkeypatch):
    pytest.importorskip("onnxruntime")
    from PIL import Image

    model_path = tmp_path / "siglip_image_encoder.onnx"
    _synthetic_siglip_onnx(model_path)
    monkeypatch.setenv("CLIP_ONNX_PATH", str(model_path))

    provider = default_embedding_provider()
    assert provider is not None

    img_path = tmp_path / "img.jpg"
    Image.new("RGB", (64, 96), (120, 200, 90)).save(img_path)

    vector = embed_candidate(provider, [str(img_path)])

    assert vector is not None
    assert len(vector) == 768
    assert abs(math.sqrt(sum(value * value for value in vector)) - 1.0) < 1e-6


def test_onnx_provider_smoke(tmp_path, monkeypatch):
    """Mirrors the shipped (no bundled model) behavior: skip rather than fail."""
    monkeypatch.delenv("CLIP_ONNX_PATH", raising=False)
    provider = default_embedding_provider()
    if provider is None:
        pytest.skip("SigLIP ONNX model/runtime not available")
    from PIL import Image

    path = tmp_path / "img.jpg"
    Image.new("RGB", (64, 64), (120, 200, 90)).save(path)
    vector = embed_candidate(provider, [str(path)])
    assert vector is not None and len(vector) > 0
