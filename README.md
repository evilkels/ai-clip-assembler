# AI Clip Assembler

Local-first AI video editor. Drop raw MP4s, get AI-suggested clips, adjust cuts, export to Final Cut Pro or DaVinci Resolve.

## Philosophy

- **Your footage never leaves your machine**
- **AI is an assistant, not a replacement** — you have final say on every cut
- **Modular AI harness** — use Claude, Codex, Pi, local models, or no AI at all

## Quick Start (when ready)

```bash
# Clone
git clone https://github.com/evilkels/ai-clip-assembler.git
cd ai-clip-assembler

# Install backend dependencies
cd backend && pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend && npm install

# Run dev mode
npm run dev
```

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

## Status

🚧 Research & scaffolding phase. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full spec.

## License

MIT
