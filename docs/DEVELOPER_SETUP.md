# Developer Setup

How to set up a local development environment, run both halves of the app, and
run the test suites. Target platform is macOS.

## Prerequisites

```bash
# Toolchain
brew install python@3.11 node

# FFmpeg with the vidstabdetect filter (required for local development motion analysis)
brew install ffmpeg
ffmpeg -hide_banner -filters | grep vidstabdetect   # must print a line
```

If the grep prints nothing, your `ffmpeg` bottle was compiled without
`libvidstab` (confirm: `ffmpeg -version` shows no `--enable-libvidstab` in the
`configuration:` line). **`brew reinstall ffmpeg` will not fix this** — it
reinstalls the same prebuilt bottle. Replace it with a source build from the
homebrew-ffmpeg tap:

```bash
brew uninstall ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libvidstab
ffmpeg -hide_banner -filters | grep vidstab   # must list vidstabdetect + vidstabtransform
```

Release DMGs do not use this developer setup. CI stages a private FFmpeg runtime
with `vidstabdetect` into each architecture-matched application bundle, then
the Electron main process verifies it before starting the packaged backend.

The tap builds from source; expect 10–30 minutes. `brew options
homebrew-ffmpeg/ffmpeg/ffmpeg` lists further optional codecs.

The AI harness uses the [`pi`](https://github.com/earendil-works/pi-mono) CLI.
The desktop authentication integration pins both `@earendil-works/pi-ai` and
`@earendil-works/pi-coding-agent` to exactly `0.80.10`; keep those production
dependency versions in lockstep. Install a compatible CLI (0.73.1 or newer,
but earlier than 1.0.0):

```bash
npm install -g @earendil-works/pi-coding-agent   # provides the `pi` binary
pi --version
```

For normal development, launch Electron and use **Settings → Connections →
Review model account → Sign in**. Electron main opens the system browser and
owns the callback listener on `127.0.0.1:1455`; credentials are stored through
Pi in `~/.pi/agent/auth.json`. Running `pi /login` in a terminal is an advanced
fallback for debugging the same shared Pi credential store, not a separate app
account.

Never use a real `auth.json` as a test fixture, print it, copy it into the repo,
or commit it. Main-process auth tests must use the in-memory/fake credential
store and synthetic token values already used by the test suite.

## Backend (FastAPI)

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Run the API (http://127.0.0.1:8000)
.venv/bin/uvicorn src.api:app --reload --port 8000
```

Key environment variables (see `.env.example`): `PI_BIN`, `PI_PROVIDER`,
`PI_MODEL`, `PI_TIMEOUT_SEC`. The backend loads a repo-root `.env` automatically
on startup (python-dotenv), and shell variables take precedence over `.env`
values. It also inherits its environment when spawning `pi`, so provider
credentials configured for the `pi` CLI are picked up automatically.

### Backend tests

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest
```

Run the backend tests from `backend/` so `PYTHONPATH=.` resolves the `src`
package consistently. Equivalent npm script: `npm run test:backend` from
`frontend/`.

### End-to-end check (synthetic footage, real pipeline)

```bash
# from the repo root; needs ffmpeg with vidstabdetect in PATH
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

Generates synthetic smooth/shaky/mixed footage and runs the whole folder
workflow in-process: create-from-folder, analysis, smooth-vs-shaky clip
discrimination, timeline edit, all three exports (relative media paths), and
close/reopen state restore. Takes about a minute.

## Frontend (Electron + React + Vite)

```bash
cd frontend
npm install

# Run the desktop app in dev mode (expects the backend on :8000)
npm run dev

# Or run frontend + backend together
npm run dev:with-backend
```

### Frontend checks

```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run test:main   # Electron main-process unit tests
npm run build       # electron-vite production build
```

Renderer behavior is covered by focused Playwright specs; Electron main-process
logic uses Node's test runner through `npm run test:main`. Run both the relevant
focused test and `typecheck` + `build` for frontend changes.

## Project layout

```
backend/src/
  api.py                 FastAPI endpoints (projects, upload, analyze, timeline, export, harnesses)
  video_probe.py         ffprobe metadata
  frame_extraction.py    sampled frame extraction
  motion_analysis.py     ffmpeg vidstabdetect motion stability
  scene_detection.py     PySceneDetect scene boundaries
  quality_scoring.py     blur/exposure/contrast scoring
  clip_assembly.py       rule-based candidate clip assembly
  pi_cli_harness.py      DEFAULT AI harness — drives the `pi` CLI
  local_qwen_harness.py  POSTPONED local Ollama/Qwen harness (kept, disabled)
  export_engine.py       FCPXML / EDL / DaVinci (FCP7 XMEML) generation
  project_store.py       folder projects: manifest + persisted analysis results

frontend/src/renderer/src/
  routes/                Import, Review, Timeline, Export pages
  components/            ClipCard, ScoreChip, Timeline
  state/ReviewContext    shared review/timeline state (accepted order, trims)
  api/client.ts          backend HTTP client (+ mock fallback)
```

## Architecture overview for contributors

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and
[HARNESS_SPEC.md](HARNESS_SPEC.md) for the pluggable AI-harness contract
(input/output JSON, registration, fallback behavior). Domain language and agent
conventions live in [agents/domain.md](agents/domain.md) and `AGENTS.md`.

Workflow conventions: GitHub Issues track work (labels per
[agents/triage-labels.md](agents/triage-labels.md)); changes land via PRs against
`main`; all plans live under `docs/plans/` (index and statuses in
`docs/plans/README.md`), and completed ones move to `docs/plans/done/`. See
`docs/README.md` for the full docs layout.
