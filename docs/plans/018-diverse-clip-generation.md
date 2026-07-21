# Diverse Clip Generation — Implementation Plan (Plan 018)

**Status:** CODE COMPLETE (2026-07-21) — all five phases A–E landed on `feature/diverse-clip-generation`. One non-code task remains before the feature does anything for a user: **the SigLIP ONNX model is not yet exported or bundled**. `backend/models/README.md` records the decision but the `.onnx` file itself does not exist in the repo/build. Until it's added, `default_embedding_provider()` returns `None` and every candidate falls into its own Look Group — diversity features are inert (a documented no-op degradation, not a bug) in real runs.

**Goal:** Make clip generation produce a diverse library of distinct best fragments (no temporal duplicates, no look-alike monotony) and drive diversity-aware multi-format edits; relocate the six generation controls to the Import page.

**Architecture:** Candidate generation emits one best fragment per smooth run (deterministic de-overlap, Phase A) instead of the old O(n²) overlapping-window family. A pluggable local `EmbeddingProvider` produces a vector per candidate (Phase B); cosine clustering assigns each candidate a `look_group`. Edit assembly (Phase C) enforces at most one clip per look group and offers three length formats (Short/Medium/Long, mapped onto the existing `short_social`/`cinematic_highlight`/`long_scenic` profiles) with sparing slow-mo instead of blanket 0.5x. Review UI (Phase D) groups the library by look, leading with the best clip per group. Generation knobs moved to Import (Phase E); re-deriving after a knob change reuses cached frame scores + embeddings — no FFmpeg re-run.

**Key decisions (with rationale):**
- **Model choice: SigLIP base-patch16-224, not OpenAI CLIP or MobileCLIP.** OpenAI CLIP and MobileCLIP were rejected for ambiguous/research-only redistribution terms; SigLIP's code and weights are both Apache-2.0, safe to bundle in the DMG. See `backend/models/README.md`.
- Look-group clustering is greedy single-link cosine similarity (threshold 0.92 default) against group medoids, processed in descending `overall_score` order so group 0 is always the strongest look — this makes downstream ordering deterministic.
- Graceful degradation is a hard invariant: if the embedding model/provider is absent, every candidate becomes its own look group (diversity constraints become a no-op) rather than analysis/generation failing.
- Re-deriving (`rederive_clips`) must never re-run FFmpeg or re-compute embeddings — it only re-runs clustering/assembly on cached frame scores + cached embedding vectors. This was a carried-forward invariant from plan 012.
- Phase D deliberately skipped adding a component-test framework (vitest/jest/RTL) for one grouping test — the maintainer decided on 2026-07-21 that introducing a test runner solely for this was out of scope; the repo's only frontend test surfaces are Playwright e2e and `node --test` for the Electron main process, neither able to render an isolated React component. Correctness was instead checked by hand-tracing `groupByLook` against both the real degraded case (all-null `look_group`) and a synthetic grouped case, plus the tsc/eslint gate.
- `clip_id = uuid5(...)` identity must be preserved when keeping the top window per moment/group — decision/version provenance (plan 009) depends on stable IDs across re-derivation.

**Surprises / gotchas:**
- Because the ONNX model isn't bundled, everything Phase B–D built is currently exercised only in tests (via `FakeEmbeddingProvider`) — real end-user runs today have one clip per look group, i.e. diversity filtering has no visible effect yet.
- `format` (Short/Medium/Long) is a plain dict key on the backend response, not a pydantic field, so `npm run gen:types` cannot generate its frontend type — it was added by hand to `AssemblyRecommendation`/`DraftResult` in `types/clip.ts`.
- Phase A's one-best-window-per-run change sharply drops `generation_stats.candidates_generated`; any test hard-coding the old large candidate count needed updating.

**Status of phases:** A (temporal de-overlap) — done. B (embeddings + look groups, incl. ONNX provider code) — done, but see model-bundling caveat above. C (diversity-aware multi-format edits) — done. D (library grouping UI + format switcher) — done, landed as `feat(review): group clips by look and add a format switcher`. E (controls relocated to Import) — done, landed as `2f48e2f` and `b0c46dc`.

**Explicitly deferred / out of scope:** exact redistribution mechanics for bundling the model file into the packaged app (a separate task, referenced by the caller of this summary as a README-index fix); richer candidate pool and real creative-agent proposals live in separate plans.
