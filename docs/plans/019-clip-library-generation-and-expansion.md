# Plan 019: Clip-library generation and expansion

Status: TODO · Priority P2 · Effort L · Risk MED · Category tech debt
Depends on Plan 018 + `ad62ed1` · Planned at `ad62ed1`, 2026-07-22
Absorbed plan 028 (source-scoped expansion) on 2026-09-02 as Phase 2.

This plan owns the whole clip-generation seam. Phase 1 collapses the two
existing assembly paths behind one typed interface; Phase 2 then adds
source-scoped expansion on top of that interface. They are one plan because
Phase 2 needs Phase 1's `generate_clip_library` seam — pursued separately, it
would create a second generation path, which is the exact debt Phase 1 exists
to remove.

## Phase 1 — one generation seam

### Why and current evidence

Fresh analysis and cached re-derive assemble and decorate Candidate Clips in two
places (`analysis_service.py:252-349`, `api.py:726-764`). This split caused the
embedding/re-derive bug fixed in `ad62ed1`; future clip rules still need parallel
edits. `assign_look_groups` both mutates dicts and returns a reordered list
(`clip_diversity.py:33-62`), while its production caller discards the return
(`analysis_service.py:445-448`). Slow-motion eligibility is duplicated at
`clip_assembly.py:149-152` and `assembly_profiles.py:90-93`. Window generation
materializes every eligible slice before selecting one (`clip_assembly.py:47-85,
220-256`). Impact: correctness drift and a broad test surface; confidence HIGH.

### Target interface and boundaries

Create `backend/src/clip_generation.py` with one typed interface:
`generate_clip_library(sources, preferences, *, embedding_provider=None) -> ClipLibraryResult`.
It owns per-source assembly, source metadata, embedding-cache updates/reuse,
pure Look Group assignment, ranking, and generation stats. Fresh analysis and
cached re-derive only adapt their inputs and persist/use the returned result.
Keep HTTP JSON, Pydantic models, frame-score sidecars v1–v3, Pi enhancement,
Timeline preservation, draft formats, and export behavior unchanged.

### Execution steps

1. Add characterization tests comparing Analyze and Re-derive for identical and
   changed preferences, partial analysis, missing embeddings, and manual Timeline
   preservation. Run them red only when the new interface is referenced.
2. Add typed `AnalyzedSource`/`ClipLibraryResult` inputs and implement the module;
   move existing behavior without changing output. Switch both callers, then
   delete the duplicated loops and old finalization helpers.
3. Make Look Group calculation pure: accept typed clips plus embeddings and
   return `clip_id -> group`; apply it once inside the module. Document that group
   numbers are ephemeral, score-ordered labels—not persisted identity.
4. Make draft assembly the sole owner of slow-motion policy; remove candidate-
   creation thresholds. Replace `candidate_windows` + `best_window` with a
   behavior-equivalent best-window scan that does not retain all windows.

### Verification and done criteria

Run `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py && .venv/bin/ruff check src tests` (all pass), then
`cd frontend && npm run typecheck` (generated contract unchanged). `rg -n
'assemble_smooth_clips' backend/src` must show only the deep module/default
injection; no transient `clip["embedding"]`; one slow-mo threshold owner. Stop
if parity requires an HTTP/schema change, sidecar rewrite, or Pi re-embedding;
report that as a separate migration instead of broadening this refactor.

## Phase 2 — find more clips from one Source Video

Only start this once Phase 1 has landed and `generate_clip_library` is the sole
generation path.

**Goal:** let an editor append additional Candidate Clips from a single Source
Video using its cached analysis, without re-running ffmpeg.

**Architecture:** source-scoped expansion sits behind the Phase 1 interface. It
reads cached Frame Scores for one Source Video, ranks alternative windows,
drops ranges overlapping the existing Candidate Clip library, appends up to
three stable-ID candidates, recomputes Look Groups and stats, and leaves the
Timeline Document untouched. Review exposes the action beside the Source Video
duration track and refreshes All Clips from the returned authoritative library.

**Tasks:** (1) extend the module with ranked source alternatives; (2) add an
incremental source-expansion endpoint with merge and persistence; (3) add the
"Find more from this Source Video" action to All Clips; (4) full verification.

The step-level detail — failing tests first, exact commands, and done criteria
for each task — is preserved in
[`done/028-find-more-clips-from-source-video.md`](done/028-find-more-clips-from-source-video.md),
which remains the authoritative specification for this phase. It lives under
`done/` because it is closed as a standalone plan, not because it is
implemented.

**Carried constraint:** expansion must use cached frame scores only, and must
not change the `clip_id` of any window that was already in the library —
`clip_id` is a uuid5 of file plus range, and changing it would break decision
and version provenance (plan 009).
