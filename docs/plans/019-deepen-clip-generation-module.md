# Plan 019: Deepen the clip-generation module

Status: TODO · Priority P2 · Effort L · Risk MED · Category tech debt
Depends on Plan 018 + `ad62ed1` · Planned at `ad62ed1`, 2026-07-22

## Why and current evidence

Fresh analysis and cached re-derive assemble and decorate Candidate Clips in two
places (`analysis_service.py:252-349`, `api.py:726-764`). This split caused the
embedding/re-derive bug fixed in `ad62ed1`; future clip rules still need parallel
edits. `assign_look_groups` both mutates dicts and returns a reordered list
(`clip_diversity.py:33-62`), while its production caller discards the return
(`analysis_service.py:445-448`). Slow-motion eligibility is duplicated at
`clip_assembly.py:149-152` and `assembly_profiles.py:90-93`. Window generation
materializes every eligible slice before selecting one (`clip_assembly.py:47-85,
220-256`). Impact: correctness drift and a broad test surface; confidence HIGH.

## Target interface and boundaries

Create `backend/src/clip_generation.py` with one typed interface:
`generate_clip_library(sources, preferences, *, embedding_provider=None) -> ClipLibraryResult`.
It owns per-source assembly, source metadata, embedding-cache updates/reuse,
pure Look Group assignment, ranking, and generation stats. Fresh analysis and
cached re-derive only adapt their inputs and persist/use the returned result.
Keep HTTP JSON, Pydantic models, frame-score sidecars v1–v3, Pi enhancement,
Timeline preservation, draft formats, and export behavior unchanged.

## Execution steps

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

## Verification and done criteria

Run `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py && .venv/bin/ruff check src tests` (all pass), then
`cd frontend && npm run typecheck` (generated contract unchanged). `rg -n
'assemble_smooth_clips' backend/src` must show only the deep module/default
injection; no transient `clip["embedding"]`; one slow-mo threshold owner. Stop
if parity requires an HTTP/schema change, sidecar rewrite, or Pi re-embedding;
report that as a separate migration instead of broadening this refactor.
