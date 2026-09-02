# Plans

Single home for written plans. Each row summarises; the plan file holds the
detail, evidence and citations.

| | Meaning |
|---|---|
| 🔴 | Not started |
| 🟡 | In progress or partly shipped |
| 🟢 | Closed — nothing left here |

Closed plans live in [`done/`](done/) and are marked **DONE** (implemented) or
**SUPERSEDED** (folded into another plan). A superseded file may still be the
authoritative spec for whatever absorbed it — `done/` means closed, not
necessarily built. Numbered plans are improve handoffs; named plans are product
docs.

## Active

17 plans. Statuses verified against the code on 2026-09-02, not taken from each
plan's own header.

| | Plan | What's left |
|---|---|---|
| 🔴 | [019](019-clip-library-generation-and-expansion.md) | One generation seam, then source expansion |
| 🔴 | [025](025-bundle-siglip-embedding-model.md) | Bundle SigLIP — diversity is inert until it lands |
| 🔴 | [027](027-authoritative-candidate-library-and-diverse-edits.md) | P1 correctness; re-derive frontend citations first |
| 🔴 | [023](023-macos-app-icon-geometry.md) | Re-cut the icon to Apple's 824/1024 grid |
| 🔴 | [shell-followups](shell-followups.md) | Cmd-K, Settings/Diagnostics styling, sidebar menu |
| 🔴 | [seo-content-pilot](seo-content-pilot.md) | Gated on query evidence and editorial input |
| 🔴 | [029](029-review-clip-posters-and-playback.md) | Poster-first cards, play-once previews, loop toggle |
| 🟡 | [react-doctor-triage](react-doctor-triage.md) | 2 defects left: keyboard trim, project-switch reset |
| 🟡 | [017](017-review-page-clarity-and-polish.md) | Collapse the two smoothness controls (posters moved to 029) |
| 🟡 | [agent-operable-timeline](agent-operable-timeline.md) | Preview, chat streaming and E2E await visual QA |
| 🟡 | [self-contained-runtime-tools](self-contained-runtime-tools.md) | Signing, notarization, clean-machine validation |
| 🟡 | [landing-page-polish-and-launch](landing-page-polish-and-launch.md) | Launch backlog + Search Console verification |
| 🟡 | [going-public-codex-flow](going-public-codex-flow.md) | Roadmap: trust, installability, launch |
| 🟡 | [drone-workflow-qa-flows](drone-workflow-qa-flows.md) | Real-footage, perf and DaVinci flows |
| 🟡 | [project-folder-model](project-folder-model.md) | Manual folder-portability QA |
| 🟡 | [review-model-sign-in-followups](review-model-sign-in-followups.md) | Architecture and security documentation |
| 🟢 | [project-sidebar](project-sidebar.md) | Nothing — archive candidate |

## Release QA — v0.2.0

🔴 Not started. Human-only; no automated test covers any of it.

| | Check |
|---|---|
| 🔴 | Packaged DMG on a clean Mac, past Gatekeeper, backend starts unaided |
| 🔴 | Import, Review and Timeline on real footage and real input hardware |
| 🔴 | Open Resolve XML, FCPXML and EDL in their real NLEs |
| 🔴 | Keyboard-only pass — note trim is a known dead end |

## Closed

38 plans.

