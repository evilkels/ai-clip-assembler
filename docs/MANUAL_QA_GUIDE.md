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

Confirm ffmpeg/ffprobe, Python 3.9+, Node/npm versions. The starting shell must
resolve `vidstabdetect`. For Pi, authenticate (`pi /login`) and smoke-test the
selected provider/model; backend reads `PI_PROVIDER`, `PI_MODEL`, `PI_BIN`, and
`PI_TIMEOUT_SEC` from root `.env`.

## Folder-project flow

1. Import → Create/Open Folder Project; choose top-level MP4/MOV/MKV footage.
2. Confirm source list and `clipassembler/{project.json,samples,analysis,cache}`
   plus `cache/.nosync`; choose Manual or Pi and Analyze.
3. Confirm samples, motion outputs, and Pi cache when used; accept clips.
4. Export EDL/FCPXML/Resolve XML and confirm `exports/{edl,fcp,davinci}` paths.
5. Move/rename the folder; old recent entry shows missing; Locate reopens it
   without replacing sources. Add a video; Rescan adds it once and keeps old ones.
6. Remove recent entry without touching media. Reopen; Delete project files
   removes only `clipassembler/` and `exports/`, never sources.
7. Export twice: overwrite warns and Cancel preserves the file. Empty folder:
   actionable error and no `clipassembler/` mutation.

## Pi harness

Analyze with authenticated Pi: Candidate Clips gain visual-interest and written
Clip Reason. Relaunch backend with `PI_BIN=/bin/false`, reanalyze, and confirm
per-video Manual fallback with warning—no crash/lost project. Sequential scoring
is ~9s/clip; see the Pi scaling design. Local Qwen remains disabled.

## Timeline and agents

1. Reorder; extend/trim and confirm source-bound clamping; set Speed 0.5/2.0
   and confirm effective duration; Zoom 1.5; split; remove; undo/redo.
2. Quit/reopen: order, bounds, speed, transforms, and splits restore. Resolve XML
   preserves speed/transform; EDL carries a flatten warning.
3. Connect an external client:
   `claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp`.
   List candidates/read frames/apply include, speed, or split; GUI updates live.
4. In Review chat, Accept a Proposal (Timeline changes and is undoable); Reject
   another (Timeline unchanged). See `MCP_SERVER.md` and Flow F.

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

Expect duration/FPS/resolution/codec, complete status, smooth Candidate Clips,
and actionable missing-tool errors rather than tracebacks.

## Resolve validation

1. Import `exports/davinci/timeline.xml` via File → Import → Timeline; confirm
   zero relink prompts and matching count/order/in-out/speed/transform.
2. Move the whole folder and import again: still zero relink.
3. EDL fallback: add source media, import `timeline.edl`, and confirm count,
   source timing, orientation, and plausible playback. Track non-30fps/vertical
   metadata limitation in issue #19.

## Evidence to capture

Per clip: filename/duration/codec/resolution/FPS, smooth/shaky/blurry/exposure
character, harness/count, editorial usefulness, confusing scores/reasons. Per
Timeline: operations and save/reload/export survival. Per agent: live external
edit and Accept/Reject result. File findings using `QA.md`.
