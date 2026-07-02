# Plan 010: Generate the frontend domain types from the backend, killing hand-maintained contract drift

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's row in
> `docs/plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 412ffc3..HEAD -- backend/src/models.py backend/src/assembly_profiles.py frontend/src/renderer/src/types/clip.ts frontend/src/renderer/src/types/version.ts frontend/src/renderer/src/api/client.ts`
> If an in-scope file changed, compare the excerpts below with the live code
> before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Status**: TODO
- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the type definitions every screen consumes; behaviour must not change)
- **Depends on**: none
- **Category**: tech-debt / architecture
- **Planned at**: commit `412ffc3` (work began at `f0999aa`), 2026-06-28

## Why this matters

The same domain entities are declared by hand on both sides of the HTTP
boundary, with a manual mapping layer in between. A `Clip`'s score fields exist
in `backend/src/models.py` (`FrameScore`, `ClipSuggestion`), again in
`frontend/.../api/client.ts` (`BackendClipSuggestion`), and a third time in
`frontend/.../types/clip.ts` (`ClipScores`). The assembly-profile enum is
declared in two places; `Version`/`CreativeVersion` in two more. Adding one
score metric today means editing 5–7 files in lockstep with **nothing** failing
if you miss one — the frontend silently drops the field. This plan makes the
backend Pydantic models the single source of truth and generates the frontend
types from them, so drift becomes a compile error instead of a silent bug.

## Current state

The duplicated declarations (confirmed at `412ffc3`):

- `backend/src/models.py:51-71` — `ClipSuggestion` (now including the declared
  `source_created_at` / `source_duration_sec` carried fields).
- `backend/src/models.py:33-49` — `FrameScore` (the per-frame score fields).
- `backend/src/models.py:115-141` — `CreativeVersionItem`, `CreativeVersion`
  (`profile` is `Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]`).
- `backend/src/assembly_profiles.py:4` — `AssemblyProfile = Literal[...]` (the
  canonical backend enum; the same four strings).
- `frontend/src/renderer/src/api/client.ts:61-104` — `BackendClipSuggestion`
  interface + `mapBackendClip()` that renames `*_score` → `{ smoothness, ... }`.
- `frontend/src/renderer/src/types/clip.ts:5-12,14,76-80` — `ClipScores`,
  `ClipCandidate`, and a hand-copy of the `AssemblyProfile` union.
- `frontend/src/renderer/src/types/version.ts:4,15,26` — `VersionItem`,
  `Version`, `VersionSet`.

There is **no** generated or shared schema today — every type is hand-written
on both sides. The backend is FastAPI, so it already exposes an OpenAPI schema,
but the read routes return `.model_dump()` / plain dicts with no `response_model=`,
so the OpenAPI component schemas are largely empty. Generating from the Pydantic
models directly is therefore the lower-touch path.

