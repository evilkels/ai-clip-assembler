# AGENTS.md — AI Clip Assembler

Source of truth for agent behavior in this repo.

## Agent Skills

### Issue tracker

GitHub. Use `gh` CLI for all issue/PR operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Default Matt Pocock vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo. Read `CONTEXT.md` at root + `docs/adr/` for decisions. See `docs/agents/domain.md`.

## Project Context

- **Name**: AI Clip Assembler
- **Type**: Local-first desktop video editor (Electron + React frontend, FastAPI + Python backend)
- **Purpose**: Auto-assemble clips from raw MP4 footage using modular AI harnesses
- **Privacy**: Footage never leaves the machine. AI runs locally or via user-chosen provider.
- **Export**: FCPXML (Final Cut Pro), EDL (universal), Resolve XML

## Architecture Quick Ref

- Frontend: Electron + React + Vite + Tailwind
- Backend: FastAPI + FFmpeg + OpenCV + PySceneDetect
- AI: Modular harness system (Claude, Codex, Pi, Local Qwen, Manual)
- Data: JSON files + FFmpeg metadata (no database)

## Development Workflow

1. GitHub Issues for tasks and PRDs
2. GitHub PRs for code changes
3. Main branch is protected — PRs required
4. Local testing before PR

## Key Files

- `docs/ARCHITECTURE.md` — Full system design
- `docs/HARNESS_SPEC.md` — AI harness interface specification
- `backend/src/api.py` — FastAPI entry point
- `frontend/package.json` — Frontend dependencies
