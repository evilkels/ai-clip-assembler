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

#### Review model authentication boundary

Review model sign-in is a privileged Electron-main workflow, separate from the
renderer-to-FastAPI application API:

```text
Connections UI (token-free status/actions)
  → sandboxed preload (three no-argument IPC methods)
  → Electron main ReviewModelAuthController
  → system browser + OpenAI OAuth callback on 127.0.0.1:1455
  → Pi AuthStorage at ~/.pi/agent/auth.json
```

The renderer receives only a sanitized account/Pi readiness DTO. It never
receives authorization URLs, codes, access tokens, refresh tokens, or auth-file
contents. Electron main validates the IPC sender, allows only the fixed
`openai-codex` provider, opens only the expected HTTPS authorization host, and
cancels an active login during app shutdown. The embedded Pi SDK and spawned Pi
CLI intentionally share the same credential file and resolved executable
readiness, while backend cloud-AI consent remains scoped to each Project.

This is not the **Connect your AI** MCP boundary. An external MCP client such as
Claude Desktop or Codex starts the packaged stdio bridge, which forwards tool
requests to the active local FastAPI backend and its backend-authoritative
Timeline operations. MCP client configuration does not authenticate the in-app
Review model account, and Review model OAuth does not connect an MCP client.

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

### Agent-Operable Timeline (backend-authoritative)

The timeline is owned by the backend as a single **Timeline Document**
(`TimelineDocument` / `TimelineItem` in `models.py`): ordered timeline items,
each with its own in/out bounds, **speed**, and **transform** (digital
zoom/pan/crop), plus the assembly profile and target duration. The same
candidate may appear as more than one item (multi-instance).

- **Operations core** (`timeline_ops.py`): the *only* way the document is
  mutated. A single `apply_operation(doc, sources, op, **args)` entry implements
  `add_item`, `remove_item`, `split_item`, `set_bounds` (trim **and** extend,
  clamped to the source), `reorder`, `set_speed`, `set_transform`,
  `include`/`exclude`, `set_profile`, `set_target_duration`, and the atomic
  `replace_timeline` used to adopt a complete Version. Operations are pure
  (return a new document). `TimelineController` wraps the core with snapshot
  **undo/redo** history and a per-project **async write lock** so two writers
  (GUI + agent) cannot interleave mid-operation.
- **Two thin adapters, one core.** The HTTP adapter (`/projects/{id}/timeline/op`,
  `undo`, `redo`, `document`) serves the GUI; the embedded **MCP server**
  (`mcp_server.py`, mounted at `/mcp`) serves external agents. Both call the same
  operations core, so they cannot drift.
- **Live-sync over SSE.** `timeline_service.py` fans `timeline-changed` events to
  subscribers; `GET /projects/{id}/events` streams them so any client (the GUI)
  reconciles from the authoritative document. An agent's edit appears live.
- **Version preview specs.** The Review Board builds mocked `Version[]` recipes
  from Candidate Clips and previews each recipe client-side through the shared
  video-driven sequence player. A Version has no live item ids; choosing one
  submits its ordered item specs through `replace_timeline`, creating fresh
  Timeline Items in one undoable snapshot while preserving one authoritative
  live Timeline Document.
- **In-app review agent** (`review_agent.py`): an MCP-style client in *propose
  mode*. Its mutating calls are captured as a **Proposal** (staged ops + diff)
  instead of applied; **accept** replays them through the operations core (so
  they land in undo history), **reject** discards. Read access is provided as
  context. The model call reuses the `pi_cli_harness` provider/model env-config.
- **Review Session persistence** (`review_agent.py` / `project_store.py`): chat
  messages and embedded Proposal status are backend-authoritative. Folder
  projects persist stable message IDs, timestamps, and Proposal operations in
  `clipassembler/analysis/review-session.json`; legacy upload projects retain
  the same contract for the backend process lifetime. Kickoff is idempotent and
  the Review panel hydrates the saved session when it mounts.
- **Creative Versions**: Pi-mode Review turns receive bounded, labelled Frame
  Samples plus recent Review Session history and may return 2-4 validated
  preview-spec Versions. Source IDs, bounds, speed, transform, and effective
  duration are checked before the gallery can adopt a Version. Manual Harness
  projects keep the deterministic local Version recipes and make no review-model
  call.
- **Persistence/migration** (`project_store.py`): the document is saved per
  project; a migration loader upgrades the legacy `{clip_id, start_sec, end_sec}`
  timeline into timeline items.
- **Export** (`export_engine.py`): speed (retime) and transform are encoded into
  FCPXML (`adjust-transform`) and Resolve XML (Basic Motion); EDL flattens them
  and surfaces a warning.

See [MCP_SERVER.md](MCP_SERVER.md) for the agent surface and the
[agent-operable-timeline design](specs/2026-06-19-agent-operable-timeline-design.md).

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
