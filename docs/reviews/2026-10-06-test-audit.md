# Test audit — 2026-10-06

Read-only discovery under the `test-audit` skill, run as three Codex Sol
(gpt-6.1-sol, medium) research lanes against `main` at `87a2b27`. Nothing was
edited. Findings feed [plan 036](../plans/036-proper-tests-and-checks.md).

## Lane 1: backend tests

Read-only audit complete; no edits. **No unconditional deletion of production coverage is justified.** The strongest findings concern tests that preserve invalid output or cannot detect lost export data.

Validation: 29 export/framing tests, the native-sort deadline test, and 11 site/release tests passed. In-memory negative controls confirmed the transform weaknesses below. Issue #80 could not be fetched through `gh`; its local investigation corroborates the structural defect ([plan:15](../../docs/plans/032-valid-fcpxml-and-nle-verification.md:15)). The frontend retrospective claims remain unverified in this backend-focused lane.

Commands below use backend cwd and prefix `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. .venv/bin/python -m pytest -s -p no:cacheprovider`. Full backend and lint commands are defined in [package.json:18](../../frontend/package.json:18); CI also requires typecheck, main-process and browser tests ([test.yml:65](../../.github/workflows/test.yml:65)).

**1. REWRITE-AT-OWNER — FCPXML structure**

