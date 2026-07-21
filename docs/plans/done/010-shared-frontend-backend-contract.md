# Plan 010: Generate frontend domain types from the backend, killing hand-maintained contract drift

## Status

- **Status**: DONE (2026-07-02; re-verified 2026-07-21 at `9a6d56a`) — generated
  Pydantic-derived frontend types are committed, the freshness check is wired
  into `typecheck`, and backend/frontend gates remain green.
- **Priority**: P1 | **Effort**: M | **Risk**: MED (touches types every screen consumes)
- **Depends on**: none
- **Planned at**: commit `412ffc3` (work began at `f0999aa`), 2026-06-28

## Why this matters

The same domain entities (clip scores, assembly-profile enum, Version) were
hand-declared on both sides of the HTTP boundary plus a manual mapping layer,
with nothing failing if a field was missed on one side — the frontend would
silently drop it. This plan makes backend Pydantic models (`backend/src/models.py`)
the single source of truth and generates frontend types from them, turning
drift into a compile error.

## Decisions

Used **`pydantic-to-typescript`** (CLI `pydantic2ts`) rather than OpenAPI
codegen, because backend routes return `.model_dump()`/plain dicts without
`response_model=`, so OpenAPI component schemas were largely empty —
generating straight from Pydantic was the lower-touch path. Generated output
(`frontend/src/renderer/src/types/generated.ts`) is committed, not built on
the fly, with a `check:types-fresh` diff-based drift check wired into
`typecheck`. Renaming backend Pydantic classes (`ClipSuggestion`,
`CreativeVersion`) to match `UBIQUITOUS_LANGUAGE.md` vocabulary was explicitly
out of scope (touches ~10 backend files, persisted-JSON-adjacent) — only the
frontend-facing names/aliases were aligned to vocabulary. A compile-time
"exhaustiveness" assertion (`_ScoreKeysCovered`) was added so a new backend
`*_score` field fails `typecheck` until mapped on the frontend.

## Completion record

All done criteria met: generated types committed and idempotent; frontend
typecheck/lint/build green; backend 364 tests passed (2026-07-21); frontend
`AssemblyProfile` now derives from the generated type.

## Maintenance notes

Adding a backend model field now only needs `npm run gen:types` regeneration;
the score-key assertion forces mapping of new fields. Deferred follow-up:
`Proposal.operations` is still typed as `List[dict]` (`models.py:90`,
consumed as dicts in `review_agent.py`) — introducing an `Operation` model
was judged separate from the codegen work. Reviewer focus: confirm
`mapBackendClip` still produces identical objects, and no screen silently
reads an `undefined` field due to a rename.
