# Manual QA Launch Guide

macOS session: import → analyze → review → edit → export, including external
MCP and in-app review agents. Use `VALIDATION_RUNBOOK.md` for measured Flow F
and `QA.md` for bugs.

## Product contract

Folder projects keep media in place and state under `clipassembler/`. Manual
Harness is local/default; consented `pi_agent` adds cloud visual scoring and
falls back per video. Timeline Document ownership and undo/redo live in the
backend Operations core; GUI and `/mcp` edit that same state over SSE. FCPXML
and Resolve XML preserve speed/transform; EDL flattens and warns.

## Setup and launch

```bash
brew install python node ffmpeg
ffmpeg -hide_banner -filters | grep vidstabdetect
# If absent: brew uninstall ffmpeg; brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libvidstab
cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
cd ../frontend && npm install && npm run typecheck && npm run build
npm run dev:with-backend
```

Confirm ffmpeg/ffprobe, Python 3.9+, Node/npm versions, and `vidstabdetect` in
the launching shell. For Pi, install a compatible CLI and normally sign in via
**Settings → Connections → Review model account**; `pi /login` is the advanced
fallback. The backend reads `PI_PROVIDER`, `PI_MODEL`, `PI_BIN`, and
`PI_TIMEOUT_SEC` from root `.env`.

## Folder-project flow

1. Import → Create/Open Folder Project; choose top-level MP4/MOV/MKV footage.
2. Confirm source list and `clipassembler/{project.json,samples,analysis,cache}`
   plus `cache/.nosync`; choose Manual or Pi and Analyze.
3. Confirm samples, motion outputs, and Pi cache when used; accept clips.
4. Export EDL/FCPXML/Resolve XML and confirm `exports/{edl,fcp,davinci}` paths.
5. Move/rename the folder; old recent entry shows missing; Locate reopens it
   without replacing sources. Rescan adds new videos once and keeps old ones.
6. Remove recent without touching media. Delete project files removes only
   `clipassembler/` and `exports/`, never sources. Verify overwrite cancellation.

## Pi harness and account

Analyze with authenticated Pi: candidates gain visual interest and a Clip
Reason. Set `PI_BIN=/bin/false`, reanalyze, and confirm per-video Manual fallback
with warning. Local Qwen remains disabled. For OAuth QA, use disposable data and
never record real auth files, URLs, codes, or tokens:

1. Sign in from a fresh state; restart and confirm Connected. Verify Pi's auth
   directory/file modes `0700`/`0600` and preservation of synthetic providers.
2. Cancel and retry; close/reopen Settings and quit/relaunch while waiting.
   Stale completions must not replace a newer Cancelled or successful result.
3. Test port `1455` collision, invalid state, offline/proxy/denial/revocation,
   corrupt/read-only storage, non-ASCII paths, and missing/incompatible Pi.
4. Confirm diagnostics rerun after sign-in. Grant then revoke project consent;
   sign-in alone must never permit provider-backed analysis.
5. Recheck Claude/Codex MCP controls, Safari plus another browser, Apple Silicon
   and Intel packages. Secret-scan logs, screenshots, and bug-report drafts.

## Timeline and agents

1. Reorder; extend/trim with source-bound clamping; set Speed 0.5/2.0 and Zoom
   1.5; split; remove; undo/redo. Quit/reopen and verify all state restores.
2. Connect an external client:
   `claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp`.
   List candidates/read frames/apply edits; confirm the GUI updates live.
3. Accept a Review Proposal (Timeline changes and is undoable); reject another
   (Timeline unchanged). Resolve XML preserves speed/transform; EDL warns.

## Backend smoke/API

```bash
backend/.venv/bin/python scripts/backend_smoke_test.py /absolute/video.mp4
PROJECT_FOLDER=/absolute/footage-folder
PROJECT_ID=$(curl -s -H 'Content-Type: application/json' -X POST \
  http://127.0.0.1:8000/projects/from-folder \
  -d "{\"folder_path\":\"${PROJECT_FOLDER}\"}" | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])')
curl -s -H 'Content-Type: application/json' -X POST \
  "http://127.0.0.1:8000/projects/${PROJECT_ID}/analyze" \
  -d "{\"project_id\":\"${PROJECT_ID}\",\"harness_id\":\"manual\",\"preferences\":{}}"
```

Expect metadata, complete status, smooth candidates, and actionable tool errors.

## Resolve validation and evidence

Import `exports/davinci/timeline.xml`; confirm no relink and matching
count/order/in-out/speed/transform. Move the folder and repeat. Import EDL after
adding source media; verify timing and orientation. Capture media properties,
quality examples, harness/count, editorial usefulness, Timeline persistence,
agent outcomes, and sanitized failures in `QA.md`.
