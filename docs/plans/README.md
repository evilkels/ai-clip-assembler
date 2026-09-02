# Plans

Single home for written plans. Closed plans move to [`done/`](done/), each marked either **DONE** (implemented) or **SUPERSEDED** (folded into another plan); a superseded file may still hold the authoritative detail for the plan that absorbed it. Numbered plans are improve handoffs; named plans are product docs.

## Advisor queue

| Plan | Title | Status |
|------|-------|--------|
| [001](done/001-real-footage-validation.md) | Analysis timing + real-footage validation runbook | DONE (2026-06-11) |
| [002](done/002-pi-harness-scaling-spike.md) | Pi harness scaling spike | DONE (2026-06-19) — bounded concurrency + retry-once + partial-results recommended |
| [003](done/003-backend-packaging-spike.md) | Backend packaging spike | DONE (2026-06-28) — superseded by shipped self-contained DMG (PRs #31–33) |
| [004](done/004-timeline-sequence-playback.md) | Timeline sequence playback | DONE (2026-06-11) |
| [005](done/005-rich-candidate-pool.md) | Rich Candidate Clip discovery vs draft selection | DONE (2026-06-21) |
| [006](done/006-persist-review-session.md) | Persist project-scoped review sessions | DONE (2026-06-21) |
| [007](done/007-creative-visual-review-agent.md) | Visual creative curator review agent | DONE (2026-06-21) |
| [008](done/008-chat-bubbles-and-interactions.md) | Accessible review chat presentation | DONE (2026-06-21) |
| [009](done/009-connected-review-pipeline.md) | Connect chat, Versions, Source Clips, Timeline | DONE (2026-06-28) at `f469e43` |
| [010](done/010-shared-frontend-backend-contract.md) | Generated FE types from BE models | DONE (2026-07-02; re-verified 2026-07-21) |
| [011](done/011-decompose-api-god-module.md) | Decompose `api.py` god-module, slice 1 | DONE (2026-07-02); slice 2 = plan 014 |
| [012](done/012-adjustable-clip-generation.md) | Persist frame scores → live re-derive | DONE (2026-06-28; re-verified 2026-07-21) |
| [013](done/013-reliable-browser-e2e-signals.md) | Deterministic browser E2E signals | DONE (2026-07-21) at `9a6d56a` |
| [014](done/014-extract-timeline-lifecycle-service.md) | Extract Timeline lifecycle service | DONE (2026-07-09) at `1c88a22` |
| [015](done/015-record-core-architecture-decisions.md) | Record core architecture decisions as ADRs | DONE (2026-07-09) at `93b0d37` |
| [016](done/016-edit-creation-clip-selection.md) | Fix edit creation: dupes, slivers, agent-influenced selection | CLOSED (2026-09-02) — steps 1–2 shipped, step 3 superseded by 018, step 4 moved to 027 |
| [017](017-review-page-clarity-and-polish.md) | Review-page presentation polish | TODO — poster-first cards (`ClipCard.tsx:138-160`) and one smoothness model (`Review.tsx:137-155` + `SourceClipsPanel.tsx:250-260`). Items 3–4 moved to 027; item 5 shipped in the redesign |
| [018](done/018-diverse-clip-generation.md) | Diverse clip generation | DONE (2026-07-21) — code complete; model bundling split out to plan 025 |
| [019](019-clip-library-generation-and-expansion.md) | Clip-library generation and expansion | TODO — Phase 1 one generation seam (`clip_generation.py` absent); Phase 2 absorbed plan 028 |
| [020](done/020-authoritative-timeline-items.md) | Render and edit authoritative Timeline Items | DONE (2026-08-10) — first stacked branch |
| [021](done/021-truthful-export.md) | Export authoritative Timeline with complete warnings | DONE (2026-08-10) — second stacked branch |
| [022](done/022-project-shell-header-and-sidebar.md) | Project shell header and project list redesign | DONE (2026-08-12) at `c186ef4`, polished at `998f6d7` |
| [023](023-macos-app-icon-geometry.md) | Correct macOS app icon geometry | TODO |
| [024](done/024-source-audio-in-exports.md) | Source audio in exports | DONE (2026-08-13) — shipped in PR #65; real-footage/Resolve QA passed |
| [025](025-bundle-siglip-embedding-model.md) | Export and bundle the SigLIP embedding model | TODO — until it lands, plan 018's diversity is inert in real runs |
| [026](done/026-preview-audio-in-app.md) | Hear source audio in the app | DONE (2026-08-13) — shipped in PR #65; real-footage QA passed |
| [027](027-authoritative-candidate-library-and-diverse-edits.md) | Authoritative candidate library and diverse Versions | TODO — P1 correctness; absorbed 016 step 4 and 017 items 3–4. Frontend citations predate the redesign; re-derive before executing |
| [028](done/028-find-more-clips-from-source-video.md) | Find more Candidate Clips from one Source Video | SUPERSEDED (2026-09-02) — now Phase 2 of 019; that file remains the authoritative step-level spec, and none of it is implemented |

## Release QA (human-only, not covered by CI)

Implementation-complete is not release-complete. These checks need a person and
real hardware, and are outstanding for v0.2.0:

- Install and launch the packaged DMG on a clean Mac, past Gatekeeper (builds
  are unsigned), with the bundled backend starting unaided.
- Import, Review and Timeline against real footage and real input hardware.
- Open Resolve XML, FCPXML and EDL in their target NLEs and verify relinking,
  order, timing, speed, transform, receipts and overwrite behaviour. No
  automated test covers this.
- A keyboard-only pass over every route. Note that Timeline trim is currently a
  keyboard dead end — see [react-doctor-triage](react-doctor-triage.md).

## Product plans

| Plan | Status |
|------|--------|
| [review-model-sign-in](done/review-model-sign-in.md) | DONE (2026-07-19) — automated checks green; live OAuth/package smoke remains human QA |
| [review-model-sign-in-followups](review-model-sign-in-followups.md) | IN PROGRESS — Tasks 0, 1, 4 done; plan/spec reconciliation remains |
| [going-public-codex-flow](going-public-codex-flow.md) | ACTIVE — trust → installability → presentability → arch debt → launch |
| [self-contained-runtime-tools](self-contained-runtime-tools.md) | IN PROGRESS — signing/notarization and clean-machine validation remain |
| [landing-page-polish-and-launch](landing-page-polish-and-launch.md) | ACTIVE — launch/distribution backlog, plus the maintainer-owned Search Console verification absorbed from seo-plan |
| [landing-page-restyle](done/2026-09-01-landing-page-restyle.md) | DONE (2026-09-02) — shipped with the redesign in `6d79c1b`, released as v0.2.0 |
| [seo-plan](done/seo-plan.md) | CLOSED (2026-09-02) — technical SEO shipped and test-enforced; Search Console verification moved to landing-page-polish-and-launch |
| [seo-content-pilot](seo-content-pilot.md) | GATED — pending query evidence and editorial input |
| [drone-workflow-qa-flows](drone-workflow-qa-flows.md) | Real-footage/perf/DaVinci QA remain |
| [project-folder-model](project-folder-model.md) | Automated QA complete; manual app QA pending |
| [project-sidebar](project-sidebar.md) | Effectively DONE — rename/rows via plan 022, collapse + persisted resize via the redesign; context-menu and keyboard nav moved to shell-followups |
| [settings-page](done/settings-page.md) | DONE (2026-07-03) |
| [connect-your-ai-mcp](done/connect-your-ai-mcp.md) | DONE (2026-07-02); live smoke remains human QA |
| [agent-operable-timeline](agent-operable-timeline.md) | A1–C DONE; preview/chat streaming/E2E await visual QA |
| [studio-workflow-redesign](done/2026-08-14-studio-workflow-redesign.md) | DONE (2026-09-02) — merged as `6d79c1b`, released as v0.2.0; human packaged-app/real-NLE QA still outstanding (see Release QA below) |
| [ui-polish-modern-shell](done/ui-polish-modern-shell.md) | SUPERSEDED (2026-09-02) — the shadcn/Radix migration will not happen; residuals moved to shell-followups |
| [shell-followups](shell-followups.md) | TODO — P3; Cmd-K, score verification, Settings/Diagnostics styling, sidebar context menu, keyboard pass |
| [react-doctor-triage](react-doctor-triage.md) | Partial; re-triaged 2026-09-02 against v0.2.0 — 94 findings, most are false positives; 3 confirmed defects listed in the plan |
| [real-footage-qa-improvements](done/2026-06-11-real-footage-qa-improvements.md) | DONE |
| [compare-versions-review-ui](done/2026-06-21-compare-versions-review-ui.md) | DONE |
