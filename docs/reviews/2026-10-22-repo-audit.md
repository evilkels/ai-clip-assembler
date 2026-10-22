---
type: Review
title: Repo audit 2026-10-22
description: Whole-repository audit of unreleased extraction, export and iPhone improvements, remaining defects, cleanup and next-release readiness.
status: draft
created: 2026-10-22
---

# Repo audit 2026-10-22

The next release should be **v0.5.0**, after timeline durability, export edge cases and real editing-app imports are checked. Extraction, schema-valid FCPXML and iPhone handling have advanced substantially; four of the previous fifteen findings are fixed, two partly fixed and nine remain open on the audited main. Local frontend gates pass, but the existing backend environment cannot supply a clean baseline; GitHub's Python 3.12 gate passed on this exact commit. No implementation, cleanup, release or tag is performed by this review.

## 1. Scope and state

- Audited main: **`2df01692b901f232416123d4cf7b3e249cbabe5d`**, fetched 2026-10-22, clean starting tree; isolated branch `docs/repo-audit-2026-10-22`.
- Released baseline: `v0.4.0` → `fbcd4fe23bb547ea0befa2097103928579227d25`, published October 4. The previous October 8 audit used `2874cd1`, already later than that tag.
- Compared `git log v0.4.0..origin/main`, merged/open PRs, tracked source/tests/configuration, plans, guides, release workflows, historical reports and local worktree/remote-branch inventories. Previous findings use the supplied read-only vault copy of **Repo audits — 2026-10-08 — Sol 6.1**; no vault files or git state were changed.
- Security coverage is source-level: local HTTP/media/path boundaries, Electron IPC, Pi payload/filesystem access, Lua limits, dependency advisories and a limited tracked-text credential scan. Additional source-only inspection of draft Remote View at **`origin/feat/remote-view` = `2bebe16`** is explicitly labelled below. This is not a penetration test or proof that all paths are safe.
- Not run: Playwright locally, Electron/DMG builds, authenticated model calls, physical-phone/tailnet tests, NLE imports, real-footage quality/performance measurements, history/binary secret scanning, or Python advisory scanning. No dependencies installed. Existing root-checkout `frontend/node_modules` and `backend/.venv` were temporarily linked into this worktree; tests resolve source from this worktree.

### Merged since v0.4.0

