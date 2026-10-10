# iPhone Footage End-to-End Test — 2026-10-10

Real iPhone footage run through the full Editor flow in the real Electron app:
open folder → analysis → Review Board → Timeline → Export (EDL, FCPXML,
Resolve XML) with source audio. No source code was changed. Evidence is in
[`2026-10-10-iphone-footage-test/`](2026-10-10-iphone-footage-test/):
`screenshots/NN-*.png` plus the three export files and the DTD validation
output in `exports/`.

## Environment

| | |
|---|---|
| **Build tested** | `origin/main` @ `13d4be0` (**v0.4.0**). The brief said "current `main`, v0.1.6", but the local `main` checkout is 170 commits behind `origin/main`. "Newest" was the intent, so I tested `origin/main` from a detached worktree at `~/DEV/ai-clip-assembler-wt-iphone-test`; the shared checkout was not touched. |
| Machine / OS | Intel Core i9-9880H, macOS 26.6.2 |
| Runtime | Electron 42.4.0 (unpackaged `electron-vite build`, driven by Playwright `_electron`), FastAPI on :8000 (Python 3.11.15), FFmpeg 9.0.2 (evermeet build, has `vidstabdetect`) |
| Harness | Manual / Rule-based (no cloud consent) |
| Project folder | `~/Movies/clip-assembler-test-project-2026-10-10/` (copies of the originals; SHA-1 checked identical; originals untouched) |
| Extra HEVC project | `~/Movies/clip-assembler-test-project-2026-10-10-hevc/`: a synthesized HEVC Main10, HLG-tagged copy of IMG_1023 with the rotation matrix kept (see "HEVC" below) |

### The footage (ffprobe)

Recorded on an iPhone 15 Pro (iOS 27.0) on 2026-10-10, 12:48–13:58 +03:00, 53.5 s in total.

| File | Codec | Coded | Rotation | `r_frame_rate` | `avg_frame_rate` (VFR) | Audio |
|---|---|---|---|---|---|---|
| IMG_1022.mov | H.264 High, 8-bit BT.709 | 1920×1080 | −90° | 60000/1001 | 59.93 | AAC 48 k stereo |
| IMG_1023.mov | 〃 | 〃 | −90° | 60000/1001 | 59.94 | 〃 |
| IMG_1028.mov | 〃 | 〃 | −90° | 60000/1001 | 59.94 | 〃 |
| IMG_1029.mov | 〃 | 〃 | −90° | 60000/1001 | **59.96** | 〃 |

Things that differ from the brief's assumptions: the clips are **H.264, not
HEVC**, so the phone is on "Most Compatible". **Audio is stream 0 and video is
stream 1**, and there are 5 extra `mebx` metadata tracks. `creation_time` is
the export/transfer time, while `com.apple.quicktime.creationdate` holds the
real recording time.

## What worked

- **Folder open and probing.** All four .mov files listed, with display
  resolution **1080×1920 ↕** taken correctly from the −90° display matrix.
  Picking the video stream by `codec_type` copes with audio being stream 0.
  The 5 data tracks caused no trouble. (`01-folder-opened.png`)
- **Source preview playback.** H.264 .mov decodes in Electron and plays
  **upright** (videoWidth×Height 1080×1920) with audio. Audio bytes were
  decoded; 51 of 587 frames were dropped at 60p on this Intel machine, which is
  minor. (`02-source-preview.png`)
- **Analysis.** Manual Harness, about 50 s for 53.5 s of footage, with no
  errors in the backend log. Frame samples are extracted upright (960×1706).
  5 Candidate Clips were found. (`04`, `05`)
- **Review Board.**
  - Candidate cards show upright portrait posters.
  - Inline candidate playback stays within its bounds (for example 9.0 → 12.0,
    then resets).
  - Reject/"Remove from working timeline" updates the backend document
    (`decisions: excluded`, 5 → 4 items).
  - The 0.5× slow-mo suggestion plays at `playbackRate 0.5`. (`06`–`09`)
- **Timeline.**
  - Sequence playback crosses clip boundaries cleanly (IMG_1029 → IMG_1023)
    with sound.
  - Reorder (↑/↓), speed 0.5×, zoom 1.2× and a non-integer OUT (10.4 s) all go
    through the ops core: revision 7, header 39.4 s. (`10`–`14`)
- **Export.** All three formats are written to `exports/{edl,fcp,davinci}/`.
  Overwrite confirmation works (`window.confirm`). (`15`–`19`)
