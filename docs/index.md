---
okf_version: "0.2"
---

# Documentation

Start with the [product requirements](PRD.md), [roadmap](ROADMAP.md), or [user guide](USER_GUIDE.md).
Domain terms are defined in the repository [glossary](../GLOSSARY.md).

Every Markdown page here follows the OKF v0.2 repo docs profile.
`status` describes the page; `plan_status` and `decision_status` describe the work or decision.
Existing folders are retained, and HTML artefacts are listed separately below.

## Product

- [Product Requirement Document: AI Clip Assembler](PRD.md) — Defines the product goals, target users, editing workflow, and requirements for a local-first video editor.
- [Roadmap to v1.0.0](ROADMAP.md) — Orders the milestones, product rules, and owner actions needed to reach a stable macOS v1.0.0 release.
- [User Guide](USER_GUIDE.md) — Guides Editors from opening footage through reviewing Candidate Clips, editing the Timeline, and exporting a cut.

## Engineering

- [Architecture](ARCHITECTURE.md) — Explains the Electron and FastAPI architecture, local analysis pipeline, Timeline authority, persistence, and agent integration.
- [Developer Setup](DEVELOPER_SETUP.md) — Explains how to prepare local dependencies, run the desktop app and backend, and verify changes on macOS.
- [AI Harness Interface Specification](HARNESS_SPEC.md) — Documents the AI harness input, output, and fallback contracts, with the legacy provider model superseded by ADR 0008.
- [MCP Server — controlling the timeline with an external agent](MCP_SERVER.md) — Documents how external agents connect to the local MCP server and edit the shared Timeline through reversible Operations.
- [QA Plan](QA.md) — Records feature acceptance checks and known issues across analysis, review, Timeline editing, agents, and exports.
- [Manual QA Launch Guide](MANUAL_QA_GUIDE.md) — Walks through manual macOS checks for import, analysis, review, Timeline editing, export, and agent workflows.
- [Real-Footage Validation Runbook](VALIDATION_RUNBOOK.md) — Defines measured real-footage checks for analysis time, clip recall, and export relinking.
- [Troubleshooting & FAQ](TROUBLESHOOTING.md) — Explains common local setup, analysis, AI, playback, and export failures and their remedies.
- [Updating and removing the app](UPDATING.md) — Explains update notifications, the install and removal wizard, and the release process.

## Plans

The [plan tracker](plans/README.md) derives detailed progress and next actions from checkboxes.
Plans awaiting human checks remain active; `done` means closed, including work superseded by another plan.

### Active

