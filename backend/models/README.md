# Embedding model (Plan 018, Task B3)

`default_embedding_provider()` (`src/embeddings.py`) resolves an ONNX image
encoder from, in order: the `CLIP_ONNX_PATH` env var, then
`backend/models/siglip_image_encoder.onnx`. Neither is committed to this
repo; when absent, embeddings are skipped and clip diversity falls back to
"every candidate is its own look group" (see `docs/plans/018-diverse-clip-generation.md`).

**Selected model:** the vision tower of `google/siglip-base-patch16-224`
(Apache-2.0, both code and weights), pinned at HF revision
`7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed`. Apple MobileCLIP (research-only
license) and OpenAI CLIP (ambiguous redistribution terms for the checkpoint)
were both rejected.

**Runtime contract** (`OnnxClipEmbeddingProvider` in `src/embeddings.py`):
- Input: `pixel_values`, float32, shape `(batch, 3, 224, 224)`.
- Preprocessing: direct bicubic resize to 224x224 (no center-crop), rescale
  `1/255`, normalize with mean/std `0.5`, HWC -> CHW.
- Output: pooled image embedding, float32, shape `(batch, 768)`, L2-normalized
  by `embed_candidate()` before use.
- Export only the vision tower (no text tower/tokenizer) — `optimum-cli`
  does not support SigLIP; export directly with
  `transformers.SiglipVisionModel` + `torch.onnx.export`.

**Redistribution record is missing.** This file previously cited
`/tmp/plan018-claude-license-report.md` for the full redistribution analysis.
That file was never committed and no longer exists, so the analysis behind
bundling third-party weights cannot currently be produced. SigLIP's weights are
Apache-2.0 and that is independently verifiable, so the conclusion is very
likely sound — but re-derive the analysis and commit it under `docs/` before
bundling, and link it from here instead of a temp path. Tracked as a blocker in
`docs/plans/025-bundle-siglip-embedding-model.md`.

**Packaging (not yet done):** do not commit the exported `.onnx` binary to
git. Fetch it at DMG build time from a pinned, checksum-verified location,
and commit the SHA256 of the exported file alongside this README. Add a
`NOTICE` entry (Apache-2.0 attribution for Google's SigLIP model) when the
model is actually bundled.
