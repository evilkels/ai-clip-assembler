# Whole-repo audit — 2026-10-04

Target: `feat/review-chat-scripting` at `3543c6e` (main `f15906d` + open PR #86, plan 034 Lua scripting).
Method: 13 Codex runs on `gpt-6.1-sol`, effort medium: 3 test-audit lanes, 6 area reviews and 1 autoreview helper pass on PR #86, then 2 adversarial verifiers. Every P0/P1 and every test-deletion candidate was re-checked against the code by the orchestrator or a verifier. Report only: no source or test edits.

Baseline at `3543c6e`: backend pytest 561 passed / 2 skipped (SigLIP model absent; `test_version_diversity.py` parked by `importorskip`), `npm run test:main` 73/73, `scripts/tests` 11/11, CI Playwright suite green on PR #86.

Verdicts: **CONFIRMED** = traced end to end or reproduced by a probe. **PLAUSIBLE** = the code allows it, but something unchecked may prevent it. **REJECTED** = dropped from the main list. P2/P3 items marked *unverified* come from a single delegate run and were not re-checked; treat them as leads.

## Summary

| Severity | Confirmed | Plausible | Unverified (delegate only) | Total |
|---|---|---|---|---|
| P0 | 1 | 0 | 0 | 1 |
| P1 | 9 | 0 | 0 | 9 |
| P2 | 22 | 1 | 25 | 48 |
| P3 | 2 | 0 | 2 | 4 |

| Test lane | Declarations | R | F (repair) | C (consolidate) | D (delete) |
|---|---|---|---|---|---|
| Backend `backend/tests` (24 files) | 510 | 499 | 10 | 1 | 0 |
| E2E `frontend/e2e` (15 specs + 48 baselines) | 100 | 94 | 5 | 0 | 1 |
| Main process + scripts + packaging checks | 88 tests + 55 checks | 139 | 4 | 0 | 0 |

PR #86 autoreview helper (`--mode branch --base origin/main`, P3 threshold): **scoped-clean**, verdict "patch is correct (0.85)". The pass was shallow (one pass, 2,083 output tokens). Area 2 below covers the same Lua engine more deeply, with probes.

Re-rated during verification:
- FCPXML schema stays P0 but is already known (issue #80, plan 032).
- Non-atomic JSON writes: P0 → P1 (needs a crash or a full disk mid-write).
- Consent ignored mid-analysis: P0 → P2 (the UI cannot revoke consent; see P1-6).
- Of ar-1's other P1s, B2 stays P1; empty-export, B3–B8 and save-failure move to P2, and the Origin-null CORS item becomes PLAUSIBLE P2.
- All six of ar-5's P1s were checked: one stays P1 (P1-9), and the playback, receipt, inspector and Version-apply items become P2.
- All three of ar-6's P1s are real but scoped narrower, so P2 or P3.
- ar-3 navigation: P1 → P3. The verifier REJECTED every pre-script navigation path (Electron 42 disables drop-navigation by default, and there are no links or HTML rendering).

## Findings, by severity

### P0

**P0-1 · `backend/src/export_engine.py:437` — FCPXML 1.10 `<asset>` carries `src` and has no `<media-rep>`.** CONFIRMED, known.
- Failure: every non-empty FCPXML export fails DTD validation in Final Cut Pro.
- Fix: emit `<media-rep kind="original-media" src=…/>` and validate against the 1.10 DTD.
- Already tracked by [plan 032](../plans/032-valid-fcpxml-and-nle-verification.md) / issue #80, still TODO.

### P1

**P1-1 · `backend/src/mcp_bridge.py:56` — the MCP stdio bridge uses LSP `Content-Length` framing.** CONFIRMED by a probe and by the [MCP spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), which requires newline-delimited JSON.
- Failure: Claude Desktop or Codex, configured by Settings → Connect (`mcpConnect.ts:28`), sends `{...}\n` and the bridge blocks waiting for headers. The external-agent feature cannot work, yet the UI shows "Connected" because it only checks the config text.
- `backend/tests/test_mcp_bridge.py:8,26` assert the wrong framing, and the live client smoke test in `docs/plans/done/connect-your-ai-mcp.md` was never checked off.
- Fix: read and write one JSON-RPC message per line, and rewrite the two tests.

**P1-2 · `backend/src/review_agent.py:508` — the Review model call blocks the FastAPI event loop.** CONFIRMED.
- `agent(context)` runs synchronously inside `async run_review_turn`. The default agent is `subprocess.run(pi …, timeout=pi_timeout_sec)` (`:834`), up to 180 s.
- Failure: while the Review agent thinks, every other request stalls: timeline ops, SSE, health, other projects.
- Fix: `await asyncio.to_thread(agent, context)`, as the script path already does at `:340`.

**P1-3 · `backend/src/api.py:814` — Short/Medium/Long draft regeneration does not reach the authoritative Timeline.** CONFIRMED by the verifier's probe.
- The route only updates the legacy `project["timeline"]` and invalidates the controller. Reconstruction then prefers the unchanged saved `timeline.json` (`project_store.py:457`).
- Failure: on a folder project with any saved edit, the user switches format, the response says `cinematic_highlight`, and the document stays `short_social` with the old bounds. Contradicts ADR 0002.
- Fix: replace the live document through the operations core (`replace_timeline` plus profile and target) and persist it.

**P1-4 · `backend/src/assembly_profiles.py:175` — draft scene caps are keyed by bare `scene_id`.** CONFIRMED.
- Scene IDs restart for each source (`scene_detection.assign_scene_ids`).
- Failure: six drone clips, each with scene 1, share one per-scene quota. Probe: `long_scenic`, target 480 s, gives 3 clips / 60 s.
- Fix: key `scene_counts` by `(file_id, scene_id)`.

**P1-5 · `backend/src/project_store.py:198` (and the other `write_*` helpers) — project JSON is written in place with `write_text`.** CONFIRMED (code read).
- Failure: a crash or full disk mid-write truncates the only copy of `project.json` or `timeline.json`. The loader then rejects the manifest or silently falls back.
- Fix: write a sibling temp file, fsync, then `os.replace`.

**P1-6 · `frontend/src/renderer/src/components/AiAssistancePanel.tsx:102` — cloud consent cannot be revoked.** CONFIRMED.
- The panel says "Granted once per project, revocable here", but the only `setCloudAiConsent` caller is the grant in `Import.tsx`.
- ADR 0001 requires opt-in to be "reversible, per-project".
- Fix: add a revoke control that calls `setCloudAiConsent(false)`.

**P1-7 · `frontend/src/main/reviewModelAuth.ts:165` — the Pi version check fails on Finder/Dock launches.** CONFIRMED.
- `runPiVersion` inherits Electron's minimal PATH. Only the backend gets `dirname(piBin)` added (`index.ts:337`).
- Failure: Pi installed via nvm or Homebrew node has `#!/usr/bin/env node`, which exits 127. Settings then shows "Pi could not be inspected" and sign-in is disabled, while the backend would run Pi fine.
- Fix: pass the same augmented PATH to `execFile` in `runPiVersion`.

**P1-8 · `frontend/src/renderer/src/state/ReviewContext.tsx:392` — Rescan Folder wipes Review state and never rehydrates.** CONFIRMED.
- `resetProjectSession()` clears clips, items and snapshot, but `projectId` is unchanged, so the hydration effect (`:242`) does not re-run. The backend rescan keeps clips and timeline (`api.py:365`).
- Failure: Review and Export show empty and gated until the project is reopened.
- Fix: after rescan, re-fetch candidates and the timeline snapshot, or don't reset analysis state.

**P1-9 · `frontend/src/renderer/src/routes/Import.tsx:285` — analysis completion is not scoped to its project.** CONFIRMED by the verifier.
- Failure: start analysis in A, open B from the sidebar, and A's completion overwrites B's candidates and harness metadata, then fetches A's timeline into B (`ReviewContext.tsx:417–426`). Poll cleanup only clears the interval.
- Fix: capture project/session identity at start and drop completions and polls that don't match.

### P2 — confirmed

| # | Location | Defect → failure | One-line fix |
|---|---|---|---|
| 1 | `backend/src/api.py:969` | Timeline save `OSError` is logged and the edit still publishes as success → reopening loses it (ADR 0003) | Make persistence part of the commit; return an error |
| 2 | `backend/src/review_agent.py:291` | Proposal guard is only `based_on_timeline_revision`, and a draft rebuild resets to revision 0 → a pending revision-0 Proposal applies onto a different Timeline (probe: 2 → 3 items) | Expire pending Proposals on invalidate, or keep a monotonic project revision |
| 3 | `backend/src/api.py:1393` | Empty authoritative document falls back to the legacy draft → API/MCP export of a cleared timeline exports old clips (probe: remove only item, `clip_count=1`); GUI blocks empty export | Always export the authoritative document |
| 4 | `backend/src/api.py:528` | Analysis admission not atomic → two concurrent API calls both run (GUI disables the button) | Per-project lock around check-and-claim |
| 5 | `backend/src/analysis_service.py:354` | Cancel during last Pi scoring + Pi timeout → no cancel check → results committed as complete (probe) | Check cancellation before finalizing |
| 6 | `backend/src/api.py:938` | Reopen with unprobeable source → `metadata=None` → document GET / op / export all 500 `AttributeError` (probe) | `(video.get("metadata") or {})` |
| 7 | `backend/src/export_engine.py:209` | NTSC frames use nominal fps → 600 s at 29.97 gives 18000 frames (600.6 s) in Resolve XML; EDL `00:10:00:00` vs `00:09:59:12` | Count frames at actual fps, label at nominal |
| 8 | `backend/src/project_store.py:431` | `migrate_legacy_timeline` drops `suggested_speed` → fresh cinematic draft 0.5× becomes 1.0× in document and export (real analyze probe) | Carry `suggested_speed` into item speed |
| 9 | `backend/src/export_engine.py:504` | FCPXML pan emitted in pixels (`192 108`), but FCPXML wants % of frame height (`17.78 10`); not in plan 032 | `(100*x*w/h, 100*y)` |
| 10 | `backend/src/analysis_service.py:323` | Consent checked only at analysis start → revocation mid-run still dispatches frames (needs P1-6 first) | Re-check consent before each provider call |
| 11 | `frontend/src/renderer/src/state/ReviewContext.tsx:232` | Timeline refresh/op responses unguarded by project → A's snapshot lands in B after a switch | Project-generation guard |
| 12 | `frontend/src/renderer/src/state/ReviewContext.tsx:192` | Snapshots reconciled without revision ordering → older SSE/op response overwrites newer | Ignore snapshots with lower revision |
| 13 | `frontend/src/renderer/src/state/ReviewContext.tsx:223` | Failed op (500/network) resolves → `VersionApplyDialog` closes as success (an error does show elsewhere) | Rethrow after recording the error |
| 14 | `frontend/src/renderer/src/components/useSequencePlayer.ts:50` | Initial seek `{time:0}` → Version preview of item `[30,35]` plays from 0 (excluded footage) | Init seek to first segment start |
| 15 | `frontend/src/renderer/src/components/useSequencePlayer.ts:189` | Replay after end on the same index skips the seek → plays past the out-point with boundary lock held | Seek when `endedRef.current` |
| 16 | `frontend/src/renderer/src/routes/Export.tsx:100` | Receipts not reset on project switch → B shows A's receipt; Resolve hand-off gets A's XML with B's folder | Scope receipts to project |
| 17 | `frontend/src/renderer/src/components/TimelineEditor.tsx:46` | Controls key includes bounds → saving In remounts and drops an in-progress Out edit | Key by `item_id`; controlled drafts |
| 18 | `frontend/src/renderer/src/components/ClipPreview.tsx:164` | Preview applies only `scale`, ignoring transform `x/y` pan, which export honours → preview/export disagree | Apply `translate` from x/y |
| 19 | `frontend/src/main/mcpConnect.ts:62` | Exact-string match on section header → hand-edited `[mcp_servers.ai-clip-assembler] # x` or quoted key gets a duplicate table → Codex rejects config | Parse TOML structurally |
| 20 | `frontend/package.json:36` | `npm run dist` skips `stage:runtime-tools` → local DMG has no ffmpeg/ffprobe (CI release stages it) | Add staging to `dist` |
| 21 | `.github/workflows/build-dmg.yml:106` | Releases unsigned and un-notarized → Gatekeeper blocks first launch (documented in `docs/UPDATING.md`) | Developer ID signing + notarization |
| 22 | `site/index.html:1117` | Download buttons serve v0.2.0; latest release is v0.3.1 (since 2026-09-11); `test_site_contract.py:96` pins the stale URLs | Bump links; derive the test's version from one source |

### P2 — plausible

| # | Location | Defect → failure | One-line fix |
|---|---|---|---|
| 23 | `backend/src/api.py:104` | CORS allows `Origin: null` with credentials and there is no API auth → a sandboxed/file:// page could drive the local API. Mitigated by the packaged app's random port and browser Private Network Access / Local Network Access; not exercised in a browser | Drop `null`; per-launch token on privileged routes |

### P2 — unverified (single delegate, not re-checked)

- **Backend:**
  - `motion_analysis.py:160`: unescaped paths in the vidstab filter break on `'` `:` `,`.
  - `frame_extraction.py:78`: filenames used as glob patterns, so `DJI [1].mp4` gives no samples.
  - `models.py:199`: NaN/inf pass validation and then fail reload.
  - `export_engine.py:33`: 23.976 fps exports as 24 (known, plan 032).
  - `mcp_server.py:35`: tool schemas miss required args (`replace_timeline.items`); also noted by the backend test lane.
  - `review_agent.py:661`: NaN accepted in model Versions.
  - `review_agent.py:527`: a bad model reply raises 500 instead of a failed turn.
  - `pi_cli_harness.py:193`: a timeout kills only the direct child, not its process group.
- **Main process:**
  - `index.ts:377`: spawn `error` event unhandled.
  - `backendLifecycle.ts:145`: stale-PID match by substring can signal an unrelated process (also flagged by the main lane).
  - `backendLifecycle.ts:272`: health `fetch` has no abort, so startup can hang.
  - `index.ts:427`: quit orphans FFmpeg/Pi children.
- **Renderer:**
  - `ReviewContext.tsx:471`: optimistic include not rolled back on failure.
  - `api/client.ts:720`: SSE reconnect does not refetch the snapshot.
  - `api/client.ts:109`: `look_group` dropped from the clip mapping, which disables Similar Looks.
  - `Import.tsx:221`: overlapping uploads clobber each other.
  - `SettingsTabPanel.tsx:39`: save completion clears newer edits.
  - `Export.tsx:159`: the receipt is built from a renderer snapshot, not the exported one.
  - `TimelineItemRow.tsx:60`: rejected edits stay displayed with no error.
  - `VersionApplyDialog.tsx:67`: no focus trap or Escape.
- **Packaging/CI:**
  - `backend/packaging/backend.spec:15`: embedding model not packaged (known, plan 025).
  - `build-dmg.yml:42`: version guard omits the Settings string.
  - `build-dmg.yml:124`: mutable `softprops/action-gh-release@v3` runs with `contents: write`.
  - `scripts/backend_smoke_test.py:155`: the script smoke never asserts the edit applied.
  - `scripts/synthetic_e2e_qa.py:303`: the reopen check validates legacy state (same as the main lane's F candidate).

### P3

| # | Location | Defect | Verdict | Fix |
|---|---|---|---|---|
| 1 | `frontend/src/main/index.ts:474` | No `will-navigate` guard; preload stays exposed if the window navigates. No pre-script navigation path exists (REJECTED as P1) | CONFIRMED (hardening) | Deny navigation off the app URL |
| 2 | `scripts/synthetic_e2e_qa.py:83` | `--folder` overwrites, then deletes `noise.png` and same-named fixtures | CONFIRMED (dev tool) | Generate into a fresh subdirectory |
| 3 | `backend/src/timeline_script.py:1168` | Size-limit error emitted before worker `ready` is reported as "runner stopped unexpectedly" | unverified | Accept a valid final result without `ready` |
| 4 | `scripts/app-wizard.sh:174` | `install_from_dmg` replaces the download cleanup trap, leaking temp files | unverified | One combined cleanup trap |

Lua sandbox (Area 2, phrased as checking the D9 isolation guarantees): the run's probes found no escape. Python attributes are blocked; loader, debug, io/os and coroutine globals are absent; `__close`/`__gc` are refused. The instruction, memory, string, table, Operation, log and output caps held, and worker hard-kill works. A dry run replays identically under `id_seed`. These were bounded probes, not a formal proof.

## Test-audit candidates

Headline: **the suites are mostly sound.** Across ~700 declarations there is 1 delete candidate, 1 consolidation and 19 assertion repairs, and no redundant layer is worth retiring. The repairs matter more than the pruning: three retained tests pin a product defect (MCP framing, stale site links, the legacy reopen check), and several assertions can pass without exercising the contract their name claims.

### Backend (`backend/tests`), ledger `/tmp/aca-audit/backend-ledger.md`

| Mark | Test | Evidence | Verdict |
|---|---|---|---|
| C | `test_assembly_profiles.py:198 test_short_format_never_slowmos` | Same contract as `:106 test_short_social_never_applies_slowmo`; only adds `look_group=0`. Carry that fixture into the keeper | CONFIRMED |
| F | `test_timeline_script.py:486 test_close_handlers_cannot_swallow_a_memory_limit` | `__close` is refused before any allocation, so the test passes via an earlier guard and accepts `runtime`; the memory limit is never reached. Keepers `:476`, `:903` | CONFIRMED |
| F | `test_mcp_bridge.py:8,26` | Asserts the wrong (Content-Length) framing; locks in P1-1 | CONFIRMED (from verifier) |
| F | `test_api.py:2130`, `test_export_engine.py:259` (EDL fps) | Whole-second inputs give identical frames at 30 and 60 fps, so fps propagation is untested; use fractional endpoints | PLAUSIBLE |
| F | `test_clip_assembly.py:161 test_assembly_caps_clips_per_scene` | One smooth run yields one candidate before the cap matters; expected value changed 2 → 1 in `b253d0f` without changing the fixture | PLAUSIBLE |
| F | `test_timeline_service.py:79 test_service_controller_persists_before_publishing_change` | Checks end state only, so reversed write/publish order still passes | PLAUSIBLE |
| F | `test_api.py:2516`, `test_export_engine.py:682` (speed/transform export) | Presence checks ("Basic Motion", any warning) don't prove values survive | PLAUSIBLE |
| F | `test_quality_scoring.py:15` | All factors ≥ 8, so swapped weights still pass `overall >= 8` | PLAUSIBLE |
| F | `test_app_settings.py:73` | Corrupt-file recovery checks key presence, not default values | PLAUSIBLE |
| note | `test_version_diversity.py` (7 tests) | Deliberately parked by `importorskip` for unimplemented plan 027 Task 1. Not junk, but no running proof; keep or delete together with plan 027 | — |

### E2E (`frontend/e2e`), ledger `/tmp/aca-audit/e2e-ledger.md`

| Mark | Test | Evidence | Verdict |
|---|---|---|---|
| D | `update-banner.spec.ts:70 "stays silent when the app is already up to date"` | Absence-only check; `update-section.spec.ts:35` sets the same bridge state, asserts the settled "Up to date" UI **and** banner absence | CONFIRMED |
| F | `visual-conformance.spec.ts:607` narrow (1024×768) `review-grid`/`review-list` | Candidate browser is below the fold: grid and list baselines are byte-identical on darwin dark/light and linux dark (linux light differs under tolerance), so they prove nothing about grid vs list | CONFIRMED |
| F | `review-browser-redesign.spec.ts:195` lazy posters | Fixture has one candidate, so "activates only the played clip" can't fail | PLAUSIBLE |
| F | `timeline-playback.spec.ts:664` Space on focused button | Never asserts playback stayed stopped | PLAUSIBLE |
| F | `review-browser-redesign.spec.ts:242` play-once/loop | Paused/unpaused checks can pass without crossing the out-point | PLAUSIBLE |
| F | `compare-versions.spec.ts:30` exclusive playback | Asserts button labels plus a 100 ms sleep, not media state | PLAUSIBLE |

The same lane found product bug P2-18 (preview ignores pan) behind a retained test that only asserts scale (`timeline-playback.spec.ts:597`).

### Main process, scripts, packaging, ledger `/tmp/aca-audit/main-and-other-ledger.md` (+ sub-ledgers)

| Mark | Test/check | Evidence | Verdict |
|---|---|---|---|
| F | `scripts/tests/test_site_contract.py:96` | Pins v0.2.0 download URLs; accepts stale links and would fail a correct bump (P2-22) | CONFIRMED |
| F | `frontend/scripts/verify-packaged-backend.mjs:43` | Greps `main/index.ts` for `whence -p pi`, which moved to `piExecutable.ts`; the script fails on current source and has no CI caller | CONFIRMED |
| F | `scripts/synthetic_e2e_qa.py:305` reopen check | Validates legacy `timeline.clips`, not the authoritative document; speed/split/transform loss stays green | CONFIRMED |
| F | `scripts/synthetic_e2e_qa.py:279` MCP edit visible | No absent-before precondition; vacuous when only one clip (`second_clip` falls back to `op_clip`) | PLAUSIBLE |

Coverage gaps the lanes named, where a test would protect a real contract:
- `mcpConnect.ts` (no tests at all).
- Durable save failure (P2-1).
- Export after clearing a populated timeline (P2-3).
- Per-source scene quotas (P1-4).
- MCP tool schemas vs operation signatures.
- Project-switch isolation of in-flight renderer responses (P1-9, P2-11, P2-16).
- Consent revoke (P1-6).
- BrowserWindow navigation policy.

## Not covered

- **Runtime:** no Playwright run (CI green accepted as baseline), no packaged DMG or clean-machine install, no real Final Cut / Resolve imports, no live MCP client handshake, no real provider calls, no x86_64. Delegate probes ran in memory against source.
- **Test changes:** campaign steps 4–8 (layer cutover, edits, preservation review with mutations) were not run, since this audit is report-only. No candidate has had a mutation proof.
- **Low-severity leads:** 25 P2 and 2 P3 findings are single-delegate and unverified (listed above).
- **PR #86 helper:** shallow single pass. Area 2's probe-based review stands in for the depth.
- **Not reviewed:** `harness/pi_agent/config.json`, `docs/` accuracy beyond the cited ADRs and plans, `site/` beyond the download links, CSS beyond layout skims, and `.worktrees/` (stale sibling worktrees, deliberately excluded).
- **Review lane:** personal `claude` auth is broken, so there was no cross-vendor review. All runs were Codex Sol.

Raw outputs (outside the repo): `/tmp/aca-audit/*.final.md`, ledgers `/tmp/aca-audit/*-ledger.md`, prompts `~/.local/share/aca-delegation/audit-2026-10-04/`.
