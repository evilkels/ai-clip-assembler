# QA Plan

## Scope

This QA plan covers the drone-first workflow: importing local drone footage,
scoring smooth/sharp candidate clips (rule-based `manual` or AI-enhanced
`pi_agent`), reviewing suggestions, building and editing a backend-authoritative
timeline (reorder/trim/speed/transform/split with undo/redo), optionally driving
that timeline from an agent (in-app review agent or an external MCP agent), and
exporting to a professional editor format (FCPXML, EDL, Resolve XML).

## Primary Persona

The primary tester is a **Drone User** with MP4 or MOV footage who wants to quickly remove shaky spans and keep smooth usable shots. Testing should favor real drone footage over synthetic media whenever possible.

## Test Assets

Maintain a small local-only test set:

| Asset | Purpose | Expected signal |
| --- | --- | --- |
| Smooth drone pan, 10-30s | Happy path smooth footage | High **Smoothness Score**, likely accepted |
| Shaky drone movement, 10-30s | Filtering bad footage | Low **Smoothness Score**, hidden by 7+ filter |
| Blurry motion segment | Sharpness penalty | Low **Sharpness Score** |
| Overexposed sky/water segment | Exposure penalty | Low **Exposure Score** |
| Mixed source video, 1-3 min | End-to-end candidate extraction | Multiple ranked **Candidate Clips** |
| H.264 MP4 and H.265 MOV | Codec coverage | Metadata and frame extraction succeed |

Do not commit private footage to the repository. Store sample assets outside git and document only their names, duration, codec, and expected behavior.

## MVP Acceptance Tests

### 1. Project And Import

1. Start the backend and frontend in development mode.
2. Create a new project.
3. Import one H.264 MP4 source video.
4. Confirm metadata is visible or available through the API: duration, FPS, resolution, codec.
5. Repeat with one H.265 MOV source video.

Pass criteria:
- The app does not upload footage to a remote service.
- Import failure messages are actionable when `ffmpeg` or `ffprobe` is missing.
- Metadata matches the source video within normal probe tolerance.

### 2. Frame Sampling And Technical Scores

1. Analyze a smooth drone source video.
2. Analyze a shaky drone source video.
3. Compare generated scores.

Pass criteria:
- Smooth footage ranks above shaky footage by **Smoothness Score**.
- Blurry footage receives a lower **Sharpness Score** than sharp footage.
- Overexposed or underexposed footage receives a lower **Exposure Score**.
- Scores are on a stable 0-10 scale and are understandable on the **Review Board**.

### 3. Candidate Clip Assembly

1. Analyze a mixed source video with both smooth and shaky spans.
2. Use the default smoothness threshold of 7+.
3. Inspect generated **Candidate Clips**.

Pass criteria:
- Candidate clips are usually 3-15 seconds unless preferences are changed.
- Shaky spans are excluded or ranked low.
- **Clip Reason** explains the technical basis, such as stable, sharp, or exposure quality.
- The total suggested duration is near the requested target duration when enough good footage exists.

### 4. Review Board

1. Open the **Review Board**.
2. Change the **Smoothness Score** threshold.
3. Accept, reject, and reorder candidate clips.

Pass criteria:
- The default filter is 7+ smoothness.
- Accepted and rejected states are visually distinct.
- Reordering accepted clips changes the export order.
- The UI avoids AI-only language for rule-based scores.

### 5. Export

1. Accept at least three candidate clips from two source videos.
2. Export FCPXML.
3. Import the FCPXML into Final Cut Pro.
4. Export EDL and inspect it in a text editor or compatible tool.

