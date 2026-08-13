# Plan 025: Export and bundle the SigLIP embedding model

Status: TODO · Priority P1 · Effort M · Risk MED · Category release correctness
Depends on Plan 018 (code complete) and `self-contained-runtime-tools.md` · Planned 2026-08-13

## Why and current evidence

Plan 018 shipped every code path for diverse clip generation, but the model it
depends on has never existed in the repo or the build. `backend/models/`
contains only `README.md`; `default_embedding_provider()`
(`backend/src/embeddings.py:109-125`) resolves `CLIP_ONNX_PATH` then
`backend/models/siglip_image_encoder.onnx`, finds neither, and returns `None`.
`assign_look_groups` then puts every candidate in its own Look Group, so the
diversity constraint in edit assembly is a no-op.

The consequence is user-visible and silent: Phases B–D of plan 018 are
exercised only by `FakeEmbeddingProvider` in tests, so shipped builds behave
exactly as they did before that work landed. `onnxruntime==1.19.2`,
`numpy==2.0.2` and `pillow==11.1.0` are already pinned in
`backend/requirements.txt`, so nothing is missing but the artifact and its
provenance.

## Constraints carried forward from Plan 018

- **Do not commit the `.onnx` binary to git.** `backend/models/README.md`
  fixes this: fetch at build time from a pinned, checksum-verified location.
- Model is the vision tower of `google/siglip-base-patch16-224` (Apache-2.0
  code *and* weights), pinned at HF revision
  `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed`. Do not substitute OpenAI CLIP or
  MobileCLIP — both were rejected on redistribution terms.
- `optimum-cli` does not support SigLIP. Export directly with
  `transformers.SiglipVisionModel` + `torch.onnx.export`, vision tower only,
  no text tower or tokenizer.
- Graceful degradation stays a hard invariant. A missing, corrupt, or
  shape-mismatched model must still return `None` and analyse without
  embeddings — never raise, never download at runtime.
- `clip_id = uuid5(file + range)` identity must not change. Introducing
  embeddings changes Look Group *labels*, which are ephemeral and score-ordered;
  it must not change clip identity or break decision/version provenance
  (plan 009).

## Execution steps

1. **Export, reproducibly.** Add a committed export script (not a one-off shell
   session) that takes the pinned HF revision and emits
   `siglip_image_encoder.onnx` with the exact runtime contract in
   `backend/models/README.md`: input `pixel_values` float32 `(batch, 3, 224,
   224)`, output pooled float32 `(batch, 768)`. Record the SHA-256 of the
   produced file in `backend/models/` alongside the README.
2. **Verify the contract against the consumer, not the exporter.** Add a
   backend test, skipped when the model is absent, that runs
   `OnnxClipEmbeddingProvider` on two sampled frames and asserts: output shape
   `(2, 768)`, finite values, and that cosine similarity of a frame with itself
   is ~1.0 while two visibly different frames score below the 0.92 clustering
   threshold. A model that exports cleanly but embeds meaninglessly is the
   failure mode this catches.
3. **Fetch and stage at build time.** Extend the packaging path alongside
   `frontend/scripts/stage-runtime-tools.mjs` to fetch the artifact from the
   pinned location, verify the committed SHA-256, and place it where
   `default_embedding_provider()` resolves it inside the packaged backend.
   Staging must **reject the build** on checksum mismatch or a missing file —
   silently shipping a build with inert diversity is the exact failure this
   plan exists to end. Mirror the reject-on-missing behaviour that script
   already applies to `vidstabdetect`.
4. **Attribute.** Add a `NOTICE` file (none exists in the repo today) carrying
   the Apache-2.0 attribution for Google's SigLIP, and reference it from the
   packaging compliance material tracked in `self-contained-runtime-tools.md`
   step 1, so both bundled-artifact obligations are recorded in one place.
5. **Prove it is no longer inert.** On a packaged build, analyse a project whose
   footage contains at least two clearly distinct looks and confirm the
   resulting library reports more than one Look Group, and that an assembled
   edit draws at most one clip per group.

## Verification and done criteria

`cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`
passes both with and without the model present — the degraded path must stay
green. `frontend && npm run build` plus the packaging step produce a DMG whose
backend resources contain the verified `.onnx`, and step 5's real-footage check
shows more than one Look Group.

Stop and report rather than broadening scope if: the export cannot reproduce the
documented input/output contract; the pinned revision has moved or its license
terms have changed; or hosting the artifact requires a distribution channel
nobody owns. Any of those is a redistribution decision for the maintainer, not
an implementation detail.

## Out of scope

Re-embedding existing analysed projects (sidecars stay v1–v3 as-is; a project
re-derives on next analysis), swapping the clustering algorithm or its 0.92
threshold, GPU execution providers, and any change to the HTTP/JSON contract.