PR numbers below link under [the repository's pull requests](https://github.com/evilkels/ai-clip-assembler/pulls?q=is%3Apr+is%3Amerged).

| Milestone / area | Merged PRs | Result on audited main |
| --- | --- | --- |
| Baseline / milestone 0 | #91, #92, #93, #94, #95, #96, #97, #98 | Review project-switch guards, one visible smoothness filter, derived plan lifecycle/index, shared checks, stronger tests, roadmap, glossary and ADRs 0007/0008. #93–95 were merged into #96's branch first. |
| Milestone 1 / plan 037 | #99 | Several windows per steady run, per-video scene quotas, measured 20-second default, draft format changes through the operations core. |
| Milestone 1b / plan 032 | #100 | Absolute media URLs, authoritative empty exports, FCPXML 1.10 DTD fixtures, rational timing, Resolve structural/golden checks. Human NLE gates remain open. |
| Milestone 1c / plan 042 | #102, #103, #104, #105, #106, #107 | Capture-time/nominal-rate fixes; Import progress/posters/layout; transport clock and portrait previews; project-named handoffs, FCPXML default; chronological Suggested cuts; real-footage retest record. Phase 6 and human checks remain open. |
| Separate experiment / plan 043 | #109 | Preserved prototype assets and synthetic browser regression; unchanged polling retains thumbnail nodes; reload bypasses old script cache. |
| Research | #110 | Native iOS feasibility memo; no native iOS product shipped. |

**Not merged into this snapshot:** [#101](https://github.com/evilkels/ai-clip-assembler/pull/101), plan 038 Phases 1–2, was being rebased while this audit ran; [draft #108](https://github.com/evilkels/ai-clip-assembler/pull/108), plan 041, is unfinished. Milestones 3–7 remain future work. Do not count either open PR's code as released or fixed here. Plan 043 is a prototype fix, not the production Remote View feature.

### Test and CI health

Commands ran from `frontend/` unless stated. Wall times measured with `/usr/bin/time -p`; counts are tests, not assertions.

| Gate | Result | Count / time |
| --- | --- | --- |
| `npm run typecheck` | PASS, including regenerated Pydantic type comparison | 0 reported errors; **2.32 s** |
| `npm run lint` | PASS: ESLint and Ruff | 0 reported errors/warnings; **3.55 s** |
| `npm run test:main` | PASS; this is the repo's frontend/main unit command, no separate `test:unit` script | **76 passed**, 0 failed; **1.70 s** wall / 0.448 s Node test runtime |
| `npm run test:backend` | FAIL during collection, existing Python **3.9.6** environment | 407 items collected, **5 collection errors**, 1 skipped; **2.53 s** wall / 2.06 s pytest |
| Same backend command with `-- --continue-on-collection-errors` | FAIL; diagnostic partial execution, not a substitute for full gate | **404 passed, 3 failed, 1 skipped, 5 collection errors**; **7.46 s** wall / 7.08 s pytest |
| Root: `python3 scripts/tests/test_plans.py -v` | PASS | **16 passed**, **1.22 s** wall |
| Root: `python3 scripts/plans.py check` | PASS | 0 reported index/lifecycle errors |
| Root: `python3 scripts/tests/test_site_contract.py -v` | PASS | **7 passed**, **0.04 s** wall |
| Local browser / Playwright | SKIPPED as requested | 0 run |

Four backend collection errors come from missing **`lxml`** (`backend/tests/support.py:5`), despite its pin in `backend/requirements.txt:29`. The fifth is Python 3.9 evaluating `float | None` in `scripts/extraction_stats.py:53`. The three executed failures are `test_video_probe.py`'s QuickTime creation-date/stream-date/ordering cases; compact ISO offsets accepted by newer Python are rejected by this runtime's `datetime.fromisoformat` (`video_probe.py:159`). Developer setup requires Python 3.11 (`docs/DEVELOPER_SETUP.md:56`); CI uses 3.12. Recreate the local environment from existing instructions before treating these as supported-runtime product regressions; this audit installed nothing.

**CI:** [Tests run 39805366014](https://github.com/evilkels/ai-clip-assembler/actions/runs/39805366014) completed **successfully on `2df0169`**: backend **616 passed / 3 skipped in 20.03 s**, main **76 passed**, remote prototype **1 passed in 2.4 s**, browser suite **155 passed in 3.8 min**. The job took **6 min 25 s** including setup. The preceding main run was cancelled by the concurrency policy during successive merges, not a failed test. This independently supplies the supported Python baseline; it does not establish native Electron, packaged-app, editorial quality or real NLE compatibility.

## 2. Status of the fifteen October 8 findings

Numbers preserve the earlier audit's identities. “Fixed” means the cited source/test change exists on main; it does not imply manual NLE validation. Paths below are repository-relative.

| # | Earlier problem | Status | Current evidence / remaining fix |
| --- | --- | --- | --- |
| 1 | Invalid FCPXML asset/format structure | **Fixed in code** | #100; `backend/src/export_engine.py:491–519,546–554` emits unnamed formats and `media-rep`; DTD validation at `backend/tests/support.py:8–13`, regression `test_export_engine.py:122`. Issue #80 stays open for real FCP import. |
| 2 | Empty Timeline resurrects legacy clips on export | **Fixed** | #100; `backend/src/api.py:1434–1435,1479–1480`; `backend/tests/test_api.py:2313` covers all formats without legacy fallback. |
| 3 | Draft/rederive/legacy updates lose to saved document | **Partly** | #99 fixes draft via `controller.apply_batch` at `api.py:815–842`; reopen regression at `test_api.py:2023`. Legacy PUT (`api.py:773–782`) and analysis/rederive finalization (`api.py:749–754`) still invalidate memory; loader prefers saved disk document (`project_store.py:457–461`). Route remaining replacements through one authoritative commit. |
| 4 | Timeline save failure hidden from Editor | **Open** | `api.py:997–1005` logs `OSError` after updating in-memory state; operation still succeeds. Return a visible unsaved/error state and preserve retryable work. Analysis persistence similarly suppresses errors at `api.py:1824–1833`. |
| 5 | Review model blocks async event loop | **Open; #101 pending** | `review_agent.py:512` calls synchronous agent; default uses blocking `subprocess.run` at `861–864`, up to configured 180 s. Move transport off-loop with cancellation and typed failures; verify after #101 merges. |
| 6 | Pi `read` has no Frame Sample allowlist | **Open; #101 pending** | `pi_cli_harness.py:175–200` and `review_agent.py:856–864` expose `read`, repository cwd and inherited environment. Attachments do not constrain subsequent reads. No exfiltration demonstrated. Enforce staged/allowlisted payloads, no unrestricted model file tool, and safe diagnostics. |
| 7 | Scene quota shared across source videos | **Fixed** | #99; `backend/src/assembly_profiles.py:175` keys scene counts by `(file_id, scene_id)` rather than scene alone; cross-file regressions in `backend/tests/test_assembly_profiles.py`. |
| 8 | Rescan empties Review/Timeline UI | **Open** | `ReviewContext.tsx:394–410` in `frontend/src/renderer/src/state/` calls `resetProjectSession`; hydration depends on unchanged `projectId` at `253–278`. Backend explicitly keeps clips at `api.py:384–385`. Preserve session or explicitly rehydrate after rescan. |
| 9 | Late SSE refresh puts A's Timeline into B | **Open** | `ReviewContext.tsx:240–247,294–296` has no active-project guard; sibling mutation/undo paths do. Also guard rescan, rederive and draft completions (`398–406,447–456,467–474`) and overlapping folder opens (`353–363`). Add deferred-response switch regressions. |
| 10 | Fractional rates / mixed-source metadata wrong | **Partly** | #100/#102 fix common rational rates, VFR snapping, FCP source formats and Timeline rate selection. Resolve still writes **sequence** `fps/width/height` into every source file definition (`export_engine.py:388,400–408`). Preserve each source's rate/dimensions and distinguish source in/out frames from sequence placement; test a 24 fps 1080p source in a 59.94 4K sequence, then import it. |
| 11 | Failed AI invents deterministic Versions | **Open; #101 pending** | Failure reply at `review_agent.py:873–878` has no versions/operations; `545–549` fabricates local Versions anyway. Preserve earlier suggestions and display the failure; intentional no-AI recipes should remain explicitly local. |
| 12 | Export receipt survives project switch | **Open** | `frontend/src/renderer/src/routes/Export.tsx:100–104,145–166`; no project-keyed reset or completion guard. Clear/key receipts by project and ignore stale success/error/finally handlers. |
| 13 | One-item replay fails after ending | **Open** | `components/useSequencePlayer.ts:144–145,183–192` under renderer: restart index 0 equals current index 0, so no seek occurs. Seek when ended even if index is unchanged; cover play → end → play for one item. |
| 14 | Codex TOML merge misses equivalent headers | **Open** | `frontend/src/main/mcpConnect.ts:62,72–78,175–179` uses exact header text and appends another table. Quoted/whitespace-equivalent TOML may become invalid. Parse/merge TOML semantically, validate before atomic replacement, retain backup; unit tests currently do not cover this module. |
| 15 | Tracker/plans disagree with roadmap | **Fixed for original scope** | #97/#98; derived index, canonical roadmap order, rewritten 032/035/038/039/040 and `later/`; `scripts/plans.py check` passes. Remaining guide drift and stale individual boxes are separate findings below. |

## 3. New findings, prioritised P1–P3

P1: protect saved work before release. P2: fix before claiming reliable handoff or shipping the affected feature. P3: maintenance/documentation. Confidence is high for source traces and probes below; draft-branch observations are explicitly bounded. S = hours, M = days; risk describes implementing the fix.

### N1 — P1: interrupted saves can destroy the previous valid project state

`backend/src/project_store.py:197–200,254–256,311–314,380–384` writes manifests/results/chat/timeline directly with `write_text`. A partial write or process termination truncates the only copy; loaders return `None` for corrupt timeline/session JSON (`387–395,317–329`), quietly falling back or losing history. This is distinct from old #4's hidden write exception. **Fix:** one same-directory temporary-file + flush + atomic-replace helper, preserve last valid state on failure, propagate actual I/O errors; exercise interruption/error boundaries and reopen. Existing `test_api.py:724` only proves corrupt results are tolerated, not that prior work survives. **M / medium risk.** Draft #108's durable writer is possible shared work, not a fix on main.

### N2 — P1: operations accept non-finite values and persist an unreadable Timeline

`backend/src/timeline_ops.py:216–220` only checks `speed <= 0`, then uses non-validating `model_copy`; `models.py:224–232` also lacks finite checks. Unlike `replace_timeline` (`timeline_ops.py:291`), individual operations accept `NaN`/infinity. Local pure-function probe: `apply_operation(..., 'set_speed', speed=float('inf'))` and `nan` succeed; Pydantic serializes speed as **null**, which cannot reload as a float. HTTP `args` is an unrestricted dict (`api.py:956–959`); numeric overflow such as JSON `1e400` reaches this boundary. **Fix:** finite numeric validation in models and every individual operation before mutation, consistent 422 errors, regression through HTTP/MCP plus save/reopen. Include transform coordinates/scale and target duration. **S–M / low risk.**

### N3 — P2: accepted items can export with zero duration

`export_engine.py:301–304,568–582` quantizes durations without checking a positive frame count; `timeline_ops.py:194–200,216–220` permits arbitrarily short ranges/high positive speeds. Pure-function probe of a 3-second item at 1000×, 30 fps: FCPXML `duration="0s"`, Resolve `<start>0</start><end>0</end>`. A normal-speed sub-frame trim has the same issue. XML structure/DTD checks cannot establish a usable edit. **Fix:** define minimum representable export length; reject with an item-specific actionable error or apply an explicit documented frame-snapping policy. Add boundary tests for all formats and rates, including slow/fast retime. **S–M / medium risk.**

### N4 — P2: FCPXML carries unused footage and takes audio layout from it

`api.py:1433` supplies every imported source; `export_engine.py:505–554,560–562` emits all assets and derives sequence audio from all of them. Probe: exporting only a silent `used.mov` also emits `unused.mov`'s absolute path and sets `audioLayout="surround"` from that unused six-channel file. Empty exports likewise retain library resources. This exposes unnecessary filenames/paths when handing off XML and can create irrelevant media references; it is not a demonstrated unauthorized network read. **Fix:** restrict resources and sequence audio decisions to source IDs referenced by exported Timeline Items; cover unused/missing/empty sources. **S / low risk.**

### N5 — P2: the lockfile has a fresh advisory backlog, including shipped dependencies

`npm audit --json` reports **38 affected package entries: 2 critical, 28 high, 8 moderate** (exit 1, **5.20 s**). `--omit=dev` reports **6: 3 high, 3 moderate, 0 critical** (exit 1, **0.51 s**). These are registry classifications, not 38 proven application exploits. Evidence: `frontend/package-lock.json` entries for Electron **42.4.0**, Vite **7.3.5**, electron-builder **26.8.1**, React Router **7.17.0**, Undici **6.27.0 / 8.5.0**; production chains include Pi, React Router, protobufjs and brace-expansion. Critical dev entries are `shell-quote` and `tar`.

`npm outdated --json` identifies compatible updates including Electron **42.11.18**, Vite **7.3.7**, electron-builder **26.15.3** and react-router-dom **7.18.4**. Pi SDK packages are pinned at **0.80.10**, latest **1.4.0**, requiring a deliberate migration rather than blind `audit fix --force`. Electron is a devDependency but becomes the shipped desktop runtime. React Router's SSR/RSC advisories do not by themselves prove exposure in this client-rendered app. [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) and [Vite advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) were checked against their affected ranges.

**Fix:** triage runtime versus build/dev reachability, refresh compatible patched locks, review Pi/Undici separately, rerun audit and gates, record any justified residuals. Neither `pip-audit` executable nor the venv module exists; Python advisories/outdated status remain **unknown**, not clean. Add that scan in a separately provisioned environment. No npm/pip installs were made here. **M / medium risk.**

### N6 — P2: setup installs a Pi version the app explicitly rejects

`docs/DEVELOPER_SETUP.md:38–42` requires CLI `<1.0.0` but recommends an unversioned global install. Registry metadata now resolves the package to **1.4.0**; `frontend/src/main/reviewModelAuth.ts:174–178` rejects it. A fresh setup following the guide reaches “incompatible.” **Fix:** document a known compatible pinned CLI (currently test contract 0.80.10), or migrate the supported contract; keep the two embedded SDK pins together. This must not accidentally claim roadmap milestone 3's official Codex/Claude connection exists. **S / low risk.**

### N7 — P2: an export receipt can describe a different revision from the file

`frontend/src/renderer/src/routes/Export.tsx:145–160` combines the backend result with `effectiveDuration`/`projectedItems` captured **before** the request. `api.py:1434–1435,1482–1489` exports its current document without an expected revision or returned snapshot. An MCP/GUI edit committed before export handling, or during the overwrite prompt, makes the receipt's payload and effective runtime disagree with the actual XML. This is distinct from old #12's project switch. **Fix:** return the exported revision/projection/effective duration from the backend, or require the requested revision and reconcile on conflict. Test an intervening edit and overwrite retry. **M / medium risk.**

### N8 — P2: importing a large upload blocks the whole API and has no probe deadline

`backend/src/api.py:412–424` is async but copies the full file and runs synchronous FFprobe on the event-loop thread; `video_probe.py:187–200` has no timeout. During slow disk/probe work, progress, cancellation, timeline and health requests cannot be serviced. Main's legacy upload route also has no byte/capacity limit (`api.py:420–421`); do not expose it through Remote View. **Fix:** run copy/probe off-loop, use a bounded probe deadline and explicit upload/disk limits, clean partial files on cancellation/failure. Verify another request can finish while an upload/probe is deliberately paused. **M / medium risk.**

### N9 — P2: “vetted” FFmpeg builds are not reproducible from retained provenance

`.github/workflows/build-dmg.yml:70–80` installs the current Homebrew formula. `frontend/scripts/stage-runtime-tools.mjs:49–84` copies binaries/dylibs, rewrites links, ad-hoc signs, and checks one filter; it checks no pinned source revision/checksum/build manifest. Plan `self-contained-runtime-tools.md:38` explicitly leaves the provenance/source/license package unfinished. **Fix:** finish that task with retained source/build/license records and verified inputs for both architectures; make staging reject incomplete records. This is a missing release artifact/control, not a legal conclusion about compliance. **M / medium risk.**

### N10 — P2, draft #108 only: upload publication still races registry mutation

At **`2bebe16`**, `backend/src/uploads/ingest.py:239–249` iterates live `folder.uploads.values()` while finalization holds the Project lock (`190–201`); recovery holds the folder lock then enters Project work (`431–445,480–481`). Concurrent admission/removal can invalidate the iterator; naively taking the folder lock inside `_taken` risks reversing the recovery lock order. This remains open in that branch's checkpoint review and was rechecked against source here; no live upload test was run. **Fix:** snapshot under a consistent lock order, shorten recovery's folder-lock scope, prove concurrent name collision/publication/recovery with explicit barriers. Keep #108 draft until its physical-iPhone and remaining phase gates pass. **M / medium risk.**

### N11 — P3: documentation mixes current behavior with the target product

| Document / evidence | Drift and concrete correction |
| --- | --- |
| `docs/PRD.md:46,50–52,70–83` | Still promises individual-clip export, default Ollama/MLX inference and old four-pane UI; treats save/load and speed as future. Rewrite current scope versus roadmap; reconcile the unmeasured 1h/10min performance promise. |
| `docs/ARCHITECTURE.md:123–140` versus `api.py:1236–1250` | Claims frontend mocked recipes and no model call for Manual Harness projects. Versions are backend-owned; consent independently gates Review AI, not the selected scoring harness. Correct the runtime flow. |
| `docs/USER_GUIDE.md:162–199` | Mostly honest for current Pi/consent, but omits recent project-named/default-FCPXML and iPhone behavior. Add those; retain Pi instructions until milestone 3 actually lands. |
| `docs/ROADMAP.md:41–53` and `GLOSSARY.md:124–144,215–241` | Roadmap is ordered future scope; glossary's official engines, AI Access, Markers and Story Sections read as existing capabilities. Add explicit implementation-status pointers; mark milestone 1/1b/1c code merged while keeping human gates open. |
| `docs/HARNESS_SPEC.md:106` | Says 12 Candidate Clips per source, code default is 30 (`clip_assembly.py:26`, `api.py:1963`). Correct cap; distinguish current Pi from future official engines. |
| `CONTRIBUTING.md:32` | Lists deleted `scripts/tests/test_release_workflow.py`; actual CI uses actionlint and plan checks. Remove the dead command, document plan-index and remote-prototype gates. |

**Fix:** one documentation reconciliation against this pinned commit and merged plans; do not tick future implementation to make prose agree. **M / low risk.**

### N12 — P3, draft #108 only: registry regression relies on a one-second schedule window

At `2bebe16`, `backend/tests/test_uploads_tus.py:615–624` calls `mutation_attempted.wait(1)` and ignores the result before continuing the live iterator. This can miss the intended interleaving and violates the repo's behavioral test standard; it is already an unresolved checkpoint objection. **Fix:** explicit handshake/barrier for snapshot acquisition versus attempted mutation; demonstrate failure on pre-fix source without inspecting private locks as the primary assertion. **S / low risk.**

### Security boundary observations and limits

- **Secrets:** tracked-text pattern scan found no apparent live credential/private-key material. Its sole OpenAI-pattern match was the ordinary `task-4-review-…png` screenshot filename (`frontend/e2e/compare-versions.spec.ts:543`). `.env.example` has configuration defaults only. This excludes git history, ignored files and binaries; no real auth stores were opened.
- **Paths:** uploads strip directory components (`api.py:417`); manifests reject absolute/nested names (`project_store.py:65–72`); poster lookup resolves and checks sample-root containment (`api.py:1128–1145`). `delete_project_files` recursively removes whole `clipassembler/` and `exports/` directories (`project_store.py:171–178`); preserve the documented ownership boundary, and consider an ownership marker before deleting a pre-existing exports folder. No cross-user path exploit was established.
- **Desktop HTTP:** loopback is the intended boundary, not authentication. API allows Origin `null` and localhost dev origins (`api.py:108–115`) with no per-process credential. Sandboxed web content can also have a null origin; browser private-network restrictions and port reachability need controlled validation before claiming a browser attack. Before broader exposure, require a desktop capability and exact origin/host policy; never forward `/mcp`, `/settings` or filesystem routes remotely.
- **Electron IPC:** context isolation, no Node integration, sandbox and deny-new-window are enabled (`frontend/src/main/index.ts:436–456`). Sender checks are uneven (`126–130,137–149,217–248`), and there is no `will-navigate` guard. Add exact main-frame/origin checks to privileged handlers and deny unexpected navigation before adding remote content. No renderer compromise or privilege escalation was reproduced; this is a boundary-validation item.
- **Plans 041/043:** main contains only synthetic prototype assets/tests, not a production remote listener. Draft #108 uses a separate loopback listener (`remote/lifecycle.py:109–112`), ingress capability, identity/session gates, exact Origin/CSRF (`remote/app.py:120–150,264–295`), exposure and per-device ownership checks, secure cookies, body limits and no forwarding to desktop APIs. These are real source controls, not proof of deployed Tailscale configuration. Its checkpoint's earlier five defects are recorded as repaired; N10/N12 remain. Prototype `app.js:62–66` has neither production CSRF nor the production API contract: do not reuse it as a secure production client without implementing those gates.

## 4. Cleanup inventory and recommended actions

Inventory only: nothing deleted, moved or reset. Remote/API branch listing was checked against local refs; concurrently active worktrees were not inspected for contents.

| Item | Evidence / state | Recommended action |
| --- | --- | --- |
| Remote merged branches | `gh api .../branches` lists only `main`, `feat/038-honest-ai-errors`, `feat/remote-view`; `git branch -r --merged origin/main` contains only main/HEAD. | **No merged remote branches to delete.** Old PR branch names are historical, not present refs. |
| `feat/038-honest-ai-errors` | Open #101, remote tip dated October 9; fetched ref 54 behind / 13 ahead of audited main; active local rebase. | **Keep**, owner/parent handles rebase and merge. Age does not imply abandoned. |
| `feat/remote-view` | Draft #108, October 10 `2bebe16`, 13 behind / 17 ahead of audited main. | **Keep as checkpoint**, resolve N10/N12 and unfinished plan 041; explicitly decide whether to resume or park. Do not merge just to clean the branch list. |
| Root checkout | `/Users/elvijs/DEV/personal/ai-clip-assembler`, main | **Keep**, canonical checkout and existing dependencies. |
| `.worktrees/038-honest-ai-errors` | Active #101; HEAD changed during inventory | **Keep, leave to its agent.** |
| `.worktrees/okf-docs` | Active `docs/okf-profile`, appeared during inventory | **Keep, leave to its agent.** |
| `.worktrees/audit-2026-10-22` | This review branch | **Remove only after this PR is merged** and no further audit work is needed. |
| `.worktrees/.DS_Store` | Untracked local Finder metadata, not a worktree | **Delete opportunistically** after active work; no git history impact. |
| `.superpowers/` | Root checkout has ~6.8 MB ignored scratch; none tracked. PR #104 moved retained SDD review records into `docs/reviews/`. | **Delete disposable local scratch after owner confirms no needed evidence**; keep migrated review records. `frontend/e2e/compare-versions.spec.ts:528–545` still writes a historical screenshot here: replace with test output/artifact attachment. |
| `brag-output/` | Not present in root checkout; ignored at `.gitignore:199`. | **No deletion needed**; keep ignore. |
| Pi provider/settings/auth code | `pi_cli_harness.py`, `app_settings.py`, `frontend/src/main/{reviewModelAuth,piExecutable}.ts` and SDK dependencies are active; `harness/pi_agent/config.json` explicitly says reference-only, with no runtime reader found. | **Keep live Pi code until official Codex works**, then remove together per milestone 3. Keep/label the reference config or remove it with the migration; fix `harness/README.md`'s nonexistent pluggable-directory/registry instructions. |
| Qwen remnants | No Qwen implementation/dependency found; `REMOVED_HARNESS_IDS` and migration test remain (`project_store.py:30,91–95`, `test_api.py:1807`). | **Keep migration compatibility**, preserve historical docs; do not resurrect provider flags. |
| `/playwriter` fixture route / mock clips | `frontend/src/renderer/src/App.tsx:6,21`, `routes/PlaywriterQa.tsx:49–74`; mock fallback explicitly retained in API client. | **Gate fixture route to development/test builds**; retain useful tests, inspect fallback before deleting. No production data leak established. |
| Model README / stale references | `backend/models/README.md` points to moved 018/025 paths and already admits missing redistribution analysis. | **Repair links** to `docs/plans/done/018…` and `docs/plans/later/025…`; retain model/licensing decision. No bundled model claimed. |

### Historical HTML: link status and continued relevance

Search covered tracked text references by filename/path, excluding self references; this cannot establish external links/bookmarks. Keep dated evidence as history rather than treating its screenshots/test counts as today's acceptance proof.

| File | Inbound references / truth now | Recommended action |
| --- | --- | --- |
| `docs/reviews/2026-08-10-authoritative-timeline-items.html` | Linked from done/020 at lines 273,336. Repeated-item/authoritative-document design still applies; old counts and visual state are historical. | **Keep**, label/index as historical; current regressions supersede its verification claim. |
| `docs/reviews/2026-08-10-truthful-export.html` | Linked from done/021 at 220,263. Backend-authoritative export remains true; plan 032 and this audit supersede compatibility evidence. | **Keep**, historical; link newer export review. |
| `docs/reviews/2026-08-11-project-shell-header.html` | No tracked inbound filename/path reference. Header/rename work exists; document itself describes an August 12 run. | **Archive/index as historical**, preserving its evidence; do not delete solely for being unlinked. |
| `docs/reviews/2026-08-14-studio-workflow-redesign.html` | Linked from done redesign plan at 474,517 and SDD `progress.md:37`. Claim of no poster backend is superseded by current poster endpoint. | **Keep**, historical, add supersession pointer rather than “fixing” dated results. |
| `docs/design/2026-09-01-landing-page-reference.html` | Linked by done landing/literal plans, September review and spec. Reference design remains an input, not proof of implementation. | **Keep**; optionally consolidate singular `design/` into `designs/` with all links updated in a separate PR. |
| `docs/designs/ui-shell-themes.html` | No tracked inbound reference; alternate shell explorations predate the chosen redesign. | **Archive** with an exploration label or **delete after explicit owner decision** if no design value remains. |
| `docs/designs/remote-view/prototype/index.html` (+ JS/CSS/icon/README) | Used by `frontend/e2e/remote-prototype-refresh.spec.ts:5`, plan 043. Polling regression depends on it. | **Keep active as prototype/test fixture**; no production readiness implied. |

### Plans outside `done/`

`scripts/plans.py check` passes: **no fully closed plan is stranded outside `done/`** under current rules. Implementation-complete but human-gated plans are **032 (15/15, five human), 035 (7/7, one), 037 (15/15, one), 043 (4/4, one), drone-workflow QA (2/2, five)**: keep them active until genuine owner acceptance, then use `scripts/plans.py sync` to move/relink.

Plan **036 task 3.5** remains unchecked although `update-linux-baselines.yml` exists and prior merges carry Linux baselines; confirm its required stale-branch dispatch proof, then tick the task. Its two human checks still prevent closure. **042 is 11/14**, with three Phase 6 enhancements and two human tasks; **029,031,landing,self-contained-runtime-tools** also retain real work. Do not move these to done based only on merged PR titles. Draft branch plan **041 is absent from main intentionally**; it belongs with #108 until integration. Already-closed `done/028` is explicitly superseded, not an implemented Find More feature.

## 5. Release readiness

### Version recommendation and bump map

Recommend **v0.5.0**, not v0.4.1: multi-window extraction, a new longest-clip default, authoritative draft replacement, stronger export behavior and broader iPhone workflow support materially change the user's first cut/handoff. If #101 lands, it also introduces the typed AI boundary and changes failure behavior. A patch number would suit a narrow backport containing only bug fixes; pre-1.0 SemVer permits evolution, but a minor bump communicates this accumulated scope better. Neither number implies v1.0's signed build or official-provider UX is ready.

| Location | Required release update |
| --- | --- |
| `frontend/package.json:3` | Set `0.5.0`; electron-builder, `app.getVersion()` and renderer build version derive from it. |
| `frontend/package-lock.json:3,9` | Update top-level and root-package version via `npm version 0.5.0 --no-git-tag-version` from frontend. Do not hand-edit all dependency versions. |
| `backend/src/api.py:98` | Set `APP_VERSION = "0.5.0"`; this is the backend version source, no separate version file. |
| `site/index.html:1117–1120,1143–1146,1308–1311` | Six versioned DMG links must move together to `v0.5.0` / `AI.Clip.Assembler-0.5.0-{arm64,x64}.dmg`; site contract test checks against package version. Coordinate public links with asset availability. |
| `.github/workflows/build-dmg.yml:38–52` | No version literal to bump: tag must equal **both** package version and `APP_VERSION`. |
| Release record | Tag `v0.5.0`, matching GitHub Release title/notes and QA records; old historical examples/fixtures are not mass-replaced. |

### Documented procedure and missing automation

`docs/UPDATING.md:59–71`: bump frontend and backend together → merge release PR to main → tag merged commit → push tag. `build-dmg.yml` builds arm64 on macos-15 and x64 on macos-15-intel, stages FFmpeg, builds PyInstaller backend, checks packaged script worker, builds frontend and packages DMGs. Each successful architecture independently uploads its artifact and attaches it to a GitHub Release with generated notes. `workflow_dispatch` can build a candidate **before tagging** without publishing a release.

`CONTRIBUTING.md` calls for lint/typecheck/backend/main/browser gates plus manual export validation; its deleted-command drift is N11. Build/tag workflow itself runs neither the unit/browser suite nor a check that the tag commit passed main CI: require a successful exact-commit Tests run in the release checklist, preferably automate it. Check **both DMG jobs/assets** because independent publication can expose a release with only one architecture. Current updates are a notice plus manual `app-wizard.sh` install, not automatic in-place updates; builds remain unsigned/unnotarized by design until milestone 7.

### Draft v0.5.0 release notes

- **Milestone 0 — maintenance:** unified verification gates, stronger regression coverage and generated plan status; Review no longer applies several late chat/undo/edit responses to another project; smoothness filtering is view-only and defaults to showing all clips.
- **Milestone 1 — better first cuts:** several Candidate Clips from a steady section, longer clips up to the adopted 20-second default, separate scene quotas per Source Video, and Short/Medium/Long changes that update the saved Timeline.
- **Milestone 1b — editing-app handoff:** FCPXML 1.10 resources validated against Apple's DTD; exact common fractional rates; absolute media links; export reads the Timeline even when empty; stronger Resolve XML checks. **Publish compatibility claims only to the level verified in the manual checks below.**
- **Milestone 1c — iPhone footage:** recording-time shooting order and nominal-rate handling; upright portrait previews; per-file Analyzed status and poster recovery; corrected transport clock; project-named exports with FCPXML preselected and clearer source-media duration copy.
- **Milestone 2 — conditional:** include honest AI failure/payload changes **only after #101 merges and is verified on the release commit**. Do not advertise Claude Code/Codex connection wizard or Pi removal; those are milestone 3.
- **Experiment/docs:** prototype refresh stability and native iOS research. No production Remote View/upload or native iOS app included.
- **Known limits:** unsigned Mac builds, manual updates; EDL flattens retime/transform; moving footage requires a fresh XML export or relinking; deferred Story/Find More/provider features remain future. Resolve mixed-source metadata and this review's unresolved defects require explicit release decisions.

### Owner checks before tagging

1. Build candidate DMGs from the exact proposed release commit via workflow dispatch. Install matching arm64/x64 builds on clean Macs; no developer FFmpeg/Python/Pi required for the no-AI workflow (runtime plan H1). Verify app/backend version and update notice/wizard path.
2. Run Estepona plus fresh iPhone H.264 and **High Efficiency HEVC/HDR** through Import → Analyze → Review → Timeline → Export. Check editorial quality, target fill, shooting order, portrait framing, HDR samples/posters, source sound, repeated items, trim/split/speed/transform, save/reopen, rescan and one-item replay. Recheck all changed behavior after fixes.
3. **Final Cut Pro / issue #80:** import fresh FCPXML from the packaged build with the reporter's mixed 3840×2160 60/30-style case and portrait 59.94 footage; no schema/format warning or manual XML repair. Check media online without relink, order, in/out, total duration, retime, transforms, orientation and audio. Record FCP/app versions and date; keep #80 open until that succeeds, then reply with the release build for reporter retest.
4. **DaVinci Resolve:** import Resolve XML from the same fixtures plus mixed rates/resolutions; verify source metadata, audio channels, retime, crop, repeated items and total duration. EDL remains best-effort with explicit flatten warnings. Move the project folder, reopen/re-export, and confirm fresh exports link correctly; old absolute-path exports may need relink.
5. Complete plan 040's packaged Lua-script checklist and keyboard-only navigation; record plan 032/037/042 human results honestly. If #101 is included, exercise provider unavailable/limit/auth/network cases with earlier suggestions preserved and verify the allowed outgoing payload. These checks need the owner; none was performed here.

## 6. Recommended order of the next ten actions

1. Finish #101's rebase/review and verify its exact merged SHA; reclassify old #5/#6/#11 from evidence, not planned merge time. Restore a Python 3.11/3.12 local environment with declared requirements so local gates are usable.
2. Fix durable saves: old #4 + N1, atomic writes and honest failure handling, with reopen/failure proof.
3. Complete old #3 for legacy/rederive/analyze replacements; one authoritative Timeline commit, saved-state precedence regression, no lost manual edits.
4. Reject non-finite operation arguments (N2) and define positive-frame export behavior (N3); cover individual operations, HTTP/MCP, persistence and all formats.
5. Fix old #8/#9/#12 project/rescan completion guards, N7's exported snapshot receipt, and old #13's one-item replay; use controlled delayed-response tests.
6. Finish Resolve source/sequence separation (old #10) and limit FCP resources to referenced media (N4); add mixed-source/unused-source artifact regressions.
7. Triage and refresh dependency locks (N5), fix incompatible Pi setup (N6), provision Python advisory scanning, and finish FFmpeg provenance (N9); run full CI and candidate DMG builds.
8. Perform the owner NLE/real-footage/packaged checks above; record #80 retest and Resolve results before compatibility claims. Address blocking import/probe work (N8) and Codex TOML merge (old #14) before shipping those paths as reliable.
9. Reconcile current-versus-target docs (N11), confirm 036/3.5 dispatch proof, index/archive old reports, remove disposable scratch only when safe; leave active worktrees/branches alone. Resume #108 only with N10/N12 resolved and its own gates.
10. Prepare the **v0.5.0** bump/notes PR, verify every version/link and exact-commit CI result, merge to main, then tag and confirm both DMGs. Continue roadmap milestone 3 afterward; do not substitute the Remote View experiment for the agreed sequence without an owner decision.
