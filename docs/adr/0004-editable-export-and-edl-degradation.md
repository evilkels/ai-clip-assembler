# 0004: Exports are editable handoffs; EDL deliberately flattens Speed/Transform

## Status

Accepted.

## Context

An Export serializes the Timeline Document into a professional editing app so
the Editor can keep refining the cut there — it is a handoff, not a final
render. Timeline Items can carry non-default **Speed** (retime) and
**Transform** (digital zoom/pan/crop). Not every export format can represent
both: FCPXML and Resolve XML support per-clip motion parameters, but EDL
(CMX3600) is a plain edit list with no such fields. Silently dropping that
data on EDL export would produce a technically valid file that misrepresents
the intended cut.

## Decision

FCPXML and Resolve XML encode supported Speed and Transform values (FCPXML
via `adjust-transform`, Resolve XML via Basic Motion). EDL export deliberately
flattens Speed and Transform instead of attempting a lossy approximation, and
the export response carries an explicit flatten warning so the Editor knows
which edits did not survive.

## Consequences

- Editors choosing EDL for broad compatibility must expect to reapply Speed
  and Transform manually in the target app; the warning is the contract that
  makes this expected rather than surprising.
- Any new export format must state up front which Timeline Item fields it
  can represent, following the same encode-or-warn pattern rather than
  silently dropping data.
- QA validation must check both that FCPXML/Resolve XML preserve Speed and
  Transform and that EDL export surfaces its flatten warning without
  crashing or losing the project.

## References

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Export (`export_engine.py`)
- [docs/QA.md](../QA.md) — Section 5, Export
- [UBIQUITOUS_LANGUAGE.md](../../UBIQUITOUS_LANGUAGE.md) — Speed, Transform, EDL, FCPXML, Resolve XML
