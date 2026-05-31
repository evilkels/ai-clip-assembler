# Manual QA Launch Guide

This guide launches the current drone-first MVP on macOS for manual QA.

## Current Product State

- The Electron frontend launches and can create/open a **Project** from a footage folder.
- The FastAPI backend can create projects, upload source videos, probe metadata, extract frames, score frame samples, and assemble rule-based smooth **Candidate Clips**.
- The frontend can run backend analysis and export accepted timelines as FCPXML or EDL.
- Folder-backed projects keep source videos in place and write app state into `clipassembler/`.

## Prerequisites

Install system tools:

```bash
brew install python@3.11 node
```

FFmpeg is required. On macOS, the default Homebrew `ffmpeg` formula includes the
`vidstabdetect` filter needed for motion analysis:

```bash
brew install ffmpeg
```

Verify `vidstabdetect` is available:

```bash
ffmpeg -hide_banner -filters | grep vidstabdetect
```

If `vidstabdetect` is missing (older Homebrew installs or custom builds), install
libvidstab and rebuild:

```bash
brew install libvidstab
brew reinstall ffmpeg
```

Alternatively, use Homebrew's `ffmpeg-full` tap which bundles more filters:

```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

Verify:

```bash
which ffmpeg
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -filters | grep vidstabdetect
python3.11 --version
node --version
npm --version
```

The backend MVP requires `vidstabdetect`. The regular Homebrew `ffmpeg`
formula may not include it, so start the backend from a shell where
`/opt/homebrew/opt/ffmpeg-full/bin` appears before `/opt/homebrew/bin`.

## Install Dependencies

From the repo root:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler
```

Backend:

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
PYTHONPATH=. .venv/bin/python -m pytest
```

Frontend:

```bash
cd ../frontend
npm install
npm run typecheck
npm run build
```

## Launch The App

Terminal 1, backend:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler/backend
source .venv/bin/activate
PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

Terminal 2, frontend:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler/frontend
npm run dev
```

Expected frontend behavior:

- Electron opens a dark editor-style app.
- The Import tab can create/open a folder-backed project with **Create / Open Folder Project**.
- Source videos are listed without copying footage.
- Smoothness threshold defaults to 7+.
- You can include, exclude, and reorder accepted clips.
- The Export tab can generate EDL and FCPXML files.

## Folder Project QA Flow

Use a folder containing one or more top-level `.mp4`, `.mov`, or `.mkv` files.
Nested folders are intentionally ignored in the MVP.

1. Launch the backend and frontend.
2. In the Import tab, click **Create / Open Folder Project**.
3. Choose the footage folder.
4. Confirm the app lists source videos and creates:

```bash
<footage-folder>/clipassembler/project.json
<footage-folder>/clipassembler/samples/
<footage-folder>/clipassembler/analysis/
<footage-folder>/clipassembler/cache/
<footage-folder>/clipassembler/cache/.nosync
```

5. Click **Analyze**.
6. Confirm frame samples appear under `clipassembler/samples/` and motion files
   appear under `clipassembler/analysis/motion/`.
7. Accept one or more clips on the Review tab.
8. Export EDL and FCPXML from the Export tab.
9. Confirm exports are written to:

```bash
<footage-folder>/exports/edl/timeline.edl
<footage-folder>/exports/fcp/timeline.fcpxml
```

Move-folder check:

1. Quit the app.
2. Rename or move the footage folder.
3. Launch the app again.
4. Confirm the sidebar marks the old recent project as missing.
5. Click **Locate** and choose the moved folder.
6. Open the relocated recent project.
7. Confirm the existing `clipassembler/project.json` opens without overwriting
   the source video list.

Rescan check:

1. Add a new top-level `.mp4`, `.mov`, or `.mkv` to the footage folder.
2. Click **Rescan** in the sidebar or Import tab.
3. Confirm the new source video appears in the UI.
4. Confirm `clipassembler/project.json::source_videos` includes the new file
   once and preserves existing entries.

Recent-list and delete-files checks:

1. Click **Remove** on a recent project.
2. Confirm the recent entry disappears and the folder contents remain untouched.
3. Reopen the folder project.
4. Click **Delete project files**.
5. Confirm only `clipassembler/` and `exports/` are deleted.
6. Confirm source videos remain in place.

Overwrite check:

1. Export an EDL or FCPXML.
2. Export the same format again.
3. Confirm the app warns before overwriting.
4. Confirm canceling leaves the existing export untouched.

Empty-folder check:

1. Choose a folder with no top-level supported videos.
2. Confirm the app shows an error.
3. Confirm it did not create `clipassembler/`.

## Backend Real-Footage Smoke Test

Use a short local drone MP4 or MOV. Replace the path below.

```bash
VIDEO_PATH="/absolute/path/to/your/drone-footage.mp4"
```