- [019: Find more clips](plans/019-clip-library-generation-and-expansion.md) — `plan_status: active` — Plans More clips and Longer clips actions that append cached Candidate Clips without changing the Timeline or existing decisions.
- [Plan 029: Poster-first Candidate Clip cards and play-once previews](plans/029-review-clip-posters-and-playback.md) — `plan_status: active` — Plans static Candidate Clip posters and controlled play-once previews to reduce Review loading and media work.
- [Plan 031: App restyle conformance — the sections the build has not caught up to](plans/031-app-restyle-conformance.md) — `plan_status: active` — Tracks the remaining differences between the desktop app and the approved restyle across all workflow screens.
- [032: Exports that open in Final Cut Pro and DaVinci Resolve](plans/032-valid-fcpxml-and-nle-verification.md) — `plan_status: active` — Plans valid FCPXML and Resolve XML exports with automated fixtures and real editing-app import checks.
- [Plan 033: Updates that install themselves, on an app macOS already trusts](plans/033-in-app-updates-and-a-trusted-build.md) — `plan_status: active` — Plans signed, trusted macOS releases with automatic in-app updates and recovery behavior.
- [035: Deterministic plan lifecycle](plans/035-deterministic-plan-lifecycle.md) — `plan_status: active` — Plans checkbox-derived plan status, generated index rows, and automatic archival of closed plans.
- [036: Proper tests and checks](plans/036-proper-tests-and-checks.md) — `plan_status: active` — Aligns local, commit-hook, and CI checks while correcting tests that fail to prove their stated behavior.
- [037: Extraction quality](plans/037-extraction-quality.md) — `plan_status: active` — Improves deterministic Candidate Clip coverage and length so Short, Medium, and Long drafts use the available footage.
- [038: AI Connection — honest AI errors, then Claude or ChatGPT through the Editor's own program](plans/038-ai-connection.md) — `plan_status: active` — Phases 1–2 are implemented: typed AI failures and restricted payloads; connections through the Editor's own Claude Code or Codex program remain planned.
- [039: Story in the edit](plans/039-story.md) — `plan_status: active` — Adds Markers and Story Sections that survive undo and carry story context into exported editing timelines.
- [040: Release QA](plans/040-release-qa.md) — `plan_status: active` — Collects human checks for Review scripting and keyboard access on each packaged release.
- [042: iPhone footage end to end](plans/042-iphone-footage.md) — `plan_status: active` — Tracks iPhone frame rates, capture order, orientation, vertical previews, and exports through the complete editing workflow.
- [043: Remote View prototype refresh stability](plans/043-remote-prototype-refresh.md) — `plan_status: active` — Stabilizes Remote View polling so unchanged project responses preserve existing clip cards and thumbnails.
- [QA flows for the drone clip extraction workflow](plans/drone-workflow-qa-flows.md) — `plan_status: active` — Defines end-to-end drone-footage QA flows and the evidence needed to accept import, analysis, editing, and export.
- [Landing page polish and launch backlog](plans/landing-page-polish-and-launch.md) — `plan_status: active` — Plans product proof, a release-matched download, and a measured launch loop for the public landing page.
- [Review visual editing: the AI edits like a Resolve console](plans/review-visual-editing.md) — `plan_status: active` — Plans an AI editing loop that inspects the clip library, runs and repairs Scripts, and returns one previewable Proposal.
- [Self-contained macOS runtime tools](plans/self-contained-runtime-tools.md) — `plan_status: active` — Packages verified FFmpeg and ffprobe tools with the backend so the macOS app works without developer dependencies.

### Done

- [Plan 001: Instrument analysis timing and produce the real-footage validation runbook](plans/done/001-real-footage-validation.md) — `plan_status: done` — Records analysis timing instrumentation and the measured real-footage validation runbook.
- [Plan 002: Design spike — make pi harness scoring survive a realistic session](plans/done/002-pi-harness-scaling-spike.md) — `plan_status: done` — Records the design spike and benchmarks for making Pi scoring reliable across realistic sessions.
- [Plan 003: Spike — bundle the FastAPI backend into the packaged Electron app](plans/done/003-backend-packaging-spike.md) — `plan_status: done` — Preserves the backend packaging spike that was superseded by production DMG packaging.
- [Plan 004: Make Timeline play the assembled sequence, video-driven and stutter-free](plans/done/004-timeline-sequence-playback.md) — `plan_status: done` — Records video-driven assembled-sequence playback and explicit seeking without competing playback clocks.
- [Plan 005: Separate rich Candidate Clip discovery from draft selection](plans/done/005-rich-candidate-pool.md) — `plan_status: done` — Separates Candidate Clip discovery from draft selection so review agents retain a richer scene-aware library.
- [Plan 006: Persist project-scoped review conversations and Proposals](plans/done/006-persist-review-session.md) — `plan_status: done` — Persists Project review conversations and Proposals across navigation and restarts.
- [Plan 007: Make the In-App Review Agent a visual creative curator](plans/done/007-creative-visual-review-agent.md) — `plan_status: done` — Adds bounded Frame Samples and conversation context so the Review Agent can curate visually distinct cuts.
- [Plan 008: Present review chat as an accessible conversation](plans/done/008-chat-bubbles-and-interactions.md) — `plan_status: done` — Presents Review chat as an accessible conversation using distinct message bubbles and interaction states.
- [Connected Review Pipeline Implementation Plan](plans/done/009-connected-review-pipeline.md) — `plan_status: done` — Connects agent chat, Version previews, Source Clips, and the Working Timeline with durable provenance and safe application.
- [Plan 010: Generate frontend domain types from the backend, killing hand-maintained contract drift](plans/done/010-shared-frontend-backend-contract.md) — `plan_status: done` — Generates frontend domain types from backend models and checks that the shared contract stays current.
- [Plan 011: Decompose api.py — extract the analysis pipeline into a service layer (slice 1)](plans/done/011-decompose-api-god-module.md) — `plan_status: done` — Extracts the analysis pipeline from the API module into a service without changing its behavior.
- [Plan 012: Transparent, adjustable clip generation (live re-derive)](plans/done/012-adjustable-clip-generation.md) — `plan_status: done` — Persists frame scores and supports transparent clip regeneration from cached analysis with adjustable controls.
- [Plan 013: Make browser E2E signals deterministic and meaningful](plans/done/013-reliable-browser-e2e-signals.md) — `plan_status: done` — Makes browser regression tests deterministic so failures identify visible product regressions.
- [Plan 014: Extract Timeline lifecycle coordination from the API module](plans/done/014-extract-timeline-lifecycle-service.md) — `plan_status: done` — Moves Timeline reconstruction, controller caching, durable writes, and event publication into a lifecycle service.
- [Plan 015: Record the core architecture decisions as ADRs](plans/done/015-record-core-architecture-decisions.md) — `plan_status: done` — Records the settled local-first, Timeline authority, Project persistence, and export constraints as architecture decisions.
- [Plan 016: Fix edit creation — no duplicate clips, no unusable slivers, agent-influenced selection](plans/done/016-edit-creation-clip-selection.md) — `plan_status: done` — Records duplicate and sliver prevention in draft selection and hands remaining selection work to later plans.
- [Plan 017: Review-page clarity and polish](plans/done/017-review-page-clarity-and-polish.md) — `plan_status: done` — Records Review clarity and smoothness improvements while assigning poster and broader library work to other plans.
- [Diverse Clip Generation — Implementation Plan (Plan 018)](plans/done/018-diverse-clip-generation.md) — `plan_status: done` — Builds a diverse Candidate Clip library and diversity-aware draft selection with generation controls on Import.
- [Authoritative Timeline Items Implementation Plan](plans/done/020-authoritative-timeline-items.md) — `plan_status: done` — Makes Timeline rendering, playback, and editing preserve every authoritative item, including repeated source placements.
- [Truthful Export Implementation Plan](plans/done/021-truthful-export.md) — `plan_status: done` — Exports the authoritative Timeline directly and displays complete export results and degradation warnings.
- [Project Shell Header and Project List Redesign](plans/done/022-project-shell-header-and-sidebar.md) — `plan_status: done` — Consolidates Project identity, recent Projects, and shell navigation in the shared header and sidebar.
- [Plan 024 implementation notes](plans/done/024-implementation-notes.md) — `plan_status: done` — Records source-audio export details, per-track Resolve link indexing, and limitations of the first-audio-stream contract.
- [Plan 024: Source audio in exports](plans/done/024-source-audio-in-exports.md) — `plan_status: done` — Carries source audio into FCPXML, Resolve XML, and EDL exports with appropriate links and format warnings.
- [Plan 026: Hear source audio in the app](plans/done/026-preview-audio-in-app.md) — `plan_status: done` — Enables source audio during app previews while handling silent sources and playback state.
- [Find More Clips From A Source Video Implementation Plan](plans/done/028-find-more-clips-from-source-video.md) — `plan_status: done` — Preserves the unbuilt Find More Clips plan superseded by plan 019's cached-analysis expansion workflow.
- [Plan 030: Truthful AI usage — selected vs effective harness, and an independent Review Agent](plans/done/030-truthful-ai-usage.md) — `plan_status: done` — Records selected and effective AI harness reporting and hands the remaining consent work to plan 038.
- [034 — Review chat timeline scripting (Lua)](plans/done/034-review-chat-timeline-scripting.md) — `plan_status: done` — Implements sandboxed Lua Review Scripts that produce previewable, reversible Timeline Proposals.
- [Backend Timeline Workflow Implementation Plan](plans/done/2026-05-12-backend-timeline-workflow.md) — `plan_status: done` — Implements backend Timeline replacement and export behavior for the editable drone-footage workflow.
- [Review Timeline Video Preview Playwright Implementation Plan](plans/done/2026-06-10-review-timeline-video-preview-playwright.md) — `plan_status: done` — Adds backend-backed Review and Timeline video previews and a browser-accessible QA route.
- [Real-footage QA improvements](plans/done/2026-06-11-real-footage-qa-improvements.md) — `plan_status: done` — Turns real-footage QA findings into persistent editing behavior while identifying work that needs additional evidence.
- [Clip Quality, Composition & Review UX Improvements](plans/done/2026-06-15-clip-quality-and-review-ux.md) — `plan_status: done` — Improves scene-aware clip selection, composition, smoothness scoring, and Review feedback from real-footage findings.
- [Compare-Versions Review UI — Implementation Plan](plans/done/2026-06-21-compare-versions-review-ui.md) — `plan_status: done` — Rebuilds Review around side-by-side playable Version proposals that the Editor can compare and adopt.
- [Studio Workflow Redesign Implementation Plan](plans/done/2026-08-14-studio-workflow-redesign.md) — `plan_status: done` — Applies the approved studio design to the desktop shell and core workflows while preserving product behavior.
- [Landing Page Restyle Implementation Plan](plans/done/2026-09-01-landing-page-restyle.md) — `plan_status: done` — Implements the approved dark and light landing-page design with real scored footage and a download-focused layout.
- [Literal Design Conformance Implementation Plan](plans/done/2026-09-01-literal-design-conformance.md) — `plan_status: done` — Completes literal app and landing-page conformance to approved designs while retaining existing behavior.
- [Executor handoff: Agent-Operable Timeline](plans/done/agent-operable-timeline-handoff.md) — `plan_status: done` — Records the delivered shared Timeline Document, Operations core, MCP interface, and propose-mode Review Agent.
- [Agent-Operable Timeline](plans/done/agent-operable-timeline.md) — `plan_status: done` — Preserves the original agent-operable Timeline plan and hands remaining preview and apply work to the visual-editing plan.
- [Connect Your AI MCP Implementation Plan](plans/done/connect-your-ai-mcp.md) — `plan_status: done` — Connects Claude Desktop or Codex to the local MCP tools for inspecting Candidate Clips and editing the live Timeline.
- [Going-public roadmap — Codex CLI flow](plans/done/going-public-codex-flow.md) — `plan_status: done` — Preserves the public-launch roadmap superseded by the v1.0.0 roadmap and its AI, trust, and packaging plans.
- [Plan: Project = Folder On Disk](plans/done/project-folder-model.md) — `plan_status: done` — Establishes Projects as on-disk folders with persistent state and media kept in place.
- [Plan: Project Sidebar](plans/done/project-sidebar.md) — `plan_status: done` — Preserves the sidebar's data source and interaction decisions after remaining shell work moved to follow-up plans.
- [React Doctor Triage](plans/done/react-doctor-triage.md) — `plan_status: done` — Resolves confirmed React Doctor defects and Project-switch races while preserving unresolved architecture decisions.
- [Review Model Sign-In — Review Follow-ups](plans/done/review-model-sign-in-followups.md) — `plan_status: done` — Records sign-in cleanup, OAuth validation, Pi resolution, callback handling, and reconciliation with the shipped tests.
- [Review Model Sign-In](plans/done/review-model-sign-in.md) — `plan_status: done` — Adds Settings-based authentication for the internal Pi Review model using an OpenAI ChatGPT subscription.
- [Technical SEO Foundation Implementation Plan](plans/done/seo-plan.md) — `plan_status: done` — Establishes accurate landing-page claims and technical search and sharing foundations before broader content work.
- [Plan: Settings Page](plans/done/settings-page.md) — `plan_status: done` — Introduces a Settings surface for global preferences and per-Project overrides.
- [Plan: Modern professional UI shell](plans/done/ui-polish-modern-shell.md) — `plan_status: done` — Preserves the earlier shell-polish proposal superseded by the studio redesign and shell follow-ups.

### Later

- [Plan 023: Correct macOS app icon geometry](plans/later/023-macos-app-icon-geometry.md) — `plan_status: proposed` — Plans a macOS icon geometry correction after v1.0.0.
- [025: Export and bundle the SigLIP embedding model](plans/later/025-bundle-siglip-embedding-model.md) — `plan_status: proposed` — Plans exporting and bundling the SigLIP embedding model for local visual diversity scoring.
- [Authoritative Candidate Library And Diverse Suggested Edits Implementation Plan](plans/later/027-authoritative-candidate-library-and-diverse-edits.md) — `plan_status: proposed` — Plans a clearly authoritative Candidate Clip library and more diverse Suggested Edits beyond the shipped quota fix.
- [SEO content pilot — video culling workflow](plans/later/seo-content-pilot.md) — `plan_status: proposed` — Plans one evidence-backed video-culling guide and measures its performance before expanding search content.
- [Shell Follow-ups](plans/later/shell-followups.md) — `plan_status: proposed` — Collects deferred shell interactions and score-chip verification after the studio redesign.

## Specs

- [Backend Timeline Workflow Design](specs/2026-05-12-backend-timeline-workflow-design.md) — Specifies backend support for Project creation, video analysis, editable Timeline replacement, and faithful export.
- [Playwriter Electron Frontend Design](specs/2026-06-10-playwriter-electron-frontend-design.md) — Specifies browser-accessible Electron renderer QA and playable Review and Timeline previews.
- [Agent-Operable Timeline Design](specs/2026-06-19-agent-operable-timeline-design.md) — Specifies one backend-authoritative Timeline Document and Operations core for GUI and agent editing.
- [Pi Harness Scaling — Design Spike](specs/2026-06-19-pi-harness-scaling-design.md) — Evaluates Pi scoring throughput and failure handling using measured benchmarks and design alternatives.
- [Compare-Versions Review UI Design](specs/2026-06-21-compare-versions-review-ui-design.md) — Specifies the first compare-Versions Review interface with playable candidate cuts and an adoption workflow.
- [Connected Review Pipeline Design](specs/2026-06-21-connected-review-pipeline-design.md) — Specifies shared state and interaction rules for Review chat, Version previews, Source Clips, and the Working Timeline.
- [Design: Bring Your Own Subscription via MCP](specs/2026-06-28-byo-subscription-mcp-connect-design.md) — Specifies local MCP connections that let Editors review and edit through their own desktop AI subscriptions.
- [Landing Page Editorial Refresh](specs/2026-07-10-landing-page-editorial-refresh.md) — Specifies the landing page's editorial visual direction, product explanation, and download emphasis.
- [Self-Contained macOS Runtime Tools](specs/2026-07-10-self-contained-runtime-tools.md) — Specifies a self-contained macOS installation with a packaged backend and local analysis tools.
- [Authoritative Timeline and Truthful Export Design](specs/2026-08-10-authoritative-timeline-and-export-design.md) — Specifies lossless Timeline item projection and export without legacy mutations or collapsed repeated placements.
- [Literal Design Conformance](specs/2026-09-01-literal-design-conformance.md) — Defines approved design exports as the visual authority while preserving existing behavior and backend contracts.
- [Research: a sandboxed Lua runtime for Review-chat timeline scripting](specs/2026-09-29-lua-scripting-runtime-research.md) — Evaluates a sandboxed Lua runtime that records Timeline Operations without exposing host capabilities.

## Reviews

- [Repository audit — 2026-10-22](reviews/2026-10-22-repo-audit.md) — Records repository correctness, test, documentation, and release risks with recommended fixes.

- [Real-Footage QA Review — 2026-06-11](reviews/2026-06-11-real-footage-qa-review.md) — Records real-footage QA observations about analysis feedback, clip quality, and the editing workflow.
- [PR #62 Pocock Review](reviews/2026-08-12-pr62-pocock-review.md) — Reviews PR 62 for repository standards and conformance to the authoritative Timeline and export design.
- [SDD ledger — plan: docs/plans/2026-08-14-studio-workflow-redesign.md](reviews/2026-08-14-studio-workflow-redesign-sdd/progress.md) — Records studio-redesign task completion, review outcomes, verification evidence, and deferred follow-ups.
- [Task 3 implementer report](reviews/2026-08-14-studio-workflow-redesign-sdd/task-3-implementer-report.md) — Records the Candidate Clip browser redesign, view modes, filtering, and regression-test evidence.
- [Task 4 implementer report](reviews/2026-08-14-studio-workflow-redesign-sdd/task-4-implementer-report.md) — Records the three-zone Review redesign, Version controls, stale-state handling, and verification results.
- [Task 5 implementer report](reviews/2026-08-14-studio-workflow-redesign-sdd/task-5-implementer-report.md) — Records authoritative Timeline projection, the selected-item inspector, playback fixes, and regression evidence.
- [Task 6 implementer report](reviews/2026-08-14-studio-workflow-redesign-sdd/task-6-implementer-report.md) — Records Export format cards, handoff summaries, success receipts, guarded file reveal, and verification results.
- [Task 7 implementer report](reviews/2026-08-14-studio-workflow-redesign-sdd/task-7-implementer-report.md) — Records integrated studio-workflow acceptance results and the packaged-app and editing-app checks still requiring a human.
- [Literal design conformance review](reviews/2026-09-01-literal-design-conformance.md) — Records app and landing-page comparison against approved designs and distinguishes automated acceptance from human checks.
- [Design audit: Review (`1b`), Timeline (`3a`), Export (`3b`) against the restyle reference](reviews/2026-09-03-review-timeline-export-design-audit.md) — Audits Review, Timeline, and Export against the restyle reference and identifies remaining conformance work.
- [Whole-repo audit — 2026-10-04](reviews/2026-10-04-whole-repo-audit.md) — Records a whole-repository audit of correctness, tests, architecture, and the Review scripting branch.
- [Test audit — 2026-10-06](reviews/2026-10-06-test-audit.md) — Audits backend, frontend, and workflow tests for misleading assertions and missing behavioral proof.
- [iPhone footage checkpoint review — 2026-10-10](reviews/2026-10-10-iphone-checkpoint-review.md) — Records plan 042's checkpoint, independent code and behavior reviews, and remaining iPhone-footage work.
- [iPhone Footage End-to-End Test — 2026-10-10](reviews/2026-10-10-iphone-footage-test.md) — Records a real iPhone-footage run through the Electron editing workflow with screenshots and exported timeline evidence.
- [Remote View prototype refresh regression — 2026-10-10](reviews/2026-10-10-remote-prototype-refresh.md) — Records the Remote View refresh regression, its changing-clock cause, and the repair's verification.
- [Task 1 Report: Runtime Descriptor And Active Project](reviews/connect-your-ai-mcp-task-1-report.md) — Records runtime-descriptor and active-Project implementation work and its focused verification.
- [qa_user_manual_review](reviews/qa_user_manual_review.md) — Records manual drone-footage feedback requesting clearer analysis progress and failure reporting.

## Decisions (adr)

- [Architecture Decision Records](adr/README.md) — Indexes the numbered architecture decisions and explains their purpose and naming convention.
- [0001: Local-first processing with explicit per-project cloud consent](adr/0001-local-first-and-cloud-consent.md) — Records local-first processing and the original per-project cloud consent policy, whose consent scope is superseded by ADR 0007.
- [0002: Backend-authoritative Timeline Document via a shared Operations core](adr/0002-backend-authoritative-timeline.md) — Makes the backend Timeline Document and shared reversible Operations core authoritative for GUI and agent edits.
- [0003: Projects persist as folders with JSON and FFmpeg-derived metadata](adr/0003-project-folder-persistence.md) — Stores Project state in a folder alongside source media using JSON and FFmpeg-derived metadata.
- [0004: Exports are editable handoffs; EDL deliberately flattens Speed/Transform](adr/0004-editable-export-and-edl-degradation.md) — Treats exports as editable handoffs and records the deliberate loss of Speed and Transform in EDL.
- [0005: Harness and In-App Review Agent are chosen independently, under one consent gate](adr/0005-harness-and-review-agent-are-independent.md) — Keeps scoring and the Review Agent independent while recording the consent and Pi policies later replaced by ADRs 0007 and 0008.
- [0006: Review scripts compile to Proposals](adr/0006-review-scripts-compile-to-proposals.md) — Compiles sandboxed Review Scripts into reversible Proposals that the Editor previews and applies.
- [0007: AI Access is granted once, when the Editor connects a Provider](adr/0007-ai-access-is-granted-when-connecting.md) — Grants AI Access once when connecting a Provider and retains an AI switch for each Project.
- [0008: AI runs through the Editor's own Claude Code or Codex, which the app never installs](adr/0008-ai-runs-through-the-editors-own-provider-program.md) — Routes AI through the Editor's installed Claude Code or Codex program without installing vendor software inside the app.
- [0009: Exports link media by absolute file URL](adr/0009-exports-link-media-by-absolute-file-url.md) — Links exported media using absolute file URLs so editing apps can locate source files without relinking.

ADRs 0001 and 0005 remain accepted for their surviving decisions; their descriptions identify the consent and provider policies replaced by later ADRs.

## Design and media docs

- [Brand and Media Prompt Ideas](BRAND_MEDIA_PROMPTS.md) — Collects prompts for the app icon, logo, README hero, and other project media assets.
- [Logo Decisions — AI Clip Assembler](LOGO_DECISIONS.md) — Records the selected logo concept, asset files, visual treatment, and directions for future variants.
- [Demo Recording Guide](DEMO_RECORDING_GUIDE.md) — Defines the footage, capture steps, shot list, and approval evidence for a truthful product demo.
- [Handoff: AI Clip Assembler — Landing Page Redesign](design/2026-09-01-landing-page-handoff.md) — Describes the approved landing-page layout, themes, real-footage scoring presentation, and implementation handoff.
- [Handoff: AI Clip Assembler — App Restyle (Import · Review · Timeline · Export · Settings)](design/2026-09-03-app-restyle-handoff.md) — Describes the approved desktop app restyle across Import, Review, Timeline, Export, Settings, and Diagnostics.
- [Remote View prototype snapshot](designs/remote-view/prototype/README.md) — Explains the preserved Remote View browser prototype, its server contract, and refresh behavior.

## Design artefacts (HTML)

These HTML files are visual references and reports outside the OKF Markdown page set.

- [Roadmap overview — 2026-10-22](reviews/2026-10-22-roadmap-overview/index.html) — Compares the released baseline with main, tracks roadmap progress, and collects owner decisions.

- [Landing page reference](design/2026-09-01-landing-page-reference.html) — Shows the approved landing-page composition in dark and light themes.
- [Remote View prototype](designs/remote-view/prototype/index.html) — Provides the preserved browser prototype for remote clip review.
- [Shell theme concepts](designs/ui-shell-themes.html) — Compares visual theme concepts for the desktop app shell.
- [Authoritative Timeline Items report](reviews/2026-08-10-authoritative-timeline-items.html) — Presents the implementation and verification of authoritative Timeline item handling.
- [Truthful Export report](reviews/2026-08-10-truthful-export.html) — Presents the authoritative export implementation and its verification.
- [Project shell header and sidebar review](reviews/2026-08-11-project-shell-header.html) — Presents the Project identity and navigation review.
- [Studio workflow redesign review](reviews/2026-08-14-studio-workflow-redesign.html) — Presents the integrated studio redesign and its verification evidence.

## Agents docs (docs/agents)

- [Domain Docs](agents/domain.md) — Explains how agents use the root glossary and architecture decisions when exploring and changing the domain model.
- [Issue tracker: plans in `docs/plans/`](agents/issue-tracker.md) — Defines Markdown plans as the work tracker and explains task IDs, checkbox-derived status, and the GitHub issue inbox.
- [Triage Labels](agents/triage-labels.md) — Maps canonical issue triage roles to this repository's GitHub labels.

## Research

- [Does AI Clip Assembler have potential as an iPhone app built with React Native?](research/2026-09-03-ios-react-native-feasibility.md) — Assesses the product fit and technical feasibility of an iPhone version built with React Native.
