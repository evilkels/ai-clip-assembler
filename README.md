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

# Backend
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn src.api:app --reload --port 8000 &

# Frontend
cd ../frontend
npm install
npm run dev
```

Full setup, tests, and project layout: [docs/DEVELOPER_SETUP.md](docs/DEVELOPER_SETUP.md).

## AI Harness

The active default AI harness is **`pi_agent`** — it drives the [`pi`](https://github.com/earendil-works/pi-mono) coding-agent CLI (default provider `openai-codex`, model `gpt-5.4-mini`) to score candidate clips. Authenticate once with `pi /login` (or set a provider key such as `OPENCODE_API_KEY`); the backend inherits that environment. Tune via `PI_PROVIDER` / `PI_MODEL` / `PI_BIN` / `PI_TIMEOUT_SEC` (see `.env.example`).

The `manual` rule-based harness needs no AI. The **local-model harness (`local_qwen`) is postponed** — disabled in `GET /harnesses` and not selectable in `/analyze` — until the Ollama/MLX path is fully figured out (code retained for later). See [docs/HARNESS_SPEC.md](docs/HARNESS_SPEC.md).

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
- [Harness Spec](docs/HARNESS_SPEC.md) — pluggable AI-harness contract
- [PRD](docs/PRD.md) — product requirements

## Status

🚧 Active MVP. The drone-first workflow runs end to end: import, analyze (rule-based or `pi_agent` AI harness), review, timeline editing, and FCPXML/EDL export. Local model (Qwen/Ollama) harness is postponed.

## License

MIT
