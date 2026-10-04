# Review visual editing — implementation plan

Status: prepared; not implemented. Baseline: main f15906d. Specification: [GitHub issue #84](https://github.com/evilkels/ai-clip-assembler/issues/84). Scope: native Review chat before Timeline/Export.

## 1. Make real Review orchestration testable
Introduce a narrow external model transport adapter behind existing Review orchestration. Keep actual prompt/evidence construction, response parsing and Version validation exercised by HTTP-level tests. Run blocking provider calls off the event loop. Consent is checked before transport dispatch, without callable identity comparison.
Acceptance: denied consent calls no transport; a slow fake does not block unrelated timeline/media requests; existing proposal, retry and undo behaviors remain intact.

## 2. Unify eligible context and visual evidence
Use one eligibility rule for turn, kickoff, refresh and context fingerprint membership. Build compact complete records including candidate ID, bounds, Look Group, source geometry and timestamped evidence. Generate labelled contact sheets across the library and bounded detail samples. Serialize full records within budgets, with explicit coverage and omissions. Compact history to relevant text and proposal summaries.
Acceptance: >4 candidate fixture has evidence from across the library; large context stays valid; exclusions survive New session; no immediately stale VersionSet caused by membership disagreement.

## 3. Preserve truthful conversation and proposals
Represent conversation-only, model proposal, provider failure and invalid proposal distinctly. Persist provenance. Keep previous suggestions and original fingerprints after discussion/failure. Local recipes only on explicit request. Enforce clip eligibility, selection ranges, repeats, speed permissions and requested duration; explain impossible requests. Reject invalid Versions atomically with readable diagnostics.
Acceptance: follow-up discussion cannot replace or relabel previous cuts; malformed, invalid and timeout outcomes are distinct; disallowed footage never reaches accepted recipes.

## 4. Connect creative direction to existing Review UI
Use current chat, comparison player and apply dialog. Surface short rationale, thematic progression, duration, evidence coverage and warnings. Support accepted-only and general eligible-library direction without a second timeline editor. Revalidate references/current eligibility at apply while preserving revision checks and atomic undo.
Acceptance: propose → preview → apply → Timeline → reopen stays consistent; manual edits make old suggestions stale; preview does not mutate the document.

## 5. Verify export artifacts and real footage
Through normal project endpoints, apply a known cut with trims, speed and transform; export; parse Resolve XML/FCPXML/EDL. Compare supported order, source ranges, effective duration and framing with frame-aware tolerance. Assert EDL loss warnings; track known FCPXML importer issues separately. Run opt-in real material evaluation, recording model/evidence coverage and constraint adherence.
Acceptance: deterministic exported-file tests pass; full UI flow checked in browser/Electron; later Computer-enabled session verifies actual import and visual equivalence in the Editing App. No automatic cloud footage use without project consent.

## Verification and handoff
Existing baseline only: 18 Review Agent, 12 Review HTTP, 29 Export Engine tests passed. No feature implementation or desktop acceptance completed. Work in a feature branch, preserve unrelated work, run targeted tests plus frontend typecheck/lint and applicable integration checks, then PR per AGENTS.md. Do not run old Resolve reconstruction scripts against the user's manually edited project.
