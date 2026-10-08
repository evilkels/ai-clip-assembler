import pytest

from src.ai_engines.payload import PayloadError, stage, staged, validate_images
from src.ai_engines.types import AiRequest


def request(images, samples_dir, **kwargs):
    return AiRequest(images=images, samples_dir=samples_dir, text="look", schema={"type": "object"}, timeout_sec=1, **kwargs)


def test_rejects_images_outside_samples_dir(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"outside")
    with pytest.raises(PayloadError):
        validate_images([outside], samples, 12)


def test_rejects_symlink_that_resolves_outside_samples_dir(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"outside")
    link = samples / "link.jpg"
    link.symlink_to(outside)
    with pytest.raises(PayloadError):
        validate_images([link], samples, 12)


def test_rejects_non_jpg_and_more_than_limit(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    png = samples / "frame.png"
    png.write_bytes(b"png")
    with pytest.raises(PayloadError):
        validate_images([png], samples, 12)
    jpgs = []
    for i in range(2):
        path = samples / f"{i}.jpg"
        path.write_bytes(b"jpg")
        jpgs.append(path)
    with pytest.raises(PayloadError):
        validate_images(jpgs, samples, 1)


def test_stage_copies_only_staged_images_and_context_cleans_up(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    images = []
    for i in range(2):
        path = samples / f"original-{i}.jpg"
        path.write_bytes(f"image-{i}".encode())
        images.append(path)
    req = request(images, samples)

    with staged(req) as staged_request:
        assert sorted(path.name for path in staged_request.cwd.iterdir()) == ["frame-01.jpg", "frame-02.jpg"]
        assert [path.read_bytes() for path in staged_request.images] == [b"image-0", b"image-1"]
        assert staged_request.names == ["frame-01.jpg", "frame-02.jpg"]
        scratch = staged_request.cwd
    assert not scratch.exists()


def test_context_cleans_up_when_body_raises(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    path = samples / "one.jpg"
    path.write_bytes(b"jpg")
    with pytest.raises(RuntimeError):
        with staged(request([path], samples)) as staged_request:
            scratch = staged_request.cwd
            raise RuntimeError("stop")
    assert not scratch.exists()


def test_rejects_invalid_or_duplicate_image_names(tmp_path):
    samples = tmp_path / "samples"
    samples.mkdir()
    images = []
    for i in range(2):
        path = samples / f"{i}.jpg"
        path.write_bytes(b"jpg")
        images.append(path)
    for names in (["../secret.jpg", "frame-02.jpg"], ["frame-01.jpg", "frame-01.jpg"], ["frame-01.jpg"]):
        with pytest.raises(PayloadError):
            stage(request(images, samples, image_names=names))
