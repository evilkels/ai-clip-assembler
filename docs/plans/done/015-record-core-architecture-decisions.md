# Plan 015: Record the core architecture decisions as ADRs

Status: DONE (2026-07-09) in `93b0d37`. Four records and the index shipped;
links resolved, no placeholders remained, and each ADR met its 150–250 word
budget. Priority P2, effort S, risk LOW; planned at `cca2c3b`.

## Goal and decisions recorded

Make settled, cross-cutting constraints discoverable without forcing
contributors to infer them from long plans or implementation details:

1. **Local-first and cloud consent:** Manual Harness is default; provider-backed
   harnesses require explicit saved consent per project before data leaves it.
2. **Backend-authoritative Timeline:** GUI, MCP, and review-agent changes share
   the Operations core; the review agent proposes rather than mutates directly.
3. **Project-folder persistence:** portable JSON plus FFmpeg-derived metadata,
   no database; write failures must never masquerade as durable saves.
4. **Editable export:** FCPXML and Resolve XML preserve supported transforms;
   EDL deliberately flattens unsupported values and reports a warning.

## Documentation policy

ADRs state a durable decision and consequences, then link to implementation
detail. They use `Status`, `Context`, `Decision`, `Consequences`, and
`References`; they do not reopen scope, duplicate architecture docs, or record
unresolved feature choices. Use the exact domain language from
`UBIQUITOUS_LANGUAGE.md`.

Artifacts: `docs/adr/README.md` and ADRs `0001`–`0004`. Create future ADRs only
for similarly cross-cutting, settled decisions.
