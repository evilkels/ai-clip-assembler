# Troubleshooting & FAQ

Common issues when running AI Clip Assembler locally, and how to fix them.

## Status bar shows "Offline"

The desktop app cannot reach the backend at `http://127.0.0.1:8000`.

- Start the backend: `cd backend && .venv/bin/uvicorn src.api:app --reload --port 8000`.
- Confirm it responds: `curl http://127.0.0.1:8000/` → `{"status":"ok",...}`.
- The frontend expects port **8000** and the backend allows the Vite dev origin
  `http://localhost:5173` via CORS. If you changed either, update
  `backend/src/api.py` (CORS origins) and the frontend `backendUrl()`.

While offline the app loads a few **mock clips** so you can still explore the
Review/Timeline/Export UI — these are not from your footage.

## Analyze fails with a 503 about motion analysis / vidstab

Symptom: `Analyze` errors, or the backend logs `FFmpegVidstabUnavailableError`.

Your `ffmpeg` build lacks the `vidstabdetect` filter. Verify and fix:

```bash
ffmpeg -hide_banner -filters | grep vidstabdetect   # no output = missing
brew install libvidstab && brew reinstall ffmpeg
# or: brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

Then restart the backend.

## Analyze fails with a 422 / ffprobe error

The uploaded file isn't a valid/probeable video, or `ffprobe` isn't on `PATH`.
Confirm `which ffprobe` resolves and that the file plays in a normal player.

## pi harness: "No API key found for <provider>"

The `pi` CLI has no credential for the configured provider. Fix one of:

- Authenticate interactively: `pi /login` and select your provider.
- Set the provider env var before launching the backend (e.g.
  `export OPENCODE_API_KEY=...` for the opencode provider), then restart.
- Point `PI_PROVIDER` / `PI_MODEL` at a provider you *are* logged into
  (defaults: `openai-codex` / `gpt-5.4-mini`).

Note: `pi` keeps its own credentials in `~/.pi/agent/auth.json`, **separate**
from the standalone `opencode` CLI's store. Logging into `opencode` does not log
`pi` in.

If the harness can't reach the model, analysis falls back to the rule-based
result and the response metadata includes a `warning`; you still get clips, just
without AI visual-interest scores.

## "Only manual and pi_agent harnesses are available"

`/analyze` currently accepts `manual` and `pi_agent`. The local Qwen/Ollama
harness (`local_qwen`) is **postponed** and disabled — its code is retained but
not selectable. The desktop app uses `pi_agent` by default. See
[HARNESS_SPEC.md](HARNESS_SPEC.md).

## pi analysis is slow

The `pi` harness makes one model call per candidate clip (~10–15s each), so a
long video with many candidates can take a while. Options: raise the Review
**Smoothness ≥** threshold before accepting clips, choose a faster `PI_MODEL`,
or use the `manual` harness for a quick pass.

## Timeline keyboard shortcuts don't respond

They're only active while the **Timeline** tab is open and when focus isn't in a
text input. Click an empty part of the timeline first. See the shortcut table in
[USER_GUIDE.md](USER_GUIDE.md).

## Export says order/trim couldn't sync

Export first PUTs your timeline (order + trims) to the backend. If that fails
(e.g. the backend restarted and lost in-memory project state), the app warns and
exports the last known order. Re-run **Analyze**, or re-accept clips, to restore
backend state. Backend project state is in-memory and does **not** persist across
restarts.

## Running the test suites

```bash
# Backend
cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py

# Frontend
cd frontend && npm run typecheck && npm run build
```
