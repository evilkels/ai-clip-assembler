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

Your `ffmpeg` build lacks the `vidstabdetect` filter. Verify:

```bash
ffmpeg -hide_banner -filters | grep vidstabdetect   # no output = missing
ffmpeg -version   # configuration: line without --enable-libvidstab confirms it
```

Note: `brew install libvidstab && brew reinstall ffmpeg` does **not** fix this —
Homebrew reinstalls the same prebuilt bottle, which was compiled without
`libvidstab`. Replace it with a source build from the homebrew-ffmpeg tap
(takes 10–30 minutes):

```bash
brew uninstall ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libvidstab
ffmpeg -hide_banner -filters | grep vidstab   # must list vidstabdetect + vidstabtransform
```

Then restart the backend.

## Analyze fails with a 422 / ffprobe error

The uploaded file isn't a valid/probeable video, or `ffprobe` isn't on `PATH`.
Confirm `which ffprobe` resolves and that the file plays in a normal player.

## "pi CLI not found on PATH" although the terminal finds it

macOS starts Finder and Dock launches with a minimal `PATH`, so anything a
version manager adds is invisible to the app. `nvm`, `volta`, and `asdf` all
export their bin directory from `~/.zshrc`, which a *non-interactive* login
shell never sources — the app used to probe with `zsh -lc` and so missed exactly
those installs. It now probes an interactive login shell (`zsh -lic`) first and
falls back to scanning the usual install locations, including every
`~/.nvm/versions/node/*/bin`.

Two workarounds that fix an already-installed build without waiting for an
update:

```bash
# Put pi somewhere the packaged backend's PATH always includes.
sudo ln -sf "$(which pi)" /opt/homebrew/bin/pi   # /usr/local/bin/pi on Intel

# Or hand the path to the app for one launch.
open --env PI_BIN="$(which pi)" -a "AI Clip Assembler"
```

The symlink takes effect immediately: the backend re-resolves the executable on
every check, and `/opt/homebrew/bin` and `/usr/local/bin` are always on its
`PATH`, so **Settings → Diagnostics → Run check again** is enough. The `PI_BIN`
route sets an environment variable read at launch, so it needs the app quit and
reopened. The Diagnostics panel prints these same steps under **How to fix
this** whenever the check fails.

## Review model account and pi harness

Open **Settings → Connections** first. The **Review model account** state and
the Pi installation detail are deliberately separate:

- **Pi is not installed:** install `@earendil-works/pi-coding-agent`, confirm
  `pi --version` resolves, then restart the app. Signing in does not install the
  CLI; analysis and diagnostics still invoke that executable.
- **Pi is incompatible:** install a CLI version from 0.73.1 (inclusive) to 1.0.0
  (exclusive). The app's Pi SDK packages are pinned to exactly 0.80.10.
- **Expired or revoked:** choose **Reconnect**. If the provider revoked the
  refresh token, complete the browser flow again.
- **Cancelled:** choose **Reconnect** when ready. Cancelling or closing the app
  must leave the existing credential unchanged.
- **Callback port occupied:** another process is using `127.0.0.1:1455`. Quit
  that process or its other Pi login, then retry. Do not disable callback-state
  validation or forward this port to another machine.
- **Browser did not return:** finish in the same browser profile that opened,
  allow the localhost redirect, and retry. A different default browser or a
  privacy extension can interrupt the return to port 1455.
- **Offline, proxy, or provider denial:** restore network/proxy access and verify
  the ChatGPT account is eligible, then retry. The UI reports a sanitized error;
  terminal `pi /login` is an advanced fallback for isolating provider issues.
- **Auth storage corrupt or unreadable:** Pi uses `~/.pi/agent/auth.json`. Check
  that the directory belongs to your user and the file is readable/writable.
  Back up the file privately before repair; do not let the app overwrite invalid
  JSON. Preserve entries for unrelated providers.
- **Connected, but configured model is not reachable:** authentication exists,
  but the configured provider/model diagnostic failed. Verify Pi is available,
  network access works, and the provider/model in Settings is valid. The account
  remains Connected; a consented `pi_agent` run may still fall back to Manual
  Harness results if the provider call fails.

For `No API key found for <provider>`, reconnect `openai-codex`, select a
provider for which Pi already has credentials, or set that provider's supported
environment variable before launching the backend. The standalone `opencode`
CLI has a different credential store; logging into it does not log Pi in.

Never paste or attach `auth.json`, an OAuth authorization/callback URL, an
authorization code, or access/refresh tokens to a bug report. Include only the
sanitized account state, Pi version, configured provider/model names, and the
safe error text shown by the app.

## "Only manual and pi_agent harnesses are available"

`/analyze` currently accepts `manual` and `pi_agent`. The local Qwen/Ollama
harness (`local_qwen`) is **postponed** and disabled — its code is retained but
not selectable. The desktop app uses `manual` by default; `pi_agent` requires
per-project cloud AI consent. See [HARNESS_SPEC.md](HARNESS_SPEC.md).

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
cd backend && PYTHONPATH=. .venv/bin/python -m pytest

# Frontend
cd frontend && npm run typecheck && npm run build
```
