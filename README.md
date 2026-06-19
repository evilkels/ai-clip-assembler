# AI Clip Assembler

Local-first AI video editor. Drop raw MP4s, get AI-suggested clips, adjust cuts, export to Final Cut Pro or DaVinci Resolve.

## Philosophy

- **Your footage never leaves your machine**
- **AI is an assistant, not a replacement** — you have final say on every cut
- **Modular AI harness** — use Claude, Codex, Pi, local models, or no AI at all

## Quick Start (macOS)

```bash
# Clone
git clone https://github.com/evilkels/ai-clip-assembler.git
cd ai-clip-assembler

# System tools (FFmpeg must include the vidstabdetect filter)
brew install python@3.11 node ffmpeg
ffmpeg -hide_banner -filters | grep vidstabdetect   # must print a line
```

> **Caveat:** the standard Homebrew `ffmpeg` bottle may be compiled **without**
> `libvidstab` (check `ffmpeg -version` for `--enable-libvidstab`). If the grep
> above prints nothing, `brew reinstall ffmpeg` will NOT fix it — it reinstalls
> the same prebuilt bottle. Replace it with a source build from the
> homebrew-ffmpeg tap:
>
> ```bash
> brew uninstall ffmpeg
> brew tap homebrew-ffmpeg/ffmpeg
> brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libvidstab
> ffmpeg -hide_banner -filters | grep vidstab   # vidstabdetect + vidstabtransform
> ```
>
> This builds from source and can take 10–30 minutes.

```bash

# Backend deps (one-time)
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Frontend deps (one-time)
cd ../frontend
npm install

# Run backend + Electron app together (backend auto-loads repo-root .env)
npm run dev:with-backend
```

Other scripts (from `frontend/`): `npm run dev:backend` (backend only),
`npm run dev` (app only), `npm run test:backend` (backend test suite).

Full setup, tests, and project layout: [docs/DEVELOPER_SETUP.md](docs/DEVELOPER_SETUP.md).

## AI Harness

The active default AI harness is **`pi_agent`** — it drives the [`pi`](https://github.com/earendil-works/pi-mono) coding-agent CLI (default provider `openai-codex`, model `gpt-5.4-mini`) to score candidate clips. Authenticate once with `pi /login` (or set a provider key such as `OPENCODE_API_KEY`); the backend inherits that environment. Tune via `PI_PROVIDER` / `PI_MODEL` / `PI_BIN` / `PI_TIMEOUT_SEC` — set in the shell or in a repo-root `.env`, which the backend loads automatically (see `.env.example`).

The `manual` rule-based harness needs no AI. The **local-model harness (`local_qwen`) is postponed** — disabled in `GET /harnesses` and not selectable in `/analyze` — until the Ollama/MLX path is fully figured out (code retained for later). See [docs/HARNESS_SPEC.md](docs/HARNESS_SPEC.md).

## Timeline editing

The timeline is a backend-authoritative **Timeline Document** (ordered timeline
items, each with its own in/out bounds, **speed**, and **transform**), mutated
only through one reversible **operations core**: `split`, `extend`/retrim,
`reorder`, multi-instance, `set_speed`, and `set_transform` (digital zoom/pan).
Every change is a snapshot on a per-project **undo/redo** history. The GUI live-
updates over SSE, so an edit from any client appears everywhere at once. Speed
and transform are encoded into FCPXML and Resolve XML on export; EDL flattens
them and surfaces a warning.

## Controlling the app with an agent (MCP)

While the app runs, the backend exposes a local **MCP server** at
`http://127.0.0.1:8000/mcp`. External agents (Claude Code, Cursor) drive the
*same* live timeline through the same operations — `list_candidates`,
`get_frame_paths`, `include`, `set_speed`, `split_item`, … — and their edits show
up live in the GUI. Connect Claude Code:

```bash
claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp
```

The app also has an in-app **review agent** on the Review route that runs in
*propose mode*: it suggests edits as Accept/Reject proposal cards; accepting
replays them through the operations core (so they stay undoable). Full setup and
tool list: [docs/MCP_SERVER.md](docs/MCP_SERVER.md).

## Project Structure

```
ai-clip-assembler/
├── frontend/          # Electron + React desktop app
│   ├── src/
│   │   ├── components/   # Timeline, video preview, clip cards
│   │   ├── hooks/        # React hooks for video/FFmpeg IPC
│   │   ├── styles/       # Tailwind / CSS
│   │   └── utils/        # Helpers
│   └── package.json
├── backend/           # FastAPI + FFmpeg + OpenCV analysis pipeline
│   ├── src/
│   │   ├── analysis/     # Frame extraction, motion scoring
│   │   ├── harness/      # AI harness interface + implementations
│   │   ├── export/       # FCPXML, EDL generators
│   │   └── api.py        # FastAPI entry point
│   ├── tests/
│   └── requirements.txt
├── harness/           # AI harness definitions and configs
│   ├── claude/
│   ├── codex/
│   ├── pi_agent/
│   ├── local/         # Qwen2.5-VL / Qwen3-VL via Ollama/MLX
│   └── manual/        # Rule-based, no AI
├── docs/              # Architecture, API specs
└── scripts/           # Setup, build, release scripts
```

## Documentation

- [User Guide](docs/USER_GUIDE.md) — import → review → timeline → export walkthrough
- [Developer Setup](docs/DEVELOPER_SETUP.md) — environment, running, tests, layout
- [Troubleshooting & FAQ](docs/TROUBLESHOOTING.md) — common issues and fixes
- [Architecture](docs/ARCHITECTURE.md) — full system design
- [MCP Server](docs/MCP_SERVER.md) — drive the timeline from an external agent
- [Harness Spec](docs/HARNESS_SPEC.md) — pluggable AI-harness contract
- [PRD](docs/PRD.md) — product requirements

## Status

🚧 Active MVP. The drone-first workflow runs end to end: import, analyze (rule-based or `pi_agent` AI harness), review, timeline editing, and export to DaVinci Resolve XML, FCPXML, or EDL. Folder projects persist analysis results and the saved timeline in `clipassembler/analysis/results.json`, so re-opening a project restores the Review Board. Local model (Qwen/Ollama) harness is postponed.

A self-contained end-to-end check (synthetic footage, real pipeline) lives at `scripts/synthetic_e2e_qa.py`:

```bash
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

## License

MIT
