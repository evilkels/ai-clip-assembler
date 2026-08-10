# User Guide

AI Clip Assembler turns raw drone/action footage into a tight 1–3 minute
cut. Import MP4/MOV files, review suggested clips, refine the Timeline, and
export to Final Cut Pro (FCPXML), DaVinci Resolve, or any EDL-reading editor.

The default `manual` harness stays local. Optional `pi_agent` sends selected
Frame Samples to its configured cloud provider for visual scoring only after
per-project consent; source videos stay on your machine.

> Screenshots live in `docs/images/`; update them when capturing a fresh build.

## Before you start

- macOS (Apple Silicon or Intel).
- Run the backend on `http://127.0.0.1:8000` and open the desktop app; see
  [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md).
- **Online · v…** means the backend is reachable. **Offline** uses mock clips.

## The workflow

Four tabs, used left to right: **Import → Review → Timeline → Export**.

### 1. Import

![Import screen](images/import.png)

1. Drop `.mp4`/`.mov` files. The local backend probes duration, FPS,
   resolution, and codec.
2. Click **Analyze**. The backend samples frames, measures technical quality,
   detects scenes, builds candidates, and optionally adds Pi visual scoring.
3. Continue when *“Analysis complete. Head to Review.”* appears.

Analysis time scales with footage and harness; Pi makes a model call per clip.

### 2. Review

![Review screen](images/review.png)

Candidates show metric chips and reasons. Adjust generation on Import; on
Review, filter by smoothness, browse Look Groups, choose Short/Medium/Long,
include/exclude clips, and reorder accepted clips. Excluded clips never enter
AI proposals.

### 3. Timeline

![Timeline screen](images/timeline.png)

The page renders every backend Timeline Item in document order. Repeated uses
of one Candidate Clip remain separate items; each item's effective duration is
its source span divided by Speed. The visual track and Timeline editor mutate
the selected item by `item_id` through the backend Operations core. Speed and
Transform values are editable; full pan/crop preview remains pending visual
QA.

Reorder items, drag edges to trim, click to scrub, and zoom. Shortcuts:

| Key | Action |
|-----|--------|
| `L` / `K` / `J` | Forward / stop / reverse |
| `Space` | Play / pause |
| `←` / `→` | Move playhead ∓1s |
| `↑` / `↓` | Select previous / next Timeline Item |
| `Shift`+`←`/`→` | Move selected Timeline Item |
| `⌫` / `Delete` | Remove selected Timeline Item |
| `+` / `−` | Zoom in / out |

### 4. Export

![Export screen](images/export.png)

Choose Resolve XML, FCPXML, or EDL. Folder-project exports live under
`exports/{davinci,fcp,edl}` with relative media paths. Use **Review export
payload** to inspect every ordered Timeline Item before importing into your
NLE: repeated items, `item_id`, source clip and resolved file metadata, bounds,
Speed, and Transform are shown. Export reads the current backend Timeline
Document directly; it does not first save the Review page's legacy order or
trim projection. Each result keeps its file path, item count, effective
duration, status, backend duration metadata, and warnings. EDL warns when Speed
or Transform was flattened; FCPXML and Resolve XML carry those supported values.
Existing-file exports ask for overwrite confirmation, and a Resolve XML result
offers **Open in DaVinci Resolve**.

## Choosing an AI harness

`manual` is local/default. `pi_agent` requires a configured provider and
per-project cloud consent. Local Qwen/Ollama is postponed. See
[HARNESS_SPEC.md](HARNESS_SPEC.md).

## Review model account (optional)

To use an OpenAI ChatGPT subscription through Pi:

1. Install a compatible Pi CLI. Open **Settings → Connections**; the Review
   model card reports ready, missing, or incompatible.
2. Choose **Sign in**, complete OpenAI authentication in the system browser,
   and return when the card says **Connected**. Use **Reconnect** after expiry
   and **Cancel** to stop a waiting flow.

Pi owns `~/.pi/agent/auth.json`; tokens never enter the renderer. Signing in
does not install Pi, select a harness, upload footage, or grant project consent.

## Connect your AI (optional)

Claude Desktop or Codex can inspect candidates and edit the already-analyzed
project currently open in the app. This MCP connection is separate from the
in-app Review model account.

In **Settings → Connections → Connect your AI**, each assistant reports
**Connected**, **Detected**, or **Config not found**. Click **Connect**; the app
backs up and updates its configuration, then asks you to restart the assistant.
If automatic setup fails, paste the displayed snippet manually.

Connected assistants can view candidates/frames and include, exclude, reorder,
trim, split, change speed, and undo/redo. They cannot trigger analysis. The app
must be open with a project loaded. Anything the assistant reads enters its
conversation under that provider's privacy policy; source video is not uploaded
by the app. See [MCP_SERVER.md](MCP_SERVER.md) for lower-level clients.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for backend, FFmpeg, Pi sign-in,
OAuth callback, diagnostic, and export problems. Never share Pi auth contents,
OAuth URLs/codes, or tokens in logs or bug reports.
