# User Guide

AI Clip Assembler turns raw drone/action footage into a tight 1–3 minute
cut. Import MP4/MOV files, the app suggests the smoothest, most interesting
clips, you pick the keepers, fine-tune the sequence on a timeline, and
export to Final Cut Pro (FCPXML) or any NLE (EDL).

The default `manual` harness runs locally and sends nothing to a provider.
The optional [`pi`](https://github.com/earendil-works/pi-mono) harness may
send sampled frames to its cloud provider only after per-project consent;
source videos stay on your machine.

> Screenshots referenced below live in `docs/images/`. Drop a GIF/PNG in
> that folder and update the caption when capturing a fresh build.

## Before you start

- macOS (Apple Silicon or Intel).
- The backend running on `http://127.0.0.1:8000` and the desktop app open.
  See [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md) to launch both.
- The status bar shows **Online · v…** when the backend is reachable.
  **Offline** falls back to a small set of mock clips so you can still
  explore the UI.

## The workflow

Four tabs, used left to right: **Import → Review → Timeline → Export**.

### 1. Import

![Import screen](images/import.png)

1. Open **Import**, drop one or more `.mp4`/`.mov` files. Each is uploaded
   to the local backend and probed (duration, FPS, resolution, codec) —
   shown in the **Uploaded videos** table.
2. Click **Analyze**. The backend extracts frames, measures stability and
   image quality, detects scenes, assembles candidate clips, and (with
   `pi_agent`) scores each clip's visual interest.
3. *"Analysis complete. Head to Review."* appears when done.

Analysis time scales with footage length and harness (`pi` makes one model
call per candidate clip, ~10–15s each).

### 2. Review

![Review screen](images/review.png)

Candidates are ranked by overall score, shown as cards with per-metric chips
(smoothness, sharpness, exposure, contrast, overall) and the AI's reason.

- Drag **Smoothness ≥** to hide shaky candidates.
- **Include**/**Exclude** a clip from your sequence.
- Included clips appear in the **Accepted order** strip for quick reordering
  and numeric trims.

### 3. Timeline

![Timeline screen](images/timeline.png)

Assemble the final cut. Each accepted clip is a block sized to its trimmed
duration.

- **Reorder**: drag a block; a green indicator shows the drop position.
- **Trim**: drag a block's edge handle (clamped to original bounds).
- **Scrub**: click the ruler/track to move the playhead.
- **Zoom**: −/+ buttons or slider.

Keyboard shortcuts (Timeline tab focused):

| Key | Action |
|-----|--------|
| `L` / `K` / `J` | Play forward / stop / play reverse |
| `Space` | Toggle play / pause |
| `←` / `→` | Move playhead ∓1s |
| `↑` / `↓` | Select previous / next clip |
| `Shift`+`←`/`→` | Move selected clip earlier / later |
| `⌫` / `Delete` | Remove selected clip |
| `+` / `−` | Zoom in / out |

### 4. Export

![Export screen](images/export.png)

1. Open **Export** — shows accepted clip count and total duration.
2. Click **Export for DaVinci Resolve**, **Export FCPXML**, or **Export
   EDL**. The app syncs timeline order/trims to the backend, then writes the
   file.
3. The resulting path is shown with a **Copy** button — import into DaVinci
   Resolve, Final Cut Pro, or any EDL-reading editor (e.g. Premiere).

For folder projects, exports go inside the project folder
(`exports/davinci/`, `exports/fcp/`, `exports/edl/`) with media paths
relative to the export file, so the folder can be moved/copied without
relink prompts. Use **Review export payload** to inspect the exact clip
list, order, and timings.

## Choosing an AI harness

Default is `manual` (no AI, technical-quality only). The optional `pi_agent`
harness uses the `pi` coding agent and requires per-project cloud AI consent.
The local Qwen/Ollama harness is currently **postponed**. See
[HARNESS_SPEC.md](HARNESS_SPEC.md) and the README's *AI Harness* section.

## Connect your AI (optional)

Connect **Claude Desktop** or **Codex** to ask things like *"add the three
smoothest clips to my timeline"* and watch edits appear live in the app, on
whatever project is currently open.

**To connect**: in the app, open **Settings → Connect your AI**. Each
assistant shows **Connected**, **Detected** (installed, not connected), or
**Config not found**. Click **Connect** — the app backs up the assistant's
config, writes its own entry, and shows the backup location. Restart the
assistant to finish (the app prompts you). If the automatic write fails, the
panel shows the config snippet to paste in manually.

**What the assistant can do**: list suggested clips with scores/reasons and
view sampled frames; include/exclude, reorder, trim, split, change speed,
and undo/redo — the same edits as manual use. It cannot trigger footage
analysis — connected assistants only work on an already-analyzed project.
Every assistant edit goes through the app's normal undo history.

**Good to know**: the app must be open with a project loaded, or the
assistant is told to open one instead of failing silently. Your video files
are never uploaded by the app, but whatever the assistant reads (clip names,
scores, frames) becomes part of your conversation with that assistant under
its provider's privacy policy — the same trade-off as choosing a cloud AI
harness. Connecting only adds one entry; other tools stay untouched.

Developers and other MCP-capable clients (Claude Code, Cursor) can connect
at a lower level — see [MCP_SERVER.md](MCP_SERVER.md).

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues (backend
offline, missing `vidstabdetect` filter, pi authentication, etc.).
