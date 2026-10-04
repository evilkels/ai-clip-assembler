# 0006: Review scripts compile to Proposals

## Status

Accepted (2026-09-29).

## Context

The Editor wants the DaVinci Resolve console workflow inside the app: write or
paste a short Lua script in the Review chat and have it edit the Timeline. The
In-App Review Agent should be able to answer with such a script too. ADR 0002
makes the Operations core the only way the Timeline Document changes, and
requires the Review Agent's edits to be accepted before they take effect.

## Decision

A **Script** runs in a sandboxed, embedded Lua 5.4 runtime against a copy of
the Timeline Document. Each mutating API call is one existing Operation,
applied to the copy and recorded. The recording becomes an ordinary
**Proposal**; applying it replays the Operations through `apply_batch`, so a
script lands as one revision and one undo step. Items created inside a batch
take ids seeded by the Proposal id, so replay reproduces the dry run exactly.

Scripts written by the Editor and scripts written by the Review Agent follow
the same Run → Apply flow. A script can read the Timeline and the Candidate
Clip library and nothing else: no files, network, frames or Python objects.
Running a script is local, so it needs no cloud-AI consent; generating one
with the Review Agent stays under ADR 0005's consent gate.

## Consequences

- ADR 0002 holds: no new mutation path, and undo, revision checks and the
  `timeline-changed` stream work unchanged.
- A stale Proposal is re-run from its source rather than rebased.
- The API is our own, so scripts written for Resolve do not run here.
- lupa, a compiled extension, becomes a backend dependency and must ship in
  the packaged backend.

## Alternatives considered

**Execute scripts directly on the live Timeline**, as Resolve's console does.
Rejected: a half-finished script would leave a partial edit, and it would open
a second mutation path beside the Operations core.

**Keep JSON Operation lists only.** Rejected: the model has to do per-item
arithmetic in text and cannot express loops or conditions.

**Python or JavaScript as the script language.** Python cannot be sandboxed
safely in-process; an embedded JavaScript engine brings no advantage over Lua
for this workflow, and Lua is what the Editor already uses with Resolve.
