# Architecture

## Overview

AI Clip Assembler is a **local-first** desktop app: Electron frontend +
FastAPI backend. The backend runs a Python analysis pipeline that processes
video files, scores frames for quality/stability, and generates clip
recommendations through the selected harness. Source videos remain local.
An opt-in cloud harness may send sampled frames only after explicit saved
per-project consent.

## Data Flow

```
ELECTRON FRONTEND
  Dropzone (files) → Timeline (clips) → Preview (frames) → Export Panel (FCPXML/EDL)
            IPC (Electron ↔ FastAPI, HTTP over localhost)
                              │
                              ▼
FASTAPI BACKEND
  Analysis Engine → Harness Router → Assembly Engine → Export Engine
  (FFmpeg, OpenCV,   (Manual + Pi;     (sequence build,  (FCPXML, EDL,
   vidstab, PyScene)  others disabled)  formats, speed)    Resolve XML)
```

## Components

### Frontend (Electron + React)

File drop/import, timeline visualization (clips, tracks, playhead), frame
preview with AI score overlays, cut adjustment (trim handles, keyboard
shortcuts), harness selection, export format selection, settings.

Tech: Electron (main + renderer), React + TypeScript, Tailwind CSS, a custom
timeline component, and HTTP calls to the backend on localhost.

#### Review model authentication boundary

Review model sign-in is privileged Electron-main work, separate from FastAPI:

```text
Connections UI → sandboxed preload → ReviewModelAuthController
  → system browser / callback 127.0.0.1:1455 → Pi AuthStorage
```

Only sanitized account/Pi readiness reaches the renderer—never URLs, codes,
tokens, or auth-file contents. Main validates IPC senders, fixes the provider and
authorization endpoint, cancels login on shutdown, and shares Pi's credential
file/executable with the CLI. Project cloud consent remains separate.

**Connect your AI** is another boundary: external MCP client → packaged stdio
bridge → local FastAPI Timeline operations. MCP configuration and Review model
OAuth neither authenticate nor connect one another.

### Backend (FastAPI + Python)

Video ingestion (FFmpeg probe, frame extraction), motion analysis
(vidstabdetect, OpenCV motion vectors), frame quality scoring (blur,
brightness, contrast), scene/shot detection (PySceneDetect), AI harness
routing (standardized interface), clip assembly, export generation.

Tech: FastAPI, FFmpeg, OpenCV, PySceneDetect, and optional provider adapters.

### Agent-Operable Timeline (backend-authoritative)

The timeline is owned by the backend as a single **Timeline Document**
(`TimelineDocument` / `TimelineItem` in `models.py`): ordered items, each
with in/out bounds, **speed**, and **transform** (digital zoom/pan/crop),
plus the assembly profile and target duration. A candidate may appear as
more than one item (multi-instance).

- **Operations core** (`timeline_ops.py`): the *only* way the document is
  mutated, via `apply_operation(doc, sources, op, **args)` — `add_item`,
  `remove_item`, `split_item`, `set_bounds` (trim/extend, clamped to
  source), `reorder`, `set_speed`, `set_transform`, `include`/`exclude`,
  `set_profile`, `set_target_duration`, and atomic `replace_timeline`.
  Operations are pure (return a new document). `TimelineController` adds
  snapshot **undo/redo** and a per-project async write lock so the GUI and
  an agent can't interleave mid-operation.
- **Two thin adapters, one core.** The HTTP adapter
  (`/projects/{id}/timeline/op`, `undo`, `redo`, `document`) serves the GUI;
  the embedded **MCP server** (`mcp_server.py`, mounted at `/mcp`) serves
  external agents. Both call the same operations core, so they can't drift.
- **Live-sync over SSE.** `timeline_service.py` fans `timeline-changed`
  events to subscribers; `GET /projects/{id}/events` streams them so any
  client reconciles from the authoritative document. An agent's edit appears
  live in the GUI.
- **Version preview specs.** The Review Board builds mocked `Version[]`
  recipes from Candidate Clips, previewed client-side via the shared
  video-driven sequence player. Choosing one submits its item specs through
  `replace_timeline`, creating fresh Timeline Items in one undoable snapshot.
- **In-app review agent** (`review_agent.py`): an MCP-style client in
  *propose mode* — mutating calls are captured as a **Proposal** (staged
  ops + diff) instead of applied; accept replays them through the ops core
  (landing in undo history), reject discards. Reuses the `pi_cli_harness`
  provider/model env-config.
- **Review Session persistence**: chat messages and Proposal status are
  backend-authoritative, persisted in
  `clipassembler/analysis/review-session.json` for folder projects (legacy
  upload projects keep the same contract for the process lifetime).
- **Creative Versions**: Pi-mode Review turns get bounded, labelled Frame
  Samples plus recent history and may return 2-4 validated preview-spec
  Versions (source IDs, bounds, speed, transform, duration all checked
  before the gallery can adopt one). Manual Harness projects use
  deterministic local recipes and make no model call.
- **Persistence/migration** (`project_store.py`): document saved per
  project; migration loader upgrades the legacy
  `{clip_id, start_sec, end_sec}` timeline into timeline items.
- **Export** (`export_engine.py`): speed and transform are encoded into
  FCPXML (`adjust-transform`) and Resolve XML (Basic Motion); EDL flattens
  them with a warning.

See [MCP_SERVER.md](MCP_SERVER.md) for the agent surface and the
[agent-operable-timeline design](specs/2026-06-19-agent-operable-timeline-design.md).

### AI Harness System

Core principle: **one interface, many implementations.** All harnesses take
a batch of analyzed frames with metadata and return a JSON array of
recommended clips with scores and reasons. See
[HARNESS_SPEC.md](HARNESS_SPEC.md) for the full interface.

## File Formats

Each analyzed video produces a JSON file with per-frame metrics and scene
boundaries, e.g.:

```json
{
  "file": "DJI_001.MP4", "duration_sec": 1847.3, "fps": 60,
  "resolution": [3840, 2160],
  "frames": [{"timestamp": 45.2, "frame_path": "/tmp/frames/DJI_001_045200.jpg",
    "motion_stability": 8.5, "blur_score": 7.2, "brightness": 0.78, "scene_id": 3}],
  "scenes": [{"start": 42.0, "end": 68.5, "scene_id": 3}]
}
```

Export formats: **FCPXML** (Final Cut Pro X, primary), **EDL** (CMX3600,
universal), **Resolve XML** (DaVinci Resolve, secondary).

## Development Mode

In development, the backend runs as a separate Python process on a local
port (default 8000); Electron talks to it over HTTP. In production it can be
bundled into the Electron app or run as a subprocess.

## Future Considerations

GPU vision inference (MLX), long-video queues, custom harness plugins, and
non-real-time project-sharing collaboration.
