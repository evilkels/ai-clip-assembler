# Plans

Single home for written plans; completed plans move to [`done/`](done/). Numbered plans are improve handoffs; named plans are product docs.

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
| [016](016-edit-creation-clip-selection.md) | Fix edit creation: dupes, slivers, agent-influenced selection | Steps 1–2 DONE; step 3 superseded by 018; step 4 TODO |
| [017](017-review-page-clarity-and-polish.md) | Review-page clarity & polish | Step 1 DONE; item 5 DONE via studio redesign; items 1–4 TODO — item 2 (two smoothness controls) now worse, reconciled 2026-08-31 |
| [018](done/018-diverse-clip-generation.md) | Diverse clip generation | DONE (2026-07-21) — code complete; model bundling split out to plan 025 |
| [019](019-deepen-clip-generation-module.md) | Deepen clip generation behind one typed interface | TODO — architecture debt after `ad62ed1` |
| [020](done/020-authoritative-timeline-items.md) | Render and edit authoritative Timeline Items | DONE (2026-08-10) — first stacked branch |
| [021](done/021-truthful-export.md) | Export authoritative Timeline with complete warnings | DONE (2026-08-10) — second stacked branch |
| [022](done/022-project-shell-header-and-sidebar.md) | Project shell header and project list redesign | DONE (2026-08-12) at `c186ef4`, polished at `998f6d7` |
| [023](023-macos-app-icon-geometry.md) | Correct macOS app icon geometry | TODO |
| [024](done/024-source-audio-in-exports.md) | Source audio in exports | DONE (2026-08-13) — shipped in PR #65; real-footage/Resolve QA passed |
| [025](025-bundle-siglip-embedding-model.md) | Export and bundle the SigLIP embedding model | TODO — until it lands, plan 018's diversity is inert in real runs |
| [026](done/026-preview-audio-in-app.md) | Hear source audio in the app | DONE (2026-08-13) — shipped in PR #65; real-footage QA passed |
| [027](027-authoritative-candidate-library-and-diverse-edits.md) | Make All Clips authoritative and diversify chat Versions | TODO — independent quick correctness/clarity plan |
| [028](028-find-more-clips-from-source-video.md) | Find more Candidate Clips from one Source Video | TODO — depends on plan 019, then 027 terminology |

## Product plans

| Plan | Status |
|------|--------|
| [review-model-sign-in](done/review-model-sign-in.md) | DONE (2026-07-19) — automated checks green; live OAuth/package smoke remains human QA |
| [review-model-sign-in-followups](review-model-sign-in-followups.md) | IN PROGRESS — Tasks 0, 1, 4 done; plan/spec reconciliation remains |
| [going-public-codex-flow](going-public-codex-flow.md) | ACTIVE — trust → installability → presentability → arch debt → launch |
| [self-contained-runtime-tools](self-contained-runtime-tools.md) | IN PROGRESS — signing/notarization and clean-machine validation remain |
| [landing-page-polish-and-launch](landing-page-polish-and-launch.md) | ACTIVE — launch/distribution backlog only; the 2026-08-31 landing-drift debt is now owned by the restyle plan below |
| [landing-page-restyle](2026-09-01-landing-page-restyle.md) | TODO (2026-09-01) — rewritten against the Claude Design landing handoff (`docs/design/`): contact-sheet hero, dark default + light toggle, self-hosted Plex, WebP frames vendored; one maintainer-owned Review capture remains; intended to land inside PR #68 |
| [seo-plan](seo-plan.md) | IN PROGRESS — Search Console setup remains |
| [seo-content-pilot](seo-content-pilot.md) | GATED — pending query evidence and editorial input |
| [drone-workflow-qa-flows](drone-workflow-qa-flows.md) | Real-footage/perf/DaVinci QA remain |
| [project-folder-model](project-folder-model.md) | Automated QA complete; manual app QA pending |
| [project-sidebar](project-sidebar.md) | Partial; rename + row redesign shipped via plan 022; collapse/resize/context-menu/keyboard nav deferred |
| [settings-page](done/settings-page.md) | DONE (2026-07-03) |
| [connect-your-ai-mcp](done/connect-your-ai-mcp.md) | DONE (2026-07-02); live smoke remains human QA |
| [agent-operable-timeline](agent-operable-timeline.md) | A1–C DONE; preview/chat streaming/E2E await visual QA |
| [studio-workflow-redesign](2026-08-14-studio-workflow-redesign.md) | DONE (2026-08-14), reviewed + amended 2026-08-31, Copilot PR review resolved 2026-09-01 (3 valid, 1 rejected with evidence); open as PR #68; human Electron/NLE checks pending |
| [ui-polish-modern-shell](ui-polish-modern-shell.md) | SUPERSEDED for workflow routes by the studio redesign (2026-08-31); only Cmd-K palette, score verification, and Settings/Diagnostics remain |
| [react-doctor-triage](react-doctor-triage.md) | Partial; citations now doubly stale — the studio redesign rewrote 16 renderer components. Re-run the tool before using it |
| [real-footage-qa-improvements](done/2026-06-11-real-footage-qa-improvements.md) | DONE |
| [compare-versions-review-ui](done/2026-06-21-compare-versions-review-ui.md) | DONE |
