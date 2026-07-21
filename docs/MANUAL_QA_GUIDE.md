# Manual QA Launch Guide

This guide launches the current app on macOS for a manual QA session and walks
the full workflow: **import → analyze → review → edit the timeline → export**,
plus the **agent-operable timeline** (external MCP agent + in-app review agent).

For the *measured* real-footage session (timings, recall, DaVinci handoff, and
the agent-operable **Flow F**), use [`VALIDATION_RUNBOOK.md`](VALIDATION_RUNBOOK.md).
File bugs with the template in [`QA.md`](QA.md).

## Current Product State

- Electron frontend creates/opens a **Project** from a footage folder; source
  videos stay in place and app state lives under `clipassembler/`.
- FastAPI backend probes metadata, extracts frames, scores them, and assembles
  rule-based smooth **Candidate Clips**. The default harness is `manual`, which
  runs without AI. The optional `pi_agent` harness (pi CLI → cloud model)
  enriches scores with a visual-interest judgment after per-project consent;
  it falls back to manual scoring on failure.
  `local_qwen` is **postponed/disabled**; `claude_code`/`codex` are not enabled.
- The timeline is a **backend-authoritative Timeline Document**, edited only
  through one reversible **operations core** with **undo/redo**. The Review
  route has a **Timeline editor** (reorder / extend-trim / **speed** /
  **transform** zoom / split / remove) and an in-app **review agent** that
  proposes edits you Accept/Reject.
- While the app runs, the backend exposes a local **MCP server** at
  `http://127.0.0.1:8000/mcp` so an external agent (Claude Code/Cursor) can
  drive the *same* live timeline; edits appear live in the GUI over SSE.
- Export to **FCPXML**, **EDL**, and **Resolve XML** (DaVinci). Speed/transform
  are encoded in FCPXML + Resolve XML; EDL flattens them and warns.

## Prerequisites

Install system tools:

```bash
brew install python node
```

FFmpeg with the `vidstabdetect` filter is required for motion analysis:

```bash
brew install ffmpeg
```

Verify `vidstabdetect` is available:

```bash
ffmpeg -hide_banner -filters | grep vidstabdetect
```

**Caveat:** the standard Homebrew `ffmpeg` bottle may be compiled **without**
`libvidstab` (the `configuration:` line in `ffmpeg -version` lacks
`--enable-libvidstab`). If the grep prints nothing, `brew reinstall ffmpeg`
will not fix it — Homebrew reinstalls the same prebuilt bottle. Replace it
with a source build from the homebrew-ffmpeg tap, with the libvidstab option
enabled explicitly:

```bash
brew uninstall ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libvidstab
```

The tap builds from source; expect 10–30 minutes.

Verify:

```bash
which ffmpeg
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -filters | grep vidstabdetect
python3 --version   # 3.9+
node --version
npm --version
```

The backend MVP requires `vidstabdetect`. The grep check above must list the
filter in the shell you start the backend from — the backend resolves `ffmpeg`
from that shell's `PATH`.

For the `pi_agent` AI harness, install a compatible Pi CLI and use **Settings →
Connections → Review model account** for the normal OpenAI sign-in flow. The
backend inherits `PI_PROVIDER`/`PI_MODEL`/`PI_BIN`/`PI_TIMEOUT_SEC` defaults from
the repo-root `.env`. Terminal login remains an advanced fallback:

```bash
pi /login
pi --provider openai-codex --model gpt-5.4-mini --print --mode text \
   --no-session --no-context-files --no-skills --no-extensions "reply with ok"
```

## Install Dependencies

From the repository root.

Backend (the repo already has `backend/.venv` on Python 3.9; recreate only if
missing):

```bash
cd backend
# python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
```

Frontend:

```bash
cd ../frontend
npm install
npm run typecheck
npm run build
```

Both should be green before manual QA. (`npm run test:backend` runs the same
backend suite from the frontend dir.)

## Launch The App

One terminal, both halves (backend + Electron app, killed together on Ctrl+C):

```bash
cd frontend
npm run dev:with-backend
```

