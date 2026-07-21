# Plan 013: Make browser E2E signals deterministic and meaningful

Status: DONE (2026-07-21). Changes landed in `844c029`; reconciliation at
`9a6d56a` ran the complete built-app gate: 9 Playwright tests and typecheck
passed. Priority P1, effort S, risk LOW; planned at `cca2c3b`.

## Goal and findings

Make a red browser run mean a user-visible regression rather than an ambiguous
locator or stale fixture assumption.

- `compare-versions.spec.ts` searched globally for `Proposed in A/C`, but the
  valid label appears on multiple Candidate Clip cards and violated strict mode.
- `timeline-playback.spec.ts` assumed the first two Timeline Items came from
  different Source Videos, but richer generation can emit several items from
  the first file before the actual cross-file boundary.

## Delivered

- Scoped the version label to the known Source Clip card; deliberately avoided
  `.first()`, which would hide incorrect placement.
- Made timeline setup discover the first rendered Source Video transition and
  target the preceding Timeline Item. Playback remains event-driven with
  `expect.poll`; no fixed wait or forced Candidate Clip count was introduced.
- Only the two E2E specs changed; production React, analysis rules, and global
  Playwright timeouts stayed out of scope.

## Verification and invariant

`cd frontend && npm run test:e2e && npm run typecheck` must report 9 passing
browser tests and exit 0. When Candidate Clip rules change, browser tests must
discover boundaries from rendered Timeline Items or an explicit fixture
contract, never positional assumptions about generated sequences.