Vocabulary (from `UBIQUITOUS_LANGUAGE.md`): the canonical terms are **Candidate
Clip**, **Version**, **Proposal**, **Source Clip**, **Timeline Document**,
**Timeline Item**. Backend class names `ClipSuggestion` / `CreativeVersion`
predate this vocabulary. Renaming the Pydantic classes is **out of scope** here
(it touches ~10 backend files and persisted-JSON-adjacent code) — this plan
aligns the *frontend* names to the vocabulary as it maps generated types.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py -q` | `321 passed` (or more) |
| Backend lint | `cd backend && .venv/bin/ruff check src tests` | `All checks passed!` |
| FE typecheck | `cd frontend && npm run typecheck` | exit 0, no output |
| FE lint | `cd frontend && npm run lint:frontend` | exit 0 |
| FE build | `cd frontend && npm run build` | exit 0 |
| Generate types | `cd backend && .venv/bin/pydantic2ts --module src.models --output ../frontend/src/renderer/src/types/generated.ts` | writes the file, exit 0 |

## Approach

Use **`pydantic-to-typescript`** (CLI `pydantic2ts`, which wraps
`json-schema-to-typescript`). It emits a single `.ts` of interfaces from a
Pydantic module. This is preferred over OpenAPI codegen because it does not
require annotating every FastAPI route with `response_model=` first.

If `pydantic2ts` cannot represent something the executor needs (e.g. it requires
Node's `json2ts` and the repo's Node toolchain rejects it), **STOP and report** —
do not hand-roll a generator.

## Scope

**In scope** (the only files you should modify or create):
- `backend/requirements.txt` (add `pydantic-to-typescript` to the dev tooling) — confirm the file exists; if dev deps live elsewhere, match that.
- `backend/src/assembly_profiles.py` (only if needed to export the enum for generation)
- `frontend/package.json` (add a `gen:types` script + wire into `typecheck`/`build` as a check)
- `frontend/src/renderer/src/types/generated.ts` (create — generated output, committed)
- `frontend/src/renderer/src/types/clip.ts`, `types/version.ts` (re-point to generated types; keep frontend-only names as aliases)
- `frontend/src/renderer/src/api/client.ts` (have `BackendClipSuggestion` reference the generated type; keep `mapBackendClip`)

**Out of scope** (do NOT touch):
- Renaming `ClipSuggestion` / `CreativeVersion` Pydantic classes — separate concern, persisted-data adjacent.
- `Proposal.operations` typing — deferred to a follow-up (see Maintenance notes); changing it touches the apply path in `review_agent.py:91,183,408`.
- Any change to API response shapes or route handlers.
- Backend business logic.

## Git workflow

- Branch: continue on `refactor/architecture-cleanup` (this session's branch) or a fresh `advisor/010-shared-contract` if starting cold.
- Conventional-commit style, matching `git log` (e.g. `refactor(types): generate frontend domain types from backend models`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Install the generator and produce `generated.ts`

Add `pydantic-to-typescript` to the backend venv (`cd backend && .venv/bin/pip install pydantic-to-typescript`) and record it in `requirements.txt` dev section. Generate:

`cd backend && .venv/bin/pydantic2ts --module src.models --output ../frontend/src/renderer/src/types/generated.ts`

Add a header comment to the generated file is automatic; do not hand-edit it.

**Verify**: `test -f frontend/src/renderer/src/types/generated.ts && grep -c "interface" frontend/src/renderer/src/types/generated.ts` → file exists, ≥5 interfaces (expect `ClipSuggestion`, `FrameScore`, `CreativeVersion`, `Proposal`, `TimelineDocument`, …).

### Step 2: Add a regeneration script and a drift check

In `frontend/package.json` scripts, add:
`"gen:types": "cd ../backend && .venv/bin/pydantic2ts --module src.models --output ../frontend/src/renderer/src/types/generated.ts"`

Add a `check:types-fresh` that regenerates to a temp file and `diff`s against the committed `generated.ts`, failing on difference; chain it into `typecheck` so CI catches a stale file. If wiring into `typecheck` proves brittle in this repo's setup, add it as a standalone script and note it in the PR instead — do not block on it.

**Verify**: `cd frontend && npm run gen:types && git diff --exit-code frontend/src/renderer/src/types/generated.ts` → exit 0 (regeneration is stable/idempotent).

### Step 3: Re-point `clip.ts` and `version.ts` to the generated types

Keep the frontend-facing names the screens already import (`ClipCandidate`,
`ClipScores`, `Version`, `VersionSet`) but define them in terms of the generated
interfaces instead of re-declaring fields. Two valid shapes:

- `export type Version = import('./generated').CreativeVersion;` (alias to the canonical generated type), or
- where the frontend genuinely reshapes (e.g. `ClipScores` uses `smoothness` not `smoothness_score`), keep the reshaped interface but add a **type-level assertion** that every backend score field is accounted for, so a new backend field breaks the build. Example pattern to include:
  ```ts
  import type { ClipSuggestion } from './generated';
  // Compile-time guard: every score field on the backend clip must be mapped.
  type _ScoreKeysCovered = Exclude<
    Extract<keyof ClipSuggestion, `${string}_score`>,
    'smoothness_score' | 'sharpness_score' | 'exposure_score' | 'contrast_score' | 'visual_interest_score' | 'overall_score'
  >;
  const _assertNoUnmappedScores: _ScoreKeysCovered = undefined as never; // errors if a new *_score field appears
  ```
  Adapt names to whatever the generated file actually emits.

**Verify**: `cd frontend && npm run typecheck` → exit 0.

### Step 4: Re-point `client.ts`

Replace the standalone `BackendClipSuggestion` interface body with
`type BackendClipSuggestion = import('../types/generated').ClipSuggestion;`
(keep the name so `mapBackendClip`'s signature is unchanged). Leave
`mapBackendClip()` logic intact — it still does the `*_score` → camel reshape.

**Verify**: `cd frontend && npm run typecheck && npm run lint:frontend` → both exit 0.

### Step 5: Align the profile enum

Make the frontend `AssemblyProfile` union derive from the generated type (the
`profile` field on the generated `CreativeVersion`) rather than the hand-copied
union in `clip.ts:76-80`. If the generator emits the literal inline, extract it:
`export type AssemblyProfile = NonNullable<import('./generated').CreativeVersion['profile']>;`

**Verify**: `cd frontend && npm run typecheck` → exit 0; `grep -n "short_social" frontend/src/renderer/src/types/clip.ts` → no hand-written union remains (only via the generated derivation).

### Step 6: Full verification

Run the whole gate set (see Done criteria).

## Test plan

- No new runtime tests — this is a type-only refactor; the compiler is the test.
- Add the **type-level assertion** in Step 3 as the regression guard (a new
  backend `*_score` field must fail `npm run typecheck`).
- Confirm the existing `frontend/e2e/compare-versions.spec.ts` still
  type-checks (it imports these types). Do not run Playwright (needs the app
  stack); `npm run build` covers compilation.
- Backend suite must stay green (you only added a dev dependency / optional
  enum export).

## Done criteria

ALL must hold:

- [ ] `frontend/src/renderer/src/types/generated.ts` exists and is committed.
- [ ] `cd frontend && npm run gen:types && git diff --exit-code -- frontend/src/renderer/src/types/generated.ts` exits 0 (idempotent).
- [ ] `cd frontend && npm run typecheck` exits 0.
- [ ] `cd frontend && npm run lint:frontend` exits 0.
- [ ] `cd frontend && npm run build` exits 0.
- [ ] `cd backend && .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py -q` → still `321 passed` (or more).
- [ ] `grep -n "short_social" frontend/src/renderer/src/types/clip.ts` shows no standalone hand-written union.
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `docs/plans/README.md` row for 010 updated.

## STOP conditions

Stop and report (do not improvise) if:
- `pydantic2ts` fails to install or run in this repo's toolchain, or emits types
  that don't compile.
- The generated names differ so much from the assumptions above that re-pointing
  would change a screen's behaviour (not just its type source).
- Any "Current state" excerpt no longer matches the live code (drift).
- A verification fails twice after a reasonable fix attempt.
- Making `typecheck` depend on the freshness check breaks unrelated CI — fall
  back to a standalone script and note it, don't fight it.

## Maintenance notes

- After this lands, **adding a backend model field is the only edit needed** —
  regenerate (`npm run gen:types`) and the frontend picks it up; the Step 3
  assertion forces mapping of new score fields.
- **Deferred follow-up**: type `Proposal.operations` (`models.py:90`, currently
  `List[dict]`). It's consumed as dicts in `review_agent.py:91,183,408`
  (`op["operation"]`, `op.get("args", {})`); introducing an `Operation` model
  means either keeping those as dict access via `model_dump()` or migrating the
  call sites. Worth doing, but separate from the codegen work.
- **Reviewer focus**: confirm `mapBackendClip` still produces identical objects
  (diff a sample clip before/after); confirm no screen started reading a field
  that's now `undefined` because a name changed.