The backend auto-loads the repo-root `.env` on startup. To run the halves in
separate terminals instead, use `npm run dev:backend` and `npm run dev` from
the same directory.

Expected frontend behavior:

- Electron opens a dark editor-style app.
- The Import tab can create/open a folder-backed project with **Create / Open Folder Project**.
- Source videos are listed without copying footage.
- Smoothness threshold defaults to 7.
- You can include, exclude, reorder, and trim accepted clips, and edit timeline
  items (speed/zoom/split) in the Review-route Timeline editor.
- The Export tab can generate EDL, FCPXML, and Resolve XML files.

## Folder Project QA Flow

Use a folder containing one or more top-level `.mp4`, `.mov`, or `.mkv` files.
Nested folders are intentionally ignored in the MVP.

1. Launch the backend and frontend.
2. In the Import tab, click **Create / Open Folder Project**.
3. Choose the footage folder.
4. Confirm the app lists source videos and creates:

```bash
<footage-folder>/clipassembler/project.json
<footage-folder>/clipassembler/samples/
<footage-folder>/clipassembler/analysis/
<footage-folder>/clipassembler/cache/
<footage-folder>/clipassembler/cache/.nosync
```

5. Pick a harness (`manual` for deterministic, `pi_agent` for AI-enhanced) and
   click **Analyze**.
6. Confirm frame samples appear under `clipassembler/samples/` and motion files
   appear under `clipassembler/analysis/motion/`. With `pi_agent`, AI scores
   cache under `clipassembler/analysis/ai-scores/`.
7. Accept one or more clips on the Review tab.
8. Export EDL, FCPXML, and Resolve XML from the Export tab.
9. Confirm exports are written to:

```bash
<footage-folder>/exports/edl/timeline.edl
<footage-folder>/exports/fcp/timeline.fcpxml
<footage-folder>/exports/davinci/timeline.xml
```

Move-folder check:

1. Quit the app.
2. Rename or move the footage folder.
3. Launch the app again.
4. Confirm the sidebar marks the old recent project as missing.
5. Click **Locate** and choose the moved folder.
6. Open the relocated recent project.
7. Confirm the existing `clipassembler/project.json` opens without overwriting
   the source video list.

Rescan check:

1. Add a new top-level `.mp4`, `.mov`, or `.mkv` to the footage folder.
2. Click **Rescan** in the sidebar or Import tab.
3. Confirm the new source video appears in the UI.
4. Confirm `clipassembler/project.json::source_videos` includes the new file
   once and preserves existing entries.

Recent-list and delete-files checks:

1. Click **Remove** on a recent project.
2. Confirm the recent entry disappears and the folder contents remain untouched.
3. Reopen the folder project.
4. Click **Delete project files**.
5. Confirm only `clipassembler/` and `exports/` are deleted.
6. Confirm source videos remain in place.

Overwrite check:

1. Export an EDL or FCPXML.
2. Export the same format again.
3. Confirm the app warns before overwriting.
4. Confirm canceling leaves the existing export untouched.

Empty-folder check:

1. Choose a folder with no top-level supported videos.
2. Confirm the app shows an error.
3. Confirm it did not create `clipassembler/`.

## AI Harness (`pi_agent`) Check

1. With `pi` authenticated, analyze a folder project with the **`pi_agent`**
   harness.
2. Confirm candidate clips carry an AI **Clip Reason** (the "Why" line) and a
   `visual_interest` contribution to the overall score.
3. Force a failure path: temporarily break auth (e.g. `PI_BIN=/bin/false`
   `npm run dev:backend`) and re-analyze. Confirm the run **falls back to manual
   scoring** with a metadata warning rather than crashing — and note the
   fallback is per *video*, not per project.

> Scaling note: `pi_agent` scores clips one subprocess call at a time
> (~9 s/clip measured). On a large realistic set this can approach the speed
> budget — see [`specs/2026-06-19-pi-harness-scaling-design.md`](specs/2026-06-19-pi-harness-scaling-design.md).
> `local_qwen` is postponed/disabled; see `LOCAL_QWEN_SETUP.md` if it is re-enabled.

