# Manual QA Launch Guide

This guide launches the current drone-first MVP on macOS for manual QA.

## Current Product State

- The Electron frontend launches and shows the drone **Review Board** with mock candidate clips.
- The FastAPI backend can create projects, upload source videos, probe metadata, extract frames, score frame samples, and assemble rule-based smooth **Candidate Clips**.
- The frontend API client is not fully wired to real backend project/video analysis yet; use the backend API smoke test below for real footage analysis.
- The backend can export analyzed timelines as FCPXML or EDL files.
- The frontend Export tab still shows a JSON preview and is not yet wired to call the backend export endpoint.

## Prerequisites

Install system tools:

```bash
brew install python@3.11 ffmpeg node
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

If `vidstabdetect` is missing from the filter list, install libvidstab
and rebuild ffmpeg:

```bash
brew install libvidstab
brew reinstall ffmpeg --with-libvidstab 2>/dev/null || brew upgrade ffmpeg
```

On modern Homebrew (Apple Silicon), the default `ffmpeg` formula includes
vidstabdetect. The steps above are only needed on older setups.

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
- The Review tab shows mock drone candidate clips.
- Smoothness threshold defaults to 7+.
- You can include, exclude, and reorder accepted clips.
- The Export tab shows a JSON preview of accepted clip order.

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
4. Select the generated export, usually:

```bash
backend/.ai-clip-assembler/projects/<project-id>/exports/timeline.edl
```

5. If Resolve cannot relink media, import the copied backend media from:

```bash
backend/.ai-clip-assembler/projects/<project-id>/videos/
```

Check:

- The timeline imports without an error dialog.
- The number of clips matches the smoke-test output.
- Each clip has plausible source timing and duration.
- Media is online or can be relinked manually.
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