| | Plan | Outcome |
|---|---|---|
| 🟢 | [001](done/001-real-footage-validation.md) | Done 2026-06-11 |
| 🟢 | [002](done/002-pi-harness-scaling-spike.md) | Done 2026-06-19 |
| 🟢 | [003](done/003-backend-packaging-spike.md) | Superseded by the self-contained DMG |
| 🟢 | [004](done/004-timeline-sequence-playback.md) | Done 2026-06-11 |
| 🟢 | [005](done/005-rich-candidate-pool.md) | Done 2026-06-21 |
| 🟢 | [006](done/006-persist-review-session.md) | Done 2026-06-21 |
| 🟢 | [007](done/007-creative-visual-review-agent.md) | Done 2026-06-21 |
| 🟢 | [008](done/008-chat-bubbles-and-interactions.md) | Done 2026-06-21 |
| 🟢 | [009](done/009-connected-review-pipeline.md) | Done 2026-06-28 · `f469e43` |
| 🟢 | [010](done/010-shared-frontend-backend-contract.md) | Done 2026-07-02 |
| 🟢 | [011](done/011-decompose-api-god-module.md) | Done 2026-07-02 · slice 2 = plan 014 |
| 🟢 | [012](done/012-adjustable-clip-generation.md) | Done 2026-06-28 |
| 🟢 | [013](done/013-reliable-browser-e2e-signals.md) | Done 2026-07-21 · `9a6d56a` |
| 🟢 | [014](done/014-extract-timeline-lifecycle-service.md) | Done 2026-07-09 · `1c88a22` |
| 🟢 | [015](done/015-record-core-architecture-decisions.md) | Done 2026-07-09 · `93b0d37` |
| 🟢 | [016](done/016-edit-creation-clip-selection.md) | Closed 2026-09-02 · step 4 → 027 |
| 🟢 | [018](done/018-diverse-clip-generation.md) | Done 2026-07-21 · bundling → 025 |
| 🟢 | [020](done/020-authoritative-timeline-items.md) | Done 2026-08-10 |
| 🟢 | [021](done/021-truthful-export.md) | Done 2026-08-10 |
| 🟢 | [022](done/022-project-shell-header-and-sidebar.md) | Done 2026-08-12 · `c186ef4` |
| 🟢 | [024](done/024-source-audio-in-exports.md) | Done 2026-08-13 · PR #65 |
| 🟢 | [024 notes](done/024-implementation-notes.md) | Implementation notes for 024 |
| 🟢 | [026](done/026-preview-audio-in-app.md) | Done 2026-08-13 · PR #65 |
| 🟢 | [028](done/028-find-more-clips-from-source-video.md) | Superseded 2026-09-02 → 019 Phase 2 · **not built** |
| 🟢 | [backend-timeline-workflow](done/2026-05-12-backend-timeline-workflow.md) | Done |
| 🟢 | [review-timeline-video-preview](done/2026-06-10-review-timeline-video-preview-playwright.md) | Done |
| 🟢 | [real-footage-qa-improvements](done/2026-06-11-real-footage-qa-improvements.md) | Done |
| 🟢 | [clip-quality-and-review-ux](done/2026-06-15-clip-quality-and-review-ux.md) | Done |
| 🟢 | [compare-versions-review-ui](done/2026-06-21-compare-versions-review-ui.md) | Done |
| 🟢 | [studio-workflow-redesign](done/2026-08-14-studio-workflow-redesign.md) | Done 2026-09-02 · `6d79c1b` · v0.2.0 |
| 🟢 | [landing-page-restyle](done/2026-09-01-landing-page-restyle.md) | Done 2026-09-02 · v0.2.0 |
| 🟢 | [literal-design-conformance](done/2026-09-01-literal-design-conformance.md) | Done 2026-09-02 |
| 🟢 | [agent-operable-timeline-handoff](done/agent-operable-timeline-handoff.md) | Executed 2026-06-19 |
| 🟢 | [connect-your-ai-mcp](done/connect-your-ai-mcp.md) | Done 2026-07-02 · live smoke is human QA |
| 🟢 | [review-model-sign-in](done/review-model-sign-in.md) | Done 2026-07-19 · follow-ups still active |
| 🟢 | [seo-plan](done/seo-plan.md) | Closed 2026-09-02 · Search Console → landing plan |
| 🟢 | [settings-page](done/settings-page.md) | Done 2026-07-03 |
| 🟢 | [ui-polish-modern-shell](done/ui-polish-modern-shell.md) | Superseded 2026-09-02 → shell-followups |