The easiest full backend smoke test is:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler
backend/.venv/bin/python scripts/backend_smoke_test.py "$VIDEO_PATH"
```

The script creates a project, uploads the video, runs manual analysis, prints
candidate clip timings and scores, and generates both EDL and FCPXML exports.

The equivalent manual API steps are below.

Create a project:

```bash
PROJECT_ID=$(curl -s -X POST http://127.0.0.1:8000/projects | python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])')
echo "$PROJECT_ID"
```

Create/open a folder-backed project:

```bash
PROJECT_FOLDER="/absolute/path/to/your/footage-folder"
PROJECT_ID=$(curl -s \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:8000/projects/from-folder \
  -d "{\"folder_path\":\"${PROJECT_FOLDER}\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])')
echo "$PROJECT_ID"
```

Upload a source video:

```bash
curl -s \
  -F "file=@${VIDEO_PATH}" \
  "http://127.0.0.1:8000/projects/${PROJECT_ID}/videos" \
  | python3 -m json.tool
```

Run manual analysis:

```bash
curl -s \
  -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/analyze" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"harness_id\": \"manual\",
    \"preferences\": {
      \"sample_fps\": 1,
      \"smoothness_threshold\": 7,
      \"min_clip_duration_sec\": 3,
      \"max_clip_duration_sec\": 15,
      \"target_duration_sec\": 120
    }
  }" \
  | python3 -m json.tool
```

Expected backend behavior:

- Metadata includes duration, FPS, resolution, and codec.
- Analysis returns `status: "complete"`.
- Smooth footage should produce one or more candidate clips when enough frames pass the 7+ smoothness threshold.
- If `ffmpeg` or `ffprobe` is missing, the API should return an actionable error instead of a traceback.

## Optional Local Qwen Vision Enhancement

> **The manual / rule-based harness is the default reliable mode.**
> Local Qwen is an optional enhancement. If Ollama or the model is unavailable,
> the backend falls back to manual results automatically.

Install and start Ollama (macOS):

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3-vl:8b
ollama serve
```

Run analysis with the local vision harness:

```bash
curl -s \
  -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/analyze" \
  -d "{
    \"project_id\": \"${PROJECT_ID}\",
    \"harness_id\": \"local_qwen\",
    \"preferences\": {
      \"sample_fps\": 1,
      \"smoothness_threshold\": 7,
      \"min_clip_duration_sec\": 3,
      \"max_clip_duration_sec\": 15,
      \"target_duration_sec\": 120
    }
  }" \
  | python3 -m json.tool
```

Environment variables (optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen3-vl:8b` | Model tag to use |
| `OLLAMA_TEMPERATURE` | `0.2` | Model sampling temperature (fixed at 0.2 by default) |

Configuration is via environment variables only. No config file is required.

If Ollama is not running, the response will still be HTTP 200 with manual
results and a metadata warning such as:

```json
{
  "metadata": {
    "warning": "Local Qwen fallback: Ollama/model unavailable"
  }
}
```

Export EDL:

```bash
curl -s \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/export?format=edl" \
  | python3 -m json.tool
```

Export FCPXML:

```bash
curl -s \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/export?format=fcpxml" \
  | python3 -m json.tool
```

Expected export behavior:

- The response includes `status: "generated"` and a local `file_path`.
- The EDL file opens as readable text with edit events.
- The FCPXML file can be inspected as XML and should be tried in Final Cut Pro during manual QA.

## DaVinci Resolve Validation

DaVinci Resolve Free is a good MVP validation target because it can import EDL
timelines without requiring Final Cut Pro.

1. Open Resolve and create a new project.
2. Import the original source MP4/MOV into the Media Pool.
3. Use **File > Import > Timeline > Import AAF, EDL, XML...**.
4. For folder-backed projects, select the generated export:

```bash
<footage-folder>/exports/edl/timeline.edl
```

For legacy upload smoke tests, select:

```bash
backend/.ai-clip-assembler/projects/<project-id>/exports/timeline.edl
```

5. If Resolve cannot relink media for legacy upload projects, import the copied
   backend media from:

```bash
backend/.ai-clip-assembler/projects/<project-id>/videos/
```

Check:

- The timeline imports without an error dialog.
- The number of clips matches the smoke-test output.
- Each clip has plausible source timing and duration.
- For folder-backed projects, media should resolve from the original footage
  folder without copying source videos.
- Vertical footage is upright or the orientation issue is recorded.
- Playback timing is plausible and does not appear sped up or slowed down.

Known limitation: export metadata for non-30fps and rotated vertical media is
tracked in GitHub issue #19.

## QA Notes To Capture

For each test clip, record:

- Source video filename, duration, codec, resolution, and FPS.
- Whether the shot is smooth, shaky, blurry, overexposed, or mixed.
- Number of candidate clips produced.
- Whether candidate clips match what you would keep manually.
- Any confusing score or reason text.

File bugs using the template in `docs/QA.md`.