Pass criteria:
- Export contains the accepted clips in order.
- Source references point to the original local media.
- Final Cut Pro imports FCPXML without errors.
- EDL edit events have plausible source and timeline timecodes.
- FCPXML and Resolve XML encode any **Speed**/**Transform** edits; EDL flattens
  them and the export response carries a flatten warning.

### 5a. AI Harness (`pi_agent`)

1. Analyze a folder project with the `pi_agent` harness (pi CLI authenticated).
2. Break the harness (e.g. `PI_BIN=/bin/false`) and re-analyze.

Pass criteria:
- AI scoring adds a visual-interest contribution and a written **Clip Reason**.
- On failure the run falls back to `manual` scoring (per video) with a metadata
  warning — no crash, no lost project.

### 5b. Agent-Operable Timeline

1. In the Review-route **Timeline editor**, apply reorder / extend / speed /
   transform / split / remove, then undo/redo; save, reopen, and re-export.
2. Connect an external agent over MCP (`/mcp`) and apply one operation.
3. Use the in-app review agent: Accept one proposal, Reject another.

Pass criteria:
- Edits go through the operations core, are undoable, and survive save+reload.
- The external-agent edit appears in the GUI live (SSE), driving the same
  document.
- Accept replays the proposal onto the timeline; Reject leaves it unchanged.
- Full measured version: **Flow F** in `VALIDATION_RUNBOOK.md`.

### 6a. DaVinci Resolve XML Validation (folder projects)

1. Create a folder project, analyze, accept clips, and click **Export for DaVinci Resolve**.
2. Open `<project>/exports/davinci/timeline.xml` in Resolve via **File > Import > Timeline > Import AAF, EDL, XML...**.
3. Confirm media resolves with zero relink prompts (paths in the XML are relative to the export directory).
4. Copy the whole project folder to another location/drive and repeat step 2 from the copy.

Pass criteria:
- Resolve imports the XMEML timeline without an error dialog.
- No relink prompt appears, in either the original or the moved copy.
- Clip count, order, and in/out points match the app's timeline.

### 6. DaVinci Resolve EDL Validation

1. Run `scripts/backend_smoke_test.py` against a real local drone MP4 or MOV.
2. Import the original source video into DaVinci Resolve's Media Pool.
3. Import the generated `timeline.edl` with **File > Import > Timeline > Import AAF, EDL, XML...**.
4. Inspect the imported timeline on the Edit page.

Pass criteria:
- Resolve imports the EDL without an error dialog.
- The imported timeline clip count matches the smoke-test output.
- Clip durations and source positions are plausible.
- Media is online or can be relinked to the original/copy without changing edit points.
- Playback timing is plausible for the source frame rate.
- Vertical media orientation is recorded as pass/fail.

Known limitation:
- Source frame rate and vertical orientation preservation is tracked separately in #19.

## Closeout Evidence (per validation run)

Capture validation notes for:

- One smooth drone clip, ideally 10-60 seconds.
- One shaky drone clip, ideally 10-60 seconds.
- One mixed smooth/shaky source, ideally 1-3 minutes.
- One longer source, ideally 5-10 minutes as a practical MVP performance check, or a full 1-hour 4K run if available.
- At least one H.264 MP4 and one HEVC/H.265 MP4 or MOV.
- EDL import into DaVinci Resolve.
- FCPXML generation, with FCP import if Final Cut Pro is available.
- Known limitations linked to follow-up issues, especially #19 for FPS/orientation export metadata.

Minimum closeout evidence:
- Source filename, duration, codec, FPS, and resolution for each clip.
- Smoke-test command and result.
- Candidate clip count and total timeline duration.
- Whether the selected clips match expected smooth/shaky behavior.
- Editor import result and relink/orientation notes.
- Processing time for the longer source.

## Regression Checks

Run these after the backend and frontend MVP branches are present locally:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
```

```bash
cd frontend
npm install
npm run typecheck
npm run build
```

Synthetic end-to-end (real pipeline on generated footage; covers the operations
core, an MCP round-trip, and export speed/transform):

```bash
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

Add a real-video smoke test whenever `ffmpeg` and `ffprobe` are installed:

1. Import a short drone MP4.
2. Run manual analysis.
3. Confirm at least one **Candidate Clip** is produced for smooth footage.
4. Confirm the **Review Board** can display the result.

## Known QA Risks

- Real drone footage can vary widely by gimbal behavior, lighting, codec, and frame rate.
- Synthetic tests can prove scoring mechanics but not editorial usefulness.
- Visual-interest discrimination depends on the `pi_agent` AI harness; with the
  `manual` harness, smooth-but-boring and smooth-and-strong footage rank alike.
- `pi_agent` requires the pi CLI authenticated and reachable; sequential
  per-clip scoring can approach the speed budget on large sets (see
  `specs/2026-06-19-pi-harness-scaling-design.md`).
- Export validation requires the actual target editor, especially Final Cut Pro for FCPXML.

## Bug Filing Template

Use this template for QA findings:

```md
## What happened

[Actual user-visible behavior]

## What I expected

[Expected behavior using project domain terms]

## Steps to reproduce

1. [Source video type, duration, codec]
2. [Import/analyze/review/export action]
3. [Observed result]

## Additional context

[Scores, threshold, export format, whether footage is smooth/shaky/blurry/overexposed]
```
