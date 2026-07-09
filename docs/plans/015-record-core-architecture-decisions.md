# Plan 015: Record the core architecture decisions as ADRs

> **Executor instructions:** Documentation-only plan. Preserve the established decisions; do not use ADRs to reopen implementation scope.
>
> **Drift check:** `git diff --stat cca2c3b..HEAD -- CONTEXT.md docs/ARCHITECTURE.md docs/HARNESS_SPEC.md docs/adr`.

## Status

- **Status:** TODO
- **Priority:** P2
- **Effort:** S
- **Risk:** LOW
- **Depends on:** none
- **Category:** docs / architecture
- **Planned at:** commit `cca2c3b`, 2026-07-09

## Why this matters

The app has consequential, settled design choices but `docs/adr/` contains only an empty index. Contributors currently need to infer local-first privacy, Timeline authority, project persistence, and export degradation rules from long architecture and plan documents. Short ADRs make those constraints discoverable and prevent accidental reversals.

## Documentation budget

- Create exactly the four records in this plan; do not create supporting summaries, migration notes, or duplicate design documents.
- Keep each ADR to **150–250 words** (excluding the title and References list). State the decision and its consequences; link to existing documentation for implementation detail rather than restating it.
- Modify only `docs/adr/README.md` plus those four new ADR files. Do not rewrite `README.md`, `CONTEXT.md`, `ARCHITECTURE.md`, the PRD, or existing plans to repeat ADR content.
- The ADR index is a numbered link list with one sentence on the purpose of the directory; it is not an architecture overview.

## Scope

**In scope:** `docs/adr/README.md`, `docs/adr/0001-local-first-and-cloud-consent.md`, `docs/adr/0002-backend-authoritative-timeline.md`, `docs/adr/0003-project-folder-persistence.md`, `docs/adr/0004-editable-export-and-edl-degradation.md`.

**Out of scope:** source code, product roadmap changes, new privacy promises, and an ADR for unresolved work.

## Steps

### Step 1: Establish the ADR format

- [ ] Update `docs/adr/README.md` to specify `Status`, `Context`, `Decision`, `Consequences`, and `References` headings; link the four records in numerical order.

**Verify:** `rg -n '000[1-4]-' docs/adr/README.md` returns four links.

### Step 2: Record local-first consent

- [ ] Create ADR 0001. Decision: the Manual Harness is the default; provider-backed harnesses require saved, per-project explicit consent before sampled frames or metadata can leave the machine.
- [ ] Cite `CONTEXT.md`, `README.md` Privacy model, and the `/cloud-ai-consent` API route as references. State that provider privacy policies remain the editor's responsibility.

### Step 3: Record Timeline authority

- [ ] Create ADR 0002. Decision: the backend owns the Timeline Document; GUI, external MCP agents, and the in-app review agent use the shared Operations core; the review agent proposes rather than mutates directly.
- [ ] State consequences: optimistic UI must reconcile from snapshots/SSE; every timeline edit is undoable; direct client-side mutation is prohibited.

### Step 4: Record folder persistence

- [ ] Create ADR 0003. Decision: folder projects use JSON and FFmpeg-derived metadata, not a database; local folders are portable when source layout is preserved.
- [ ] State the consequence that write failures must be surfaced or handled deliberately, not silently treated as durable saves.

### Step 5: Record export compatibility

- [ ] Create ADR 0004. Decision: exports are editable handoffs; FCPXML and Resolve XML preserve supported speed/transform values, while EDL deliberately flattens them and reports a warning.
- [ ] Cite `docs/ARCHITECTURE.md` and `docs/QA.md` validation expectations.

### Step 6: Verify terminology and links

- [ ] Use exact vocabulary from `UBIQUITOUS_LANGUAGE.md` (Timeline Document, Timeline Item, Candidate Clip, Editor, Manual Harness).
- [ ] Run `rg -n 'TBD|TODO|\[\]' docs/adr`; it must return no placeholder ADR content.
- [ ] Confirm each record is 150–250 words and links to the existing detailed document instead of reproducing its implementation explanation.
- [ ] Confirm every Markdown reference resolves locally and report the commit SHA to the controller; the controller updates `docs/plans/README.md` after merge so parallel plan branches do not conflict.

## Done criteria

- [ ] Four numbered ADRs exist and are linked by the index.
- [ ] Each ADR gives a decision and explicit consequences, not a restatement of architecture.
- [ ] No ADR exceeds 250 words and no existing product/architecture document is rewritten.
- [ ] No source files change.

## STOP conditions

- A proposed ADR contradicts a shipped behaviour or has no concrete reference.
- The decision is still genuinely open; record it as an open question elsewhere rather than inventing a decision.

## Maintenance notes

Create an ADR only for cross-cutting, durable choices. Feature implementation details belong in specs and plans.