## Review Model OAuth Manual Matrix

Use a disposable macOS test account or an isolated temporary home directory.
Never copy a real `~/.pi/agent/auth.json` into this repository or use it as a
fixture, and never record real OAuth URLs, codes, or tokens.

1. **Fresh sign-in and persistence:** begin without a Pi auth file, open
   **Settings → Connections**, sign in through the system browser, restart the
   app, and confirm the Review model account remains Connected.
2. **Permissions and provider preservation:** confirm `~/.pi/agent` is mode
   `0700` and `auth.json` is mode `0600`. Start with a synthetic unrelated
   provider entry, reconnect OpenAI, and confirm that entry remains present.
   Inspect only keys/types in the synthetic fixture; never print real values.
3. **Cancel, retry, and cleanup:** cancel a waiting flow, confirm the Cancelled
   state, and retry successfully. Separately close/reopen the modal during a
   wait and confirm the reopened card reports the controller's current state;
   quit the app during a wait and confirm a later launch can sign in. No stale
   completion may overwrite a newer Cancelled or retry result.
4. **Port collision and callback validation:** occupy `127.0.0.1:1455` and
   confirm an actionable failure/retry path. Send a callback with invalid state
   using only synthetic values; confirm it is rejected and the account does not
   become Connected.
5. **Provider failures:** test offline mode, supported proxy failure, account
   denial, and a revoked/expired login. Confirm safe errors, Reconnect behavior,
   and no raw provider response or credential appears in the renderer.
6. **Storage boundaries:** using synthetic fixtures, test corrupt JSON,
   read-only storage, a home path containing spaces/non-ASCII characters, and a
   missing parent directory. Confirm failures do not clobber the file or other
   provider entries.
7. **Pi compatibility:** repeat with the CLI missing, below 0.73.1, at the
   current supported version, and at/above 1.0.0. Confirm missing/incompatible
   detail is separate, Sign in/Reconnect is disabled when necessary, and the
   packaged backend and account card inspect the same executable.
8. **Diagnostics and consent:** after sign-in, confirm diagnostics reruns. Test
   both reachable and “Connected, but configured model is not reachable.” Grant
   project cloud AI consent, run `pi_agent`, then revoke consent and confirm the
   backend refuses another provider-backed analysis despite the connected
   account.
9. **MCP regression:** confirm the separate **Connect your AI** Claude Desktop
   and Codex detection/connect/reconnect controls behave identically before and
   after Review model sign-in/logout/cancellation.
10. **Browser and architecture matrix:** complete the flow in Safari and one
    non-default browser on both Apple Silicon and Intel packaged builds.
11. **Secret scan:** inspect captured Electron/backend logs, screenshots, and
    the bug-report draft. They must contain no `auth.json` contents, OAuth
    authorization/callback URLs, authorization codes, access tokens, or refresh
    tokens. Record only sanitized states, versions, and error text.

## Timeline Editing Check (operations core + undo/redo)

On the Review route, after accepting clips:

1. In the **Timeline editor**, for one item:
   - **Reorder** it (↑/↓) and confirm the order changes.
   - **Extend/trim** via the In/Out fields; confirm bounds clamp to the source
     video duration (you cannot extend past the source).
   - Set **Speed** to `0.5` and `2.0`; confirm the "Ns on timeline" effective
     duration updates.
   - Set **Zoom** (transform scale) to `1.5`.
   - **Split** the item; confirm it becomes two items.
   - **Remove** an item.