- **Source audio in exports.**
  - FCPXML assets carry `hasAudio`, `audioChannels="2"` and `audioRate="48000"`
    (`audioRole="dialogue"`).
  - Resolve XML has 2 linked audio tracks × 4 clipitems.
  - The EDL uses `AA/V`.
  - The EDL warning about flattened Speed/Transform shows both in the UI and in
    the file.
- **Rotation in exports (#19 holds).** FCPXML `format` and Resolve
  `samplecharacteristics` are both **1080×1920**.
- **HEVC.** A 10-bit HEVC (`hvc1`, Main10, BT.2020/HLG-tagged, −90°) copy
  probes as `hevc 1080×1920 59.94`. It previews upright with audio in Electron,
  and analysis plus frame sampling work. Its frames match the H.264 ones.
  (`21`, `22`, `23-h264-vs-hevc-sample-frames.jpg`) Caveat: the test clip is
  SDR content relabelled as HLG, so real HDR tone-mapping of sample frames and
  posters is **not** verified.

## Bugs

Severity: **P1** = breaks the handoff or edit order; **P2** = wrong but
workable; **P3** = cosmetic.

### P1-1: FCPXML fails Apple's FCPXML 1.10 DTD (#80 reproduces on main)

- **Repro:** export FCPXML from this project, then run
  `xmllint --dtdvalid FCPXMLv1_10.dtd timeline.fcpxml`, using the DTD fixture
  from PR #100's branch.
- **Result:** 8 errors. For each of the 4 assets:
  `No declaration for attribute src of element asset` and
  `expecting (media-rep+ , metadata?)`. Final Cut Pro will reject the import,
  as described in #80.
- **Evidence:** `exports/timeline.fcpxml`, `exports/fcpxml-dtd-validation.txt`.
- **Cause:** `backend/src/export_engine.py:437` puts `src` on `<asset>`
  instead of a `<media-rep kind="original-media">` child.
- **Fix in flight:** PR #100 (open, unmerged).
- **Other problems in the same file:**
  - Format name `FFVideoFormat1080x1920p59.96` (`export_engine.py:424`) is not
    a real FCP format name.
  - All times are `N/1000s` (`export_engine.py:23-25`), which is not aligned to
    1001/60000 frames.
  - The output has no XML declaration or `<!DOCTYPE fcpxml>`
    (`export_engine.py:509`).

### P1-2: iPhone VFR makes 59.94 footage export as true 60p, and PR #100 doesn't fix it

- **Repro:** import this footage, then export FCPXML or Resolve XML.
- **Result:**
  - The UI lists the four clips as 59.93 / 59.94 / 59.94 / 59.96 fps.
  - FCPXML writes `frameDuration="100/6000s"` (60p).
  - Resolve XML writes `timebase 60, ntsc FALSE` for the sequence and every
    file.
  - The EDL counts 60 fps. Its record-out `00:00:30:24` should be about `:23`,
    because the frame count drifts 0.1% (≈3.6 s per hour of timeline).
- **Evidence:** `exports/*`, `01-folder-opened.png` (FPS column).
- **Cause, in three steps:**
  1. `backend/src/video_probe.py:100` takes `avg_frame_rate`, which iPhone VFR
     pushes off the nominal rate. `r_frame_rate` is exactly `60000/1001`.
  2. `export_engine.py:37-49` (`choose_timeline_fps`) takes the **max** across
     sources: 59.96.
  3. `abs(fps - 59.94) < 0.02` (`export_engine.py:31`, `:189`, `:195`) misses,
     because `59.96 - 59.94 == 0.0200000000000031` in floating point. The rate
     therefore falls through to `round()` → 60.
- **PR #100:** I ran its `fcpx_frame_duration` on these values. It has the same
  0.02 window, still reads `avg_frame_rate` and still takes `max()`. Result:
  59.93/59.94 → `1001/60000`, but **59.96 → `1/60`**. Merging #100 as-is would
  still produce a 60p timeline for this footage.
- **Suggested direction:** use `r_frame_rate` (or snap to the nearest standard
  rate with a wider tolerance), and pick the timeline rate by majority or by
  first used source rather than the max.

### P1-3: Chronological order uses the transfer time, not the recording time

- **Repro:** import the footage and look at the Date column. It reads
  19:02 / 19:02 / 19:03 / **18:57**, but the real recording times are 12:48,
  12:52, 13:33 and 13:58 (+03:00).
- **Result:** the auto-draft Timeline and all three Suggested cuts **open with
  IMG_1029, the last shot of the day**. The draft order was
  1029 → 1022 → 1023 → 1023 → 1028; shooting order is 1022 → 1023 → 1028 →
  1029. The Date column is also about 6 h off.
- **Evidence:** `01-folder-opened.png`, `06-review-board.png`
  ("clip 1 of N · IMG_1029.mov" on every cut), and the timeline document before
  reordering (`10-timeline.png`).
- **Cause:** `backend/src/video_probe.py:115-120` (`extract_created_at`) reads
  only `format.tags.creation_time`. AirDrop, Photos export and many upload
  paths rewrite that value. It should prefer `com.apple.quicktime.creationdate`
  (the true local capture time, with offset). The value feeds
  `analysis_service.py:348` → `assembly_profiles.py:78-87`
  (`_capture_order_key`), and 3 profiles default to `"chronological"`
  (`assembly_profiles.py:31,39,47`).

### P2-1: Resolve XML uses relative `pathurl`

- **Result:** `pathurl` is `../../IMG_1023.mov`, not
  `file://localhost/…`. Resolve's xmeml importer normally needs an absolute URL
  to auto-link media.
- **Status:** not verified in Resolve, which isn't installed here.
- **Cause:** `export_engine.py:323` together with `api.py:1456`
  (`media_base_path` is set for folder projects). The Export page copy also
  says "Media paths stay relative" (`15-export-page.png`). Fixed by PR #100
  (ADR 0009).

### P2-2: Timeline transport clock freezes after playback

- **Repro:**
  1. On Timeline, play, then Stop.
  2. Reorder, retime or select items.
- **Result:** the clock stays at **"0:16.7 / 0:30.0"**. Meanwhile the playhead
  is elsewhere, the item overlay says "Timeline 0:29.0", and the sequence is
  now **39.4 s**. The clock no longer reflects playhead or total.
- **Evidence:** `12-timeline-selected.png`, `14-timeline-edited.png`.
- **Suspected cause:** `frontend/src/renderer/src/components/Timeline.tsx:196-197`
  (`paintPlayhead`) sets `timecodeRef.current.textContent` directly on a span
  whose children React also renders (`Timeline.tsx:675-677`). Replacing
  React's text nodes detaches them, so later renders update orphaned nodes.

### P2-3: Analysis status shows finished videos as "Not analyzed" mid-batch

- **Repro:** select 4 files and click Analyze.
- **Result:** the Analysis column moves "Running" from row to row, but rows
  that have finished go back to **"— Not analyzed"** until the whole batch
  completes. All four only flip to ✓ at the end.
- **Evidence:** poll log in this session; `04-analysis-running.png`.
- **Cause:** `frontend/src/renderer/src/routes/Import.tsx:116` derives
  `analyzedIds` from the Candidate Clips list, which is only refreshed when the
  batch finishes.
- **Latent consequence (not reproduced):** an analyzed file with zero
  Candidate Clips would read "Not analyzed" forever. I couldn't trigger this
  because the fallback-for-scene-coverage rule kept 1 clip per file even at
  steadiness 9.8 (`20-regenerate-strict.png`).

### P3-1: Thumbs and Compact views collapse into a ~200 px column, and Thumbs labels .mov as "MP4"

- **Evidence:** `03-thumbs-view.png`, `03b-compact-view.png`. The cards are a
  single 194 px column with blank placeholders labelled "MP4" and no poster
  frame.
- **Cause:**
  - `.source-video-thumbs` (`styles.css:1474`) and `.source-video-compact`
    (`styles.css:1507`) lack `grid-column: 1 / -1`. They sit in column 1 of
    `.source-video-browser`'s `minmax(0,1fr) auto` grid (`styles.css:1324`),
    where the `auto` tools column takes 867 px.
  - The label is hard-coded at `components/SourceVideoBrowser.tsx:217`.

## UX friction (Editor's view)

1. **Vertical footage is shown in 16:9 frames everywhere except the
   candidate grid.**
   - Suggested-cut players (`.version-player`, `styles.css:2362`) are about 70%
     black pillarbox.
   - The Timeline preview draws a 16:9 outline around a 9:16 image.
   - The clip info bar (`Audio · 2ch IMG_1029.mov Source…`) overlays the
     video. (`06`, `10`)

   A phone-first Editor reads this as "the output will be landscape".
2. **Suggested-cut cards.**
   - The ▶ button overlaps the title ("Pu▶ny Social Cut").
   - All three cards say "Current suggestion", so it isn't clear which one the
     working timeline currently matches.
3. **Timeline track.**
   - Blocks have no thumbnails or waveforms.
   - The filename and duration on each block are near-invisible (pink on pink).
   - The "All items" side list drops filenames and overflows horizontally,
     clipping ✕ (Remove) at the right edge. (`10`, `14`)
4. **Bounds are edited as plain seconds** (`step 0.1`). There is no frame or
   timecode entry and no snap to source frames, so non-frame-aligned bounds
   (10.4 s) go straight into exports.
5. **Two durations on each export card:** "39.4s effective" next to "Backend
   report: 30.4s". Without context, the second number looks like a bug.
6. **Every export is named `timeline.*`, with event and project both called
   "AI Clip Assembler"** (`api.py:1433,1446,1459`). Re-exporting overwrites the
   previous handoff, and importing two projects into one FCP library gives two
   identically named projects. Using the Project name plus a revision or
   timestamp would help.
7. **EDL is the preselected format** on Export, although FCPXML is the
   documented primary format.
8. **Copy and labels.**
   - The Import header says "upload drone footage" (`Import.tsx:413`).
   - The progress step "Scoring clips with AI" (`Import.tsx:33`) shows under
     the Manual Harness.
   - The footer says "1 sources loaded" (`AppShell.tsx:137`).
   - The FPS column shows VFR averages (59.93/59.96) rather than 59.94.
9. **Truncated project names.** Two Projects whose names share a prefix are
   indistinguishable in the sidebar (`clip-assembler-test-…`). A "Remove
   <project>" button sits right next to them. (`21-hevc-preview.png`)
10. **Review previews start muted.** The header mute icon shows muted while the
    slider sits at 80%. The source-preview modal plays unmuted, so the two are
    inconsistent.
11. **Weak candidate-card details.** Duration badges on candidate cards are
    dark-on-dark and barely legible. Index badges are hard to read over bright
    sky.

## Not verified

- Actual import into Final Cut Pro or DaVinci Resolve: neither is installed.
  The DTD check stands in for FCP.
- Real HDR (Dolby Vision / HLG) tone-mapping, real HEVC iPhone originals,
  ProRes, 4K60 or 24/30 fps mixes.
- The packaged DMG with its bundled FFmpeg.
- The Pi (cloud) harness and the In-App Review Agent (no consent was given).

## Suggested issues (prioritized)

1. **Exports: snap iPhone VFR to 59.94 and stop picking the max source rate.**
   Use `r_frame_rate` or a wider snap, choose the timeline rate by majority,
   and add an export fixture with `avg_frame_rate` 59.96. This blocks the value
   of #100, so PR #100 should take it on before merge (P1-2).
2. **Merge PR #100** (FCPXML 1.10 DTD validity plus absolute media URLs),
   re-validated against this footage (P1-1, P2-1).
3. **Capture time: prefer `com.apple.quicktime.creationdate`** over
   `creation_time` for chronological ordering and the Date column (P1-3).
4. **Vertical-aware previews.** Size the Review cut players and the Timeline
   preview frame to the sequence aspect, and move the info bar off the image
   (UX 1–2).
5. **Timeline transport clock stops updating after playback** (P2-2).
6. **Per-video analysis status from analysis results, not from Candidate
   Clips** (P2-3, plus the latent zero-candidate case).
7. **Export naming:** name the event and project after the Project and version
   or timestamp the export files (UX 6).
8. **Source browser polish:** Thumbs/Compact grid span, real posters, the
   .mov label, and copy fixes (P3-1, UX 8).

## Test-harness notes (for repeating this)

- The host shell exports `ELECTRON_RUN_AS_NODE=1` (this session runs inside an
  Electron app). The variable must be removed before launching Electron,
  otherwise `electron.app` is undefined at `out/main/index.js:914`.
- `npm ci` with install scripts blocked skips Electron's binary download. Run
  `node node_modules/electron/install.js`.
- The native folder picker was stubbed through Playwright
  `app.evaluate(({dialog}) => dialog.showOpenDialog = …)`. `window.confirm`
  prompts (overwrite, regenerate) need a `page.on('dialog')` handler, because
  Playwright auto-dismisses them.
- Cleanup: `git worktree remove ~/DEV/ai-clip-assembler-wt-iphone-test` and
  delete the two `~/Movies/clip-assembler-test-project-2026-10-10*` folders
  when no longer needed.
