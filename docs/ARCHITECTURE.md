# Architecture

## Overview

AI Clip Assembler is a local-first desktop application built on Electron (frontend) and FastAPI (backend). The backend runs a Python analysis pipeline that processes video files, scores frames for quality/stability, and generates clip recommendations via pluggable AI harnesses.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ELECTRON FRONTEND                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Dropzone │→ │ Timeline │→ │ Preview  │→ │ Export Panel     │   │
│  │ (files)  │  │ (clips)  │  │ (frames) │  │ (FCPXML/EDL)     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│       │              ↑              ↑              ↑                │
│       │              │              │              │                │
│       └──────────────┴──────────────┴──────────────┘                │
│                   IPC (Electron ↔ FastAPI)                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │  Analysis  │→ │  Harness   │→ │  Assembly  │→ │   Export   │   │
│  │  Engine    │  │  Router    │  │  Engine    │  │  Engine    │   │
│  │            │  │            │  │            │  │            │   │
│  │ • FFmpeg   │  │ • Claude   │  │ • Sequence │  │ • FCPXML   │   │
│  │ • OpenCV   │  │ • Codex    │  │   builder  │  │ • EDL      │   │
│  │ • vidstab  │  │ • Pi       │  │ • Gap fill │  │ • Resolve  │   │
│  │ • PyScene  │  │ • Local    │  │ • Speed    │  │   XML      │   │
│  │            │  │ • Manual   │  │   ramping  │  │            │   │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### Frontend (Electron + React)

**Responsibilities:**
- File drop / import
- Timeline visualization (clips, tracks, playhead)
- Frame preview with AI score overlays
- Cut adjustment (trim handles, keyboard shortcuts)
- Harness selection UI
- Export format selection
- Settings (model paths, API keys, preferences)

**Tech:**
- Electron (main + renderer process)
- React + TypeScript
- Tailwind CSS
- Custom timeline component (based on Remotion editor patterns)
- IPC to FastAPI backend via HTTP (localhost)

### Backend (FastAPI + Python)

**Responsibilities:**
- Video ingestion (FFmpeg probe, frame extraction)
- Motion analysis (vidstabdetect, OpenCV motion vectors)
- Frame quality scoring (blur, brightness, contrast)
- Scene/shot detection (PySceneDetect)
- AI harness routing (standardized interface)
- Clip assembly (sequence building, gap filling)
- Export generation (FCPXML, EDL)

**Tech:**
- FastAPI (REST API)
- FFmpeg (frame extraction, video info, stabilization analysis)
- OpenCV (frame quality metrics)
- PySceneDetect (scene boundary detection)
- Ollama / MLX (local vision models)
- httpx (external AI harness API calls)

### AI Harness System

The core design principle: **one interface, many implementations.**

All harnesses implement the same input/output contract:

**Input:** Batch of analyzed frames with metadata
**Output:** JSON array of recommended clips with scores and reasons

See [HARNESS_SPEC.md](HARNESS_SPEC.md) for the full interface definition.

## File Formats

### Internal Data Format

Each analyzed video produces a JSON file:

```json
{
  "file": "DJI_001.MP4",
  "duration_sec": 1847.3,
  "fps": 60,
  "resolution": [3840, 2160],
  "frames": [
    {
      "timestamp": 45.2,
      "frame_path": "/tmp/frames/DJI_001_045200.jpg",
      "motion_stability": 8.5,
      "blur_score": 7.2,
      "brightness": 0.78,
      "scene_id": 3
    }
  ],
  "scenes": [
    {"start": 42.0, "end": 68.5, "scene_id": 3}
  ]
}
```

### Export Formats

- **FCPXML** — Final Cut Pro X (primary)
- **EDL** — CMX3600 Edit Decision List (universal)
- **Resolve XML** — DaVinci Resolve (secondary)

## Development Mode

In development, the backend runs as a separate Python process on a local port (default 8000). The Electron frontend makes HTTP requests to it. In production, the backend can be bundled into the Electron app or run as a subprocess.

## Future Considerations

- GPU acceleration for vision model inference (MLX on Apple Silicon)
- Background processing queue for long videos
- Plugin system for custom harnesses
- Collaboration features (project sharing, not real-time editing)
