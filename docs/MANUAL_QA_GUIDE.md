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
brew install ffmpeg
```

Verify:

```bash
ffmpeg -version
ffprobe -version
python3 --version
node --version
npm --version
```

## Install Dependencies

From the repo root:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler
```

Backend:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pytest
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
.venv/bin/uvicorn src.api:app --reload --port 8000
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
python3 scripts/backend_smoke_test.py "$VIDEO_PATH"
```

The script creates a project, uploads the video, runs manual analysis, and generates both EDL and FCPXML exports.

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

## QA Notes To Capture

For each test clip, record:

- Source video filename, duration, codec, resolution, and FPS.
- Whether the shot is smooth, shaky, blurry, overexposed, or mixed.
- Number of candidate clips produced.
- Whether candidate clips match what you would keep manually.
- Any confusing score or reason text.

File bugs using the template in `docs/QA.md`.
