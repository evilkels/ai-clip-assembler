# Plans

Single home for all written plans (completed ones move to [`done/`](done/)).
Numbered plans (001-…) are self-contained executor handoffs from the improve
skill's audits; named plans are feature/product docs, `Status:` mirrored below.

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
| [016](016-edit-creation-clip-selection.md) | Fix edit creation: dupes, slivers, agent-influenced selection | Steps 1–2 DONE (`edd4f16`); step 3 superseded by 018; step 4 TODO |
| [017](017-review-page-clarity-and-polish.md) | Review-page clarity & polish | Step 1 DONE (2026-07-20); steps 2–6 TODO |
| [018](018-diverse-clip-generation.md) | Diverse clip generation (per-moment fragments, look-groups, multi-format) | CODE COMPLETE (2026-07-21) — remaining, not code: export and bundle `backend/models/siglip_image_encoder.onnx`; without it every clip is its own look group and diversity is inert |

## Product plans

| Plan | Status |
|------|--------|
| [going-public-codex-flow](going-public-codex-flow.md) | ACTIVE — ordered roadmap (trust → installability → presentability → arch debt → launch) |
| [self-contained-runtime-tools](self-contained-runtime-tools.md) | IN PROGRESS — ffmpeg/ffprobe bundled; signing/notarization and clean-machine validation remain |
| [landing-page-polish-and-launch](landing-page-polish-and-launch.md) | ACTIVE — coding-agent work separated from maintainer-owned demo/SEO/distribution tasks |
| [seo-plan](seo-plan.md) | IN PROGRESS — technical SEO + tests + CI on `seo`; Search Console setup remains |
| [seo-content-pilot](seo-content-pilot.md) | GATED — one workflow guide pending query evidence and editorial input |
| [drone-workflow-qa-flows](drone-workflow-qa-flows.md) | Acceptance bar (Flows A–E); real-footage/perf/DaVinci QA remain |
| [project-folder-model](project-folder-model.md) | Implementation + automated QA complete; manual app QA pending |
| [project-sidebar](project-sidebar.md) | Partial; auto-reopen shipped; collapse/resize/context-menu/keyboard nav deferred |
| [settings-page](done/settings-page.md) | DONE (2026-07-03) — Settings & Diagnostics modal + theme switching |
| [connect-your-ai-mcp](done/connect-your-ai-mcp.md) | DONE (2026-07-02) — MCP bridge + Settings panel; live desktop smoke is a human step |
| [agent-operable-timeline](agent-operable-timeline.md) | A1–C DONE; realtime preview + chat streaming + Playwright e2e pending visual QA |
| [ui-polish-modern-shell](ui-polish-modern-shell.md) | Partial; component migration and command palette remain |
| [react-doctor-triage](react-doctor-triage.md) | Partial; mechanical pass cut issues 47→33; refactor/judgment items remain |
| [real-footage-qa-improvements](done/2026-06-11-real-footage-qa-improvements.md) | DONE (2026-06-11) |
| [compare-versions-review-ui](done/2026-06-21-compare-versions-review-ui.md) | DONE (2026-06-21) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (rationale)