2. Use **Undo**/**Redo** and confirm each operation reverses/replays.
3. Quit and reopen the project; confirm the timeline (speed/transform/splits)
   is restored.
4. Export Resolve XML and confirm speed/transform survive; export EDL and
   confirm the response/file carries the **flatten warning**.

## Backend Real-Footage Smoke Test (no GUI)

Use a short local drone MP4 or MOV. Replace the path below.

```bash
VIDEO_PATH="/absolute/path/to/your/drone-footage.mp4"
cd /path/to/ai-clip-assembler
backend/.venv/bin/python scripts/backend_smoke_test.py "$VIDEO_PATH"
```

The script creates a project, uploads the video, runs manual analysis, prints
candidate clip timings and scores, and generates EDL + FCPXML exports.

The equivalent manual API steps (folder-backed project):

```bash
PROJECT_FOLDER="/absolute/path/to/your/footage-folder"
PROJECT_ID=$(curl -s -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:8000/projects/from-folder \
  -d "{\"folder_path\":\"${PROJECT_FOLDER}\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])')
echo "$PROJECT_ID"

curl -s -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/analyze" \
  -d "{\"project_id\":\"${PROJECT_ID}\",\"harness_id\":\"manual\",\"preferences\":{
        \"sample_fps\":1,\"smoothness_threshold\":7,
        \"min_clip_duration_sec\":3,\"max_clip_duration_sec\":15,
        \"target_duration_sec\":120}}" | python3 -m json.tool
```

Swap `"harness_id":"manual"` for `"pi_agent"` to exercise the AI path.

Expected backend behavior:

- Metadata includes duration, FPS, resolution, and codec.
- Analysis returns `status: "complete"`.
- Smooth footage produces one or more candidate clips above the 7 threshold.
- Missing `ffmpeg`/`ffprobe` yields an actionable error, not a traceback.

## Agent-Operable Timeline (MCP + review agent)

External agent driving the live timeline:

1. Keep the app running (backend on `http://127.0.0.1:8000`).
2. Connect Claude Code:
   `claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp`.
3. Ask it to `list_candidates` for the open `project_id`, read frames with
   `get_frame_paths`, then apply an op (`include`, `set_speed`, `split_item`).
4. Confirm the edit appears in the GUI **live** (no manual refresh).
   See [`MCP_SERVER.md`](MCP_SERVER.md) for the full tool list.

In-app review agent:

1. On the Review route, read the chat panel's opening message + proposal cards.
2. **Accept** a proposal → confirm the timeline updates and the change is
   undoable. **Reject** one → confirm the timeline is unchanged.

The full measured version (split/extend/speed/transform on real footage,
save+reload, Resolve zero-relink, EDL flatten warning) is **Flow F** in
[`VALIDATION_RUNBOOK.md`](VALIDATION_RUNBOOK.md).

## DaVinci Resolve Validation

Prefer **Resolve XML** (folder projects): media paths are written relative to
the export directory, so the project folder stays portable with zero relink.

1. Open Resolve and create a new project.
2. **File > Import > Timeline > Import AAF, EDL, XML...** and choose
   `<footage-folder>/exports/davinci/timeline.xml`.
3. Confirm the timeline imports with **zero relink prompts**, clip count/order
   match, and any speed/transform edits are present.
4. Copy the whole project folder to another drive and repeat — still zero relink.

EDL fallback (broad compatibility; speed/transform are flattened):

1. Import the original source video into the Media Pool.
2. Import `<footage-folder>/exports/edl/timeline.edl` the same way.
3. Confirm clip count matches and source timing is plausible.

Check:

- Timeline imports without an error dialog.
- Clip count, order, and in/out points match the app's timeline.
- Vertical footage is upright or the orientation issue is recorded.
- Playback timing is plausible and does not appear unintentionally sped/slowed.

Known limitation: export metadata for non-30fps and rotated vertical media is
tracked in GitHub issue #19.

## QA Notes To Capture

For each test clip, record:

- Source video filename, duration, codec, resolution, and FPS.
- Whether the shot is smooth, shaky, blurry, overexposed, or mixed.
- Harness used (`manual` / `pi_agent`) and number of candidate clips produced.
- Whether candidate clips match what you would keep manually.
- Any confusing score or **Clip Reason** text.
- For timeline edits: which operations were applied and whether they survived
  save+reload and export.
- For the agent flows: whether the external-agent edit appeared live, and
  whether review-agent Accept/Reject behaved correctly.

File bugs using the template in [`QA.md`](QA.md).