- **Test/location:** `test_generate_fcpxml_references_assets_and_timeline_clips`, [test_export_engine.py:46](../../backend/tests/test_export_engine.py:46); sibling relative-path test at [192](../../backend/tests/test_export_engine.py:192).
- **Actual detection:** Missing assets, references and selected timing attributes. Both explicitly require `asset@src`, preserving the invalid structure.
- **Callers:** HTTP export invokes `generate_fcpxml` ([api.py:1415](../../backend/src/api.py:1415)).
- **Stronger proof:** None currently establishes conformance. The generator emits childless assets with `src` ([export_engine.py:434](../../backend/src/export_engine.py:434)); [Apple’s 1.10 DTD](https://developer.apple.com/documentation/professional-video-applications/document-type-definition) requires `media-rep+` and does not declare asset `src`.
- **History/reason:** Existing issue investigation identifies these assertions as locking in the defect ([plan:57](../../docs/plans/032-valid-fcpxml-and-nle-verification.md:57)). “Only parses XML” understates their assertions, but correctly identifies the missing independent contract.
- **Unlocked:** Repair asset serialization and replace legacy-shape assertions; retain timing/reference coverage.
- **Risk/validation:** DTD validity does not guarantee successful import. Run `tests/test_export_engine.py -k fcpxml`, then generated-document DTD validation and Final Cut import.

**2. REWRITE-AT-OWNER — MCP framing**

- **Tests/location:** `test_read_message_parses_content_length_frame` and `test_write_message_emits_content_length_frame`, [test_mcp_bridge.py:8](../../backend/tests/test_mcp_bridge.py:8), [26](../../backend/tests/test_mcp_bridge.py:26).
- **Actual detection:** Content-Length parsing/serialization regressions; they enforce the wrong protocol.
- **Callers:** Packaged `--mcp-stdio` entry ([entry.py:16](../../backend/packaging/entry.py:16)); transport loop uses both helpers ([mcp_bridge.py:100](../../backend/src/mcp_bridge.py:100)).
- **Stronger proof:** None exercises standard client framing. [MCP specifies newline-delimited messages](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). A direct probe returned `None` for one valid NDJSON request.
- **History/reason:** Commit `dab4277` introduced these assertions alongside Content-Length framing; live-client verification remained unchecked ([MCP plan:29](../../docs/plans/done/connect-your-ai-mcp.md:29)).
- **Unlocked:** Replace header machinery with protocol framing; test multiple messages, Unicode, EOF and subprocess stdout.
- **Risk/validation:** Preserve forwarding/project injection. Run `tests/test_mcp_bridge.py`; add real stdio-client proof.

**3. STRENGTHEN — export Transform preservation**

- **Tests/location:** `test_generate_fcpxml_emits_adjust_transform_for_non_identity_transform`, [668](../../backend/tests/test_export_engine.py:668), and `test_generate_resolve_xml_emits_basic_motion_for_transform`, [682](../../backend/tests/test_export_engine.py:682).
- **Actual detection:** FCPXML element/scale-prefix presence; Resolve effect name and any scale value. Neither protects pan; Resolve does not protect zoom magnitude.
- **Callers:** HTTP export branches ([api.py:1410](../../backend/src/api.py:1410)).
- **Stronger proof:** API overlap only checks “Basic Motion” text ([test_api.py:2516](../../backend/tests/test_api.py:2516)). In-memory controls zeroed pan and reset Resolve scale to 100%; both tests still passed.
- **History/reason:** Added with A2 export support; ADR explicitly requires preservation ([ADR0004:35](../../docs/adr/0004-editable-export-and-edl-degradation.md:35)).
- **Unlocked:** Extend existing tests with independent exact scale/position expectations; no production deletion.
- **Risk/validation:** Assert target-format coordinate semantics. Run `tests/test_export_engine.py -k transform`.

**4. REWRITE-AT-OWNER — “current release” download contract**

- **Test/location:** `test_download_menus_expose_current_release_assets_for_both_architectures`, [test_site_contract.py:96](../../scripts/tests/test_site_contract.py:96).
- **Actual detection:** Changes to copied v0.2.0 URLs, three-menu inventory and labels; cannot detect stale downloads. HTML copies those URLs ([index.html:1117](../../site/index.html:1117)).
- **Callers:** Published landing page, deployed from `site` ([pages.yml:35](../../.github/workflows/pages.yml:35)).
- **Stronger proof:** Release-workflow tests protect publishing mechanics, not advertised asset freshness ([test_release_workflow.py:29](../../scripts/tests/test_release_workflow.py:29)).
- **History/reason:** `6d79c1b` added this inventory for the v0.2.0 release.
- **Unlocked:** Replace copied URLs/counts with architecture availability and independently verified published-release metadata.
- **Risk/validation:** Package version alone does not establish published availability. Run `python3 scripts/tests/test_site_contract.py -v`; verify selected assets exist.

**5. KEEP — native-sort deadline regression**

- **Test/location:** `test_repeated_native_sorts_stop_at_the_time_limit`, [test_timeline_script.py:796](../../backend/tests/test_timeline_script.py:796).
- **Actual detection:** Native sorts overshooting the configured deadline; additionally verifies named limit, rollback and empty operations through [limit_run:769](../../backend/tests/test_timeline_script.py:769).
- **Callers:** Worker executes the in-process engine ([script_worker.py:31](../../backend/src/script_worker.py:31)); review proposals invoke the process owner ([review_agent.py:341](../../backend/src/review_agent.py:341)).
- **Stronger proof:** Parent hard-kill protects a distinct boundary ([timeline_script.py:1177](../../backend/src/timeline_script.py:1177)).
- **History/reason:** `6203c61` records 4.7 seconds on Linux, repairs per-native-call checks and changes `<3` to `<1.6`.
- **Unlocked:** None; security/liveness contract merits retention.
- **Risk/validation:** Tight wall-clock bound remains scheduling-sensitive. Run `tests/test_timeline_script.py::test_repeated_native_sorts_stop_at_the_time_limit` on Linux; passed locally.

**6. DELETE — fake-provider dimension guard**

- **Test/location:** `test_fake_embedding_provider_rejects_non_positive_dimensions`, [test_embeddings.py:28](../../backend/tests/test_embeddings.py:28).
- **Actual detection:** Constructor guard in a deterministic fake ([embeddings.py:25](../../backend/src/embeddings.py:25)).
- **Callers:** No non-test callers found; support users include [test_api.py:614](../../backend/tests/test_api.py:614).
- **Stronger proof:** Real aggregation contract already uses unnormalized vectors and independent expected output ([test_embeddings.py:33](../../backend/tests/test_embeddings.py:33)).
- **History/reason:** Diversity implementation introduced the fake; documentation identifies its test-only role ([plan018:18](../../docs/plans/done/018-diverse-clip-generation.md:18)).
- **Unlocked:** Move fake into test support; remove production-only-for-tests dimension policy.
- **Risk/validation:** Preserve existing fake-dependent fixtures. Run `tests/test_embeddings.py tests/test_analysis_service.py tests/test_api.py`.

**Gaps**

Generated FCPXML needs Apple 1.10 DTD validation, plus rational-rate cases including `1001/24000s`, frame-aligned timings, valid media references and real import checks. No DTD was found vendored; Apple provides it. Current fallback rounds 23.976 to 24 ([export_engine.py:28](../../backend/src/export_engine.py:28)).

Resolve relative paths need independent relink/import proof ([test_export_engine.py:608](../../backend/tests/test_export_engine.py:608)). EDL already has substantive timing and flattening coverage ([734](../../backend/tests/test_export_engine.py:734)); retain it. Standard MCP client interoperability and published-download availability remain uncovered.
## Lane 2: browser e2e tests

Read-only discovery completed using the requested skill’s value, junk-pattern and retention bars. No edits or test runs. **Three candidates need stronger coverage; one reported false positive should be retained.**

Commands below run from `frontend/`: single-file `npm run test:e2e -- e2e/<file>`, full `npm run test:e2e`, lint `npm run lint`, typecheck `npm run typecheck`. CI additionally runs backend/main tests and installs Chromium ([package.json:26](../../frontend/package.json:26), [test.yml:64](../../.github/workflows/test.yml:64)).

**1. STRENGTHEN — Review visual snapshots**

- **Test/location:** generated `review-grid · light/dark` and `review-list · light/dark` cases, [visual-conformance.spec.ts:602](../../frontend/e2e/visual-conformance.spec.ts:602).
- **Actual detection:** changes within the captured viewport. Setup resets scrolling before page screenshots; it cannot detect changed Candidate Clip cards below that viewport ([setup:401](../../frontend/e2e/visual-conformance.spec.ts:401), [capture:637](../../frontend/e2e/visual-conformance.spec.ts:637)).
- **Callers:** Review renders SourceClipsPanel, which renders ClipCard ([Review.tsx:264](../../frontend/src/renderer/src/routes/Review.tsx:264), [SourceClipsPanel.tsx:133](../../frontend/src/renderer/src/components/SourceClipsPanel.tsx:133)).
- **Stronger owner proof:** existing play-once coverage exercises media state, but provides no equivalent visual proof ([review-browser-redesign.spec.ts:242](../../frontend/e2e/review-browser-redesign.spec.ts:242)). Capture the scrolled candidate browser separately.
- **History:** the poster-first plan explicitly records unchanged baselines because ClipCards were below the fold; inspecting the committed Darwin screenshot confirms this ([plan:177](../../docs/plans/029-review-clip-posters-and-playback.md:177)). Historical byte identity itself was not reproduced.
- **Repair unlocked:** add targeted browser/card snapshots while retaining shell coverage; no production deletion.
- **Risk/validation:** platform rasterization and lazy posters. `npm run test:e2e -- e2e/visual-conformance.spec.ts --grep review`.

**2. STRENGTHEN — “analysis completes and review/timeline previews render playable videos”**

- **Test/location:** [playwriter-preview.spec.ts:30](../../frontend/e2e/playwriter-preview.spec.ts:30).
- **Actual detection:** real analysis, media mounting and metadata readiness. Both media assertions accept `readyState >= 1`; playback never has to advance ([Review assertion:58](../../frontend/e2e/playwriter-preview.spec.ts:58), [Timeline assertion:89](../../frontend/e2e/playwriter-preview.spec.ts:89)).
- **Callers:** SourceClipsPanel → ClipCard; Timeline → ClipPreview ([Timeline.tsx:615](../../frontend/src/renderer/src/components/Timeline.tsx:615)).
- **Stronger owner proof:** Timeline’s playback test checks advancing time, stable source and seeking events; this does not prove Review activation works ([timeline-playback.spec.ts:723](../../frontend/e2e/timeline-playback.spec.ts:723)).
- **History:** preview QA originated in `0718393`; current poster-first activation is explicit ([playwriter-preview.spec.ts:52](../../frontend/e2e/playwriter-preview.spec.ts:52)).
- **Repair unlocked:** assert Review clock advancement after Play; keep the real-backend smoke. Consolidate duplicated import/analyze setup with reviewSetup, preserving audio-specific fixture generation ([reviewSetup.ts:42](../../frontend/e2e/reviewSetup.ts:42), [preview-audio.spec.ts:55](../../frontend/e2e/preview-audio.spec.ts:55)).
- **Risk/validation:** codec availability and playback scheduling. `npm run test:e2e -- e2e/playwriter-preview.spec.ts e2e/timeline-playback.spec.ts`.

**3. STRENGTHEN — “reaches all Settings panels and preserves the legacy Settings deep link”**

- **Test/location:** [settings-connections.spec.ts:204](../../frontend/e2e/settings-connections.spec.ts:204).
- **Actual detection:** sidebar opening and panel navigation. It never navigates a legacy URL.
- **Callers:** Sidebar opens SettingsModal using `initialPanel`; App declares no Settings route ([Sidebar.tsx:288](../../frontend/src/renderer/src/layouts/Sidebar.tsx:288), [App.tsx:15](../../frontend/src/renderer/src/App.tsx:15)).
- **Stronger owner proof:** none for URL compatibility. The legacy `initialTab` mapping is a prop adapter, not proof of routing ([SettingsModal.tsx:48](../../frontend/src/renderer/src/components/SettingsModal.tsx:48)).
- **History:** `ce9366c` introduced this title with the four-panel redesign.
- **Repair unlocked:** establish the supported entry point and exercise it, or remove the unsupported promise from the name. No deletion established.
- **Risk/validation:** inventing a compatibility requirement. `npm run test:e2e -- e2e/settings-connections.spec.ts --grep 'reaches all Settings'`.

**4. KEEP — “follows each slow Script Run down to its result”**

- **Test/location:** [review-scripting.spec.ts:210](../../frontend/e2e/review-scripting.spec.ts:210).
- **Actual detection:** delayed real responses produce successive proposals intersecting the viewport; the 150 ms delay deliberately exercises growing content during smooth scrolling.
- **Callers:** Review renders ReviewChatPanel, whose effect owns following behaviour ([Review.tsx:183](../../frontend/src/renderer/src/routes/Review.tsx:183), [ReviewChatPanel.tsx:67](../../frontend/src/renderer/src/components/ReviewChatPanel.tsx:67)).
- **Stronger owner proof:** this is the browser boundary. Backend tests cannot prove scrolling.
- **History:** `785fee3` introduced this case and viewport assertions. Earlier scripting coverage lacked them. No retained execution evidence establishes whether the two reported tests went red before repair.
- **Deletion unlocked:** none.
- **Risk/validation:** default viewport assertions require only partial intersection, not the result’s bottom ([Playwright contract](https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-be-in-viewport)). `npm run test:e2e -- e2e/review-scripting.spec.ts --grep 'follows each slow'`.

**Contributor/runtime requirements**

Use standard Playwright `page` fixtures and shared reviewSetup. It generates FFmpeg media, opens `/#/playwriter`, uploads once to create the legacy project, uploads sources, then runs Manual analysis ([reviewSetup.ts:7](../../frontend/e2e/reviewSetup.ts:7)). Visual and gating tests instead fulfill backend routes; they prove renderer behaviour, not backend delivery ([visual fixture:170](../../frontend/e2e/visual-conformance.spec.ts:170), [step-gating:97](../../frontend/e2e/step-gating.spec.ts:97)). Prefer accessible roles/labels and existing test IDs. Settings is a modal ([SettingsModal.tsx:75](../../frontend/src/renderer/src/components/SettingsModal.tsx:75)).

One worker, backend port 8000, renderer port 5173 and `reuseExistingServer: true` mean an already-running server can supply the test environment ([config:7](../../frontend/playwright.config.ts:7), [config:39](../../frontend/playwright.config.ts:39)). The blanket 180-second timeout also covers mocked tests; scope that budget to real analysis tests. Replace readiness sleeps with observable readiness, while retaining intentional playback sampling ([timeline-playback:144](../../frontend/e2e/timeline-playback.spec.ts:144), [sampling:741](../../frontend/e2e/timeline-playback.spec.ts:741)).

**Sandbox diagnosis**

The exact historical failure cannot be established without its stderr. A definite filesystem blocker exists: startup unconditionally writes `~/.ai-clip-assembler/runtime.json` ([api.py:123](../../backend/src/api.py:123), [runtime_descriptor.py:20](../../backend/src/runtime_descriptor.py:20)).

Inside the repo, set backend `webServer.env.CLIP_ASSEMBLER_RUNTIME_FILE` to an **absolute workspace path**, and use `PLAYWRIGHT_BROWSERS_PATH=0` consistently for browser installation and execution. Default browser caches are outside the workspace; installed binaries there are not automatically an execution blocker ([browser documentation](https://playwright.dev/docs/browsers#managing-browser-binaries)).

These changes solve filesystem placement, **not denied socket binding**. Default workspace-write disables networking; loopback access for 8000/5173 must also be permitted by the runner policy ([OpenAI documentation](https://learn.chatgpt.com/docs/agent-approvals-security)). No Playwright-only change guarantees execution under a network-denying sandbox.

**Gaps**

Candidate-card visual coverage and genuine Review playback remain incomplete. User-scrolled-up chat behaviour lacks equivalent proof ([ReviewChatPanel.tsx:158](../../frontend/src/renderer/src/components/ReviewChatPanel.tsx:158)). Cross-lane checks confirm v0.2.0 download pins ([site test:99](../../scripts/tests/test_site_contract.py:99)) and Content-Length framing contrary to [MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) ([bridge test:8](../../backend/tests/test_mcp_bridge.py:8)). Export tests check attributes beyond parsing, but not Final Cut acceptance ([export test:74](../../backend/tests/test_export_engine.py:74)); issue #80 was unreachable. `6203c61` records Linux timing failure and repairs the owner; the current bound is 1.6 seconds ([script test:796](../../backend/tests/test_timeline_script.py:796)).
## Lane 3: static checks, main-process tests and hooks

Read-only audit completed using the requested test-audit skill. **Two main-process candidates merit repair; no unconditional deletion is justified.**

**Local checks versus CI**

CI invokes the same npm commands for ESLint, Ruff, generated-type freshness, TypeScript, pytest, and main-process Node tests ([workflow:64–79](../../.github/workflows/test.yml:64), [scripts:26–32](../../frontend/package.json:26)).

Mismatches:

- Contributor instructions run unrestricted pytest; npm/CI adds `--ignore=tests/test_codex_cli_harness.py`. That file is currently absent, so the exclusion is stale rather than currently suppressing tests ([CONTRIBUTING:28](../../CONTRIBUTING.md:28), [package:18](../../frontend/package.json:18)).
- The contributor checklist requires `build`; this workflow runs typecheck but no Electron build. Its listed local commands also omit lint and main-process tests ([CONTRIBUTING:33](../../CONTRIBUTING.md:33), [CONTRIBUTING:49](../../CONTRIBUTING.md:49), [workflow:64](../../.github/workflows/test.yml:64)).
- CI additionally runs the release-workflow contract ([workflow:39](../../.github/workflows/test.yml:39)).
- `typecheck` excludes test files; `test:main` separately compiles main tests. Neither configuration includes Playwright specs ([tsconfig:24](../../frontend/tsconfig.json:24), [main-test config:10](../../frontend/tsconfig.main-tests.json:10), [Playwright:4](../../frontend/playwright.config.ts:4)).
- Browser commands match, but CI enables two retries and a different global timeout ([Playwright:12](../../frontend/playwright.config.ts:12)).
- The local hook runs only React Doctor and permits failure; CI runs no React Doctor ([hook:4](../../.git/hooks/pre-commit:4), [hook:28](../../.git/hooks/pre-commit:28)).

**Suppressions and exclusions**

Counts cover frontend source/tests/e2e, backend source/tests, and Python scripts:

- **Three disabled React rules:** immutability, refs, set-state-in-effect ([ESLint:25](../../frontend/eslint.config.mjs:25)). Enabling them experimentally produced **20 diagnostics: 1/8/11 respectively**. Suspicious sites include render-time ref writes in [Timeline:164](../../frontend/src/renderer/src/components/Timeline.tsx:164) and [useSequencePlayer:56](../../frontend/src/renderer/src/components/useSequencePlayer.ts:56), and a render-time ref read in [ReviewChatPanel:155](../../frontend/src/renderer/src/components/ReviewChatPanel.tsx:155). These are hidden diagnostics, not demonstrated product failures.
- **Six explicit ESLint path exclusions:** five generated-output directories plus generated types ([config:8](../../frontend/eslint.config.mjs:8), [package:27](../../frontend/package.json:27)). **Two inline disables:** generated types and intentional control-character filtering ([generated:2](../../frontend/src/renderer/src/types/generated.ts:2), [projectRecents:2](../../frontend/src/main/projectRecents.ts:2)). Both have defensible purposes.
- **One TypeScript bypass:** `skipLibCheck`; dependency declarations are unchecked ([tsconfig:13](../../frontend/tsconfig.json:13)).
- Ruff selects only E4/E7/E9/F and has **two E402 per-file ignores** ([pyproject:6](../../backend/pyproject.toml:6)). **Eight `noqa` comments:** six script import-order allowances, one parked-test import, and one explicit test seam ([benchmark:33](../../scripts/spike_pi_scaling_benchmark.py:33), [synthetic QA:31](../../scripts/synthetic_e2e_qa.py:31), [diversity:20](../../backend/tests/test_version_diversity.py:20), [api:88](../../backend/src/api.py:88)). Scripts lie outside Ruff’s `src tests` command ([package:28](../../frontend/package.json:28)).
- **Four `importorskip` sites, one explicit skip, zero xfail/skip decorators or disabled Node/Playwright tests found.** The suspicious skip parks **seven diversity tests because production is absent**, explicitly acknowledged by the plan index ([diversity:15](../../backend/tests/test_version_diversity.py:15), [plans:51](../../docs/plans/README.md:51)). Embedding skips concern ONNX dependencies/model availability; `onnxruntime` is installed by requirements, but `onnx` is not listed ([embeddings:61](../../backend/tests/test_embeddings.py:61), [embeddings:118](../../backend/tests/test_embeddings.py:118), [embeddings:147](../../backend/tests/test_embeddings.py:147), [requirements:15](../../backend/requirements.txt:15)).

**Candidate evidence**

1. **REWRITE-AT-OWNER — `validateRevealExportPath accepts…` / `rejects…`**, [exportHandoff.test:8](../../frontend/tests/main/exportHandoff.test.ts:8).
   - **Detects:** path-validation errors, but couples tests to an exported internal validator ([owner:9](../../frontend/src/main/exportHandoff.ts:9)).
   - **Callers:** only production caller is `handleRevealExportFile`; Electron calls that handler ([owner:23](../../frontend/src/main/exportHandoff.ts:23), [index:242](../../frontend/src/main/index.ts:242)).
   - **Stronger proof:** existing handler tests cover accepted and relative paths, but omit empty, whitespace, and null ([test:22](../../frontend/tests/main/exportHandoff.test.ts:22), [test:35](../../frontend/tests/main/exportHandoff.test.ts:35)).
   - **History:** introduced in `6d79c1b` (#68); current code describes renderer-input validation ([owner:8](../../frontend/src/main/exportHandoff.ts:8)).
   - **Unlocked:** move all cases to the handler, then remove direct tests and the validator’s export; retain its implementation.
   - **Risk/validation:** preserve every invalid-input case and prove shell access never occurs. Run `cd frontend && npm run test:main`.

2. **STRENGTHEN — `probes the interactive login shell first so rc-file PATH edits are visible`**, [piExecutable.test:54](../../frontend/tests/main/piExecutable.test.ts:54).
   - **Detects:** changes to declared argument order; cannot detect the caller ignoring those arguments or failing to execute the probe.
   - **Callers:** `resolvePiBinFromLoginShell` consumes the array and calls `execFile` ([index:310](../../frontend/src/main/index.ts:310)).
   - **Stronger proof:** absent at actual shell-resolution boundary; sibling tests exercise parsing/fallback helpers ([test:12](../../frontend/tests/main/piExecutable.test.ts:12), [test:92](../../frontend/tests/main/piExecutable.test.ts:92)).
   - **History:** `0c2f31a` fixed packaged-app Pi discovery; the platform failure is documented beside the configuration ([owner:12](../../frontend/src/main/piExecutable.ts:12)).
   - **Unlocked:** replace the declaration assertion with resolution behavior; no production deletion justified.
   - **Risk/validation:** exercise rc-file PATH discovery and fallback without personal shell configuration. Run `cd frontend && npm run test:main`.

3. **KEEP — `cleanupStaleBackend does not terminate a reused pid…`**, [backendLifecycle.test:219](../../frontend/tests/main/backendLifecycle.test.ts:219).
   - **Detects:** signalling an unrelated process or deleting its runtime descriptor.
   - **Callers:** packaged backend startup ([index:365](../../frontend/src/main/index.ts:365)).
   - **Stronger proof:** this is already the cleanup boundary, including real descriptor-file retention ([test:240](../../frontend/tests/main/backendLifecycle.test.ts:240)); the predicate test lacks those effects.
   - **History:** startup-hardening commits `9b9288c`/`3c91c6c`; production explicitly preserves reused-PID state ([owner:218](../../frontend/src/main/backendLifecycle.ts:218)).
   - **Unlocked:** nothing. Mocked process inspection is appropriate; it does not supply the asserted decision.
   - **Risk/validation:** deletion loses process-safety proof. Run `cd frontend && npm run test:main`.

**Versioned staged-hook inputs**

| Check | Staged execution | Local cost |
|---|---|---|
| ESLint | From frontend, pass staged `src` JS/TS/TSX paths; preserve generated exclusion | Measured 0.41s single file; 2.43s full |
| Ruff | Pass staged backend `.py` paths with `--no-cache` | Measured 0.04s single file; 0.05s full |
| React Doctor | Installed binary, `--staged --no-score`; gate on staged TSX | Estimated 1–10s; unmeasured |
| TypeScript | Whole project; file arguments cannot preserve project checking | Measured 1.40s production; 0.73s main-test compilation |

Commands/configuration: [package:27](../../frontend/package.json:27). React Doctor materializes index contents ([installed CLI:7921](../../frontend/node_modules/react-doctor/dist/cli.js:7921)); ordinary file-list linting reads working-tree contents, so handle partial staging explicitly. No husky/lint-staged/simple-git-hooks dependency exists ([package:39](../../frontend/package.json:39)). Use the installed frontend binary, print diagnostics, propagate failures, and avoid the current network-based `@latest` fallback ([hook:5](../../.git/hooks/pre-commit:5)).

Measured checks passed. Main tests and freshness generation were not executed because they write files ([package:30](../../frontend/package.json:30)).

**Gaps**

Actual macOS shell discovery lacks owner-boundary proof ([index:324](../../frontend/src/main/index.ts:324)). Export IPC tests do not exercise sender rejection or prove validation precedes shell access ([test:22](../../frontend/tests/main/exportHandoff.test.ts:22)). Parked diversity tests provide no running production coverage ([plans:51](../../docs/plans/README.md:51)). The retrospective export, MCP, site, and scrolling claims remain unverified outside this lane.