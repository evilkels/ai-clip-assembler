# Plan 003: Spike — bundle the FastAPI backend into the packaged Electron app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a39ed1..HEAD -- frontend/src/main/index.ts frontend/package.json backend/src/api.py backend/requirements.txt`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3 (gated: start only after plan 001's validation session confirms the workflow delivers value)
- **Effort**: L (this spike: M; productionizing is a follow-up plan)
- **Risk**: MED (build tooling, native deps, process lifecycle)
- **Depends on**: 001 (sequencing dependency, not technical)
- **Category**: direction
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

`npm run dist` builds a DMG containing only the Electron shell. The FastAPI backend exists solely as a dev process started from the repo venv (`frontend/package.json:10`), and the Electron main process never spawns it. A non-developer who installs the DMG gets an app whose every API call to `http://127.0.0.1:8000` fails — the product is currently un-shippable, and the PRD's core adoption metric ("time to first export < 15 minutes for a new user", `docs/PRD.md:159`) is unreachable. This spike answers, with a working prototype on the dev machine: **can we produce a single DMG where the app launches its own backend**, which bundling approach to use, and what the known landmines cost. The deliverable is a decision document plus a throwaway prototype branch — not production packaging.

## Current state

Relevant files:

- `frontend/src/main/index.ts` — Electron main process. Registers project-folder IPC handlers and creates the window; **contains no backend spawning whatsoever**. Dev/packaged split is `const isDev = !app.isPackaged;` (line 5); packaged builds load `../renderer/index.html` (line 133).
- `frontend/package.json` — `"dist": "npm run build && electron-builder"`; the `build` config block (appId `com.evilkels.ai-clip-assembler`, mac dmg target) has **no `extraResources`** and nothing backend-related.
- `frontend/src/renderer/src/api/client.ts:34` — backend URL: `window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000'`. So the renderer already supports an injected URL; the preload (`frontend/src/preload/`) is where `clipAssembler.backendUrl` would be exposed.
- `backend/src/api.py` — FastAPI app served by uvicorn. Run today as `PYTHONPATH=. .venv/bin/uvicorn src.api:app --reload --port 8000` from `backend/`.
- `backend/requirements.txt` — includes `opencv-python==4.11.0.86`, `numpy==2.0.2`, `scenedetect`, `pillow` → a bundled backend will be large (likely 200–400 MB); that's acceptable for a video tool, but measure it.

Known landmines, found during the audit — the spike must address each in the decision doc:

1. **CWD-relative project dir**: `backend/src/api.py:76` — `PROJECTS_DIR = Path(".ai-clip-assembler/projects")`. A packaged app's CWD is `/` (not writable). Legacy upload-style projects write there; folder projects write into the user's chosen folder. The spawned backend must be given an explicit, writable CWD (e.g. Electron's `app.getPath('userData')`), or this becomes a follow-up fix.
2. **CORS origin allowlist**: `backend/src/api.py:69` — `allow_origins=["http://localhost:5173"]`. A packaged renderer is loaded via `loadFile` (origin `file://` → browsers send `Origin: null` or omit it). Verify whether requests pass; if not, the spawned backend needs a flag/env to accept the packaged origin.
3. **PATH for external binaries**: the backend shells out to `ffmpeg`/`ffprobe` (frame extraction, vidstab, probe) and optionally the `pi` CLI. macOS GUI apps launched from Finder get a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) — Homebrew's `/opt/homebrew/bin` is NOT on it. The prototype must demonstrate ffmpeg discovery (inherit-and-extend PATH when spawning, or an explicit `FFMPEG_PATH`-style setting). Note also the vidstab constraint: stock Homebrew ffmpeg lacks `libvidstab` (`README.md:23-36`); bundling ffmpeg means bundling a vidstab-enabled build — out of scope for the spike, but the doc must state the chosen direction.
4. **`.env` loading**: `backend/src/api.py:22` calls `load_dotenv()` — CWD-relative, so it silently no-ops in a packaged app. PI_* config must arrive via the spawn environment instead.

Repo conventions: TypeScript in `frontend/src/main` is plain electron code (see excerpt style in `index.ts`); conventional commits; branch naming `feature/<slug>`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Frontend build | `cd frontend && npm run build` | exit 0, writes `frontend/out/` |
| Package DMG | `cd frontend && npm run dist` | exit 0, DMG in `frontend/dist/` |
| Backend boots (dev) | `cd backend && PYTHONPATH=. .venv/bin/uvicorn src.api:app --port 8765` then `curl -s http://127.0.0.1:8765/` | JSON greeting from `/` |
| Backend tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` | all pass |
| PyInstaller (after install in venv) | `cd backend && .venv/bin/pyinstaller --noconfirm packaging/backend.spec` | `backend/dist/` bundle created |

Note: installing PyInstaller into `backend/.venv` and running builds writes
only inside `backend/` ignored dirs and `frontend/dist|out` — acceptable for
this spike, since an executor branch is expected to build artifacts. Do not
add PyInstaller to `requirements.txt` (keep it a dev-only install) unless the
decision doc recommends it for CI.

## Scope

**In scope** (files you may create or modify, all on the spike branch):
- `backend/packaging/backend.spec` + `backend/packaging/entry.py` (create — PyInstaller entry that runs `uvicorn` programmatically: `uvicorn.run("src.api:app", host="127.0.0.1", port=<from env>)`)
- `frontend/src/main/index.ts` — prototype backend spawn/health-check/kill (clearly commented as spike code)
- `frontend/src/preload/**` — expose `clipAssembler.backendUrl` if needed for a non-8000 port
- `frontend/package.json` — `extraResources` entry pointing at the PyInstaller output
- `docs/superpowers/specs/<YYYY-MM-DD>-backend-packaging-design.md` (create — the decision doc; the durable deliverable)
- `docs/plans/README.md` (status row update)

**Out of scope** (do NOT touch):
- `backend/src/api.py` and any backend source — landmines 1, 2, 4 get *documented with proposed fixes*, not fixed; keep the spike's blast radius in packaging/spawn code. (If CORS hard-blocks the prototype, note the one-line origin addition you *would* make in the doc and STOP rather than editing api.py.)
- Code signing / notarization — document as follow-up; unsigned local DMG is fine for the spike.
- Windows/Linux packaging.
- Bundling ffmpeg or the `pi` CLI into the app — direction goes in the doc only.

## Git workflow

- Branch: `feature/packaging-spike` — **all prototype code stays on this branch**; only the decision doc is expected to be cherry-picked/merged later.
- Conventional commits (`feat:`, `chore:`, `docs:`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Prove the backend runs as a PyInstaller binary

Install PyInstaller into the backend venv (`backend/.venv/bin/pip install pyinstaller`). Create `backend/packaging/entry.py` (programmatic `uvicorn.run`, port from `CLIP_ASSEMBLER_PORT` env var, default 8000) and `backend/packaging/backend.spec` (onedir mode — faster startup and easier debugging than onefile; include `src/` as the import root; collect opencv/scenedetect data files via PyInstaller hooks as needed).

**Verify**: `cd backend && CLIP_ASSEMBLER_PORT=8765 ./dist/entry/entry` (exact path per spec output) then `curl -s http://127.0.0.1:8765/` → the API greeting JSON; `curl -s -X POST http://127.0.0.1:8765/projects` → creates a project (exercises imports beyond the entry module). Record bundle size: `du -sh backend/dist/*`.

### Step 2: Spawn the backend from Electron main when packaged

In `frontend/src/main/index.ts`:

- When `app.isPackaged`: locate the bundled binary under `process.resourcesPath` (matching the `extraResources` config from step 3), pick a free port, spawn with `child_process.spawn`, env extended with `CLIP_ASSEMBLER_PORT`, PATH extended with `/opt/homebrew/bin:/usr/local/bin` (landmine 3), and CWD set to `app.getPath('userData')` (landmine 1 mitigation without backend changes).
- Health-check loop: poll `http://127.0.0.1:<port>/` until 200 or 15 s timeout; on timeout show a `dialog.showErrorBox` and quit.
- Kill the child on `app.on('will-quit')` (and guard against orphans: `child.kill()` plus a `process.on('exit')` fallback).
- When not packaged: current behavior unchanged (dev backend started by `npm run dev:with-backend`).
- Expose the chosen port to the renderer via the preload's `clipAssembler.backendUrl` (renderer already prefers it — `client.ts:34`).

**Verify**: `cd frontend && npm run typecheck` → exit 0. Dev behavior unchanged: `npm run dev` still loads against a manually started backend.

### Step 3: Wire `extraResources` and build the DMG

Add to `frontend/package.json` `build` config:

```json
"extraResources": [{ "from": "../backend/dist/entry", "to": "backend" }]
```

(adjust `from` to the actual PyInstaller output dir). Build: `npm run dist`. Install the DMG (or run the packaged `.app` from `frontend/dist/mac*/`), launch from **Finder** (not a terminal — that's the PATH test), and exercise: create a folder project from a small real or synthetic footage folder → run **manual**-harness analysis → check Review Board renders clips → export DaVinci XML.

**Verify**: packaged app completes the manual-harness flow end to end. Record in the doc: DMG size, cold-launch-to-healthy-backend time, whether CORS (landmine 2) blocked anything and the observed `Origin` header behavior, whether ffmpeg was found via the extended PATH.

### Step 4: Write the decision doc

`docs/superpowers/specs/<date>-backend-packaging-design.md` with sections:

1. **Approach compared**: PyInstaller onedir (prototyped) vs. python-build-standalone + venv vs. "require user-installed Python" — recommend one with the measured numbers (bundle size, launch time, build complexity).
2. **Landmine dispositions**: each of the four landmines above → observed behavior in the prototype + the precise production fix (file:line) it implies.
3. **External binaries strategy**: ffmpeg-with-vidstab and `pi` CLI — bundle vs. detect-and-guide; recommendation and rationale (note `README.md:23-36`: stock Homebrew ffmpeg lacks vidstab, so "detect-and-guide" needs a first-run check UI eventually).
4. **Production checklist**: signing/notarization, crash/orphan handling, port collision policy, auto-update implications, CI build — each one line, sized S/M/L.

**Verify**: `grep -c '^## ' docs/superpowers/specs/*backend-packaging-design.md` → ≥ 4.

## Test plan

Spike — no production tests. Gates instead:

- `cd frontend && npm run typecheck` → exit 0 (spawn code compiles).
- `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` → still all pass (no backend source changed).
- The step 3 packaged-app manual flow is the spike's real test; its outcome (pass/fail per landmine) goes in the decision doc.

## Done criteria

ALL must hold:

- [ ] Decision doc exists with the four sections, containing measured DMG size and launch time
- [ ] Spike branch contains: `backend/packaging/{entry.py,backend.spec}`, spawn logic in `frontend/src/main/index.ts`, `extraResources` in `frontend/package.json`
- [ ] `cd frontend && npm run typecheck` exits 0 on the branch
- [ ] `git diff --name-only main...HEAD` shows changes ONLY to in-scope files
- [ ] Backend test suite still green (no backend source modified)
- [ ] `docs/plans/README.md` status row updated (DONE if the packaged flow worked; BLOCKED with the failing landmine named if not)

## STOP conditions

Stop and report back (do not improvise) if:

- PyInstaller cannot bundle opencv/scenedetect after two reasonable attempts at hook fixes — record the exact error in the doc; the python-build-standalone alternative becomes the follow-up, don't start it in this spike.
- The packaged renderer's requests are CORS-blocked (landmine 2 confirmed) — document the required one-line backend change and stop; backend edits are out of scope.
- `electron-builder` fails on machine-level config (signing identities, missing Xcode tools) you cannot resolve locally.
- The prototype needs changes to `backend/src/api.py` for anything beyond CORS — list them in the doc instead of making them.

## Maintenance notes

- This spike's spawn code is prototype-grade: no retry/backoff, no port-collision handling, no telemetry. The production plan must replace, not extend, it.
- If plan 001's validation session fails the speed criterion, packaging priority drops further — re-check sequencing before productionizing.
- The `extraResources` path couples the frontend build to a prior backend PyInstaller build; the production plan needs a single orchestrating script (likely under `scripts/`) so `npm run dist` can't silently ship a stale backend.
- Whoever reviews the eventual production PR should scrutinize child-process cleanup on crash (orphaned uvicorn keeps port 8000 busy and breaks the next launch) and the CWD choice for `PROJECTS_DIR` (landmine 1) — the right production fix is making that path explicit in backend config rather than CWD-dependent.
