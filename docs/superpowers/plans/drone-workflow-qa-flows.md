# Plan: QA Flows For The Drone Clip Extraction Workflow

Status: draft, awaiting review
Owner: TBD
Related: `docs/QA.md` (technical acceptance tests), `docs/MANUAL_QA_GUIDE.md` (launch + smoke test), `project-folder-model.md` (folder layout these flows assume)

## Why This Doc Exists

`docs/QA.md` covers per-feature pass/fail (does smoothness scoring work?). `docs/MANUAL_QA_GUIDE.md` covers how to launch the app. **Neither answers the user's actual question**: *"Does this app solve my problem — taking several long drone files and producing a clip selection I can hand to DaVinci?"*

This doc defines the end-to-end user flows the **Drone User** runs to answer that. It is the acceptance bar for the folder-model + sidebar + AI-collaboration work to be called "done."

## The Drone User's Problem (Restated)

> I shoot a drone session and come home with 3-8 MP4 files, 5-20 minutes each (total 30 min - 2 hr of raw footage). I want the app to find the smooth, visually interesting moments, let me approve/reorder/trim them, and dump a timeline I can open in DaVinci Resolve without fighting relink dialogs.

Three things must be true for the app to claim success:

1. **Speed**: less than 15 minutes from "drop folder" to "candidate clips visible on Review Board," for 30 min of 4K/60fps footage on the test machine.
2. **Signal**: at least 70% of accepted clips would have been picked by manual review of the same footage. Measured against the user's own ground truth (see Flow D).
3. **Handoff**: opening `<project-folder>/exports/davinci/timeline.xml` in DaVinci Resolve resolves all media without a single relink prompt.

If any of these three fails, the workflow is not solved, regardless of which feature shipped.

## Test Setup (One-Time)

Maintain a small private dataset on disk, outside the repo:

```
~/Footage/QA/
├── small-set/           <- 3 files, ~5 min total. Smoke tests.
├── realistic-set/       <- 5-8 files, 30-60 min total. The "actual" test.
└── stress-set/          <- 10+ files, 2+ hr total. Performance test.
```

For each set, write a one-line `MANIFEST.md`:
- filename, duration, codec, FPS, resolution
- subjective: "mostly smooth", "shaky at start", "overexposed water", etc.

This is the ground truth referenced by Flow D.

## Flow A — Cold Start: First Use With A Folder

**Goal**: a brand-new user can take a folder of drone footage and produce a usable export with zero docs.

1. Launch the app (assumes backend running per `MANUAL_QA_GUIDE.md`).
2. Click **Create Project**.
3. In the file picker, select `~/Footage/QA/realistic-set/`.
4. App should:
   - Detect N video files, name the project after the folder.
   - Start analysis automatically.
   - Show progress (per-file, with ETA).
5. Wait for analysis to finish.
6. Open Review Board. Scan suggested clips top-to-bottom.
7. Accept ~50% of suggestions, reject the rest.
8. Reorder accepted clips by dragging.
9. Export → DaVinci.
10. Open `~/Footage/QA/realistic-set/exports/davinci/<name>.xml` in DaVinci Resolve.

### Pass criteria

- [ ] Folder picker accepts a folder, not just a file.
- [ ] App auto-detects videos non-recursively, no manual "select each file" step.
- [ ] Analysis progress is visible per-file, not a single opaque spinner.
- [ ] Analysis for 30 min of 4K/60fps completes in under 15 min on the test machine.
- [ ] Review Board shows clips ranked by **Overall Score**, highest first.
- [ ] Each clip card shows: thumbnail, source filename, in/out timecodes, **Smoothness Score**, **Clip Reason**.
- [ ] Reorder is drag-and-drop, persists after page change.
- [ ] DaVinci opens the timeline with zero relink prompts.
- [ ] Time from launch to opening in DaVinci, on `realistic-set`, under 20 minutes total.

### Failure modes to actively watch for

- Analysis appears done but Review Board is empty (signal: scoring threshold too high for the source).
- Folder picker requires user to also pick an "output location" (signal: folder-model not landed).
- DaVinci shows "Media offline" on any clip (signal: paths in XML are absolute, not relative).
- Drag reordering loses state (signal: ReviewContext refactor pending — see `react-doctor-triage.md` Batch 4).

## Flow B — Iterate: Refine An Existing Project

**Goal**: re-opening a project and tweaking it should feel like a real editor, not a regen-from-scratch tool.

1. Re-open `realistic-set` from the project sidebar.
2. Change smoothness threshold from 7 → 5. Confirm new candidate clips appear without re-running full analysis.
3. Reject 2 previously accepted clips.
4. Trim one clip's in-point by ~1 second using keyboard shortcuts (I / O if implemented, else mouse).
5. Re-export to DaVinci. Confirm only the timeline file changes; analysis cache is untouched.

### Pass criteria

- [ ] Sidebar shows `realistic-set` as a recent project; one click re-opens it.
- [ ] Threshold change is instant (filter on existing scores, no re-analysis).
- [ ] Trim is precise to at least 1 frame.
- [ ] Re-export overwrites the previous DaVinci XML with a confirmation prompt.
- [ ] `clipassembler/analysis/` mtimes unchanged after re-export.

## Flow C — DaVinci Handoff: The Folder Is Portable

**Goal**: the user can move the entire project folder (e.g. to an external SSD) and DaVinci still works.

1. Copy `~/Footage/QA/realistic-set/` to `/Volumes/External/realistic-set/`.
2. Open `/Volumes/External/realistic-set/exports/davinci/<name>.xml` in DaVinci.
3. Confirm media links resolve against the SSD copy.

### Pass criteria

- [ ] Zero relink prompts.
- [ ] All clip thumbnails render in DaVinci's Media Pool.
- [ ] Timeline plays through cleanly.

If this flow fails, paths in the XML are absolute — folder-model is not implementing relative paths correctly.

## Flow D — AI vs Manual: The Signal Test

**Goal**: measure whether the app's suggestions are actually useful, not just present.

This is the only flow that requires user judgment, and it's the most important one.

### Setup

Before running the app, manually scrub through `realistic-set` and write down — in `~/Footage/QA/realistic-set/MANUAL_GROUND_TRUTH.md` — the timecodes of clips *you* would keep for a 2-minute highlight reel.

### Run

1. Run analysis with the **Manual Harness** only (rule-based scoring). Record accepted suggestions.
2. Run again with **Pi Agent Harness** (or current default AI harness). Record accepted suggestions.
3. Compare both to the ground truth.

### Scoring (per harness)

| Metric | Formula | Target |
|---|---|---|
| Recall | (app picks that overlap ground truth) / (ground truth picks) | ≥ 0.70 |
| Precision | (app picks that overlap ground truth) / (total app picks) | ≥ 0.50 |
| Surprise wins | app picks I'd have missed, that I now want to keep | ≥ 1 per session |
| False positives I'd reject in < 2s | high-ranked clips that are obviously bad | ≤ 10% |

Two clips "overlap" if their time ranges intersect by ≥ 50% of either's duration.

### Pass criteria

- [ ] AI Harness beats Manual Harness on recall by ≥ 10 percentage points, OR contributes ≥ 2 surprise wins per session.
- [ ] If AI Harness underperforms Manual on both axes, the app should default to Manual until the harness improves. Track as a finding, not a blocker.

## Flow E — Stress Test (Optional)

Run Flow A on `stress-set` (2+ hr footage). Same criteria except:

- Analysis budget extends to 60 min.
- App must stay responsive during background analysis (no UI freezes > 1s).
- Memory usage on the renderer process stays under 1.5 GB (check Activity Monitor).

## What This Doc Does Not Cover

- Audio handling (out of MVP scope per PRD).
- Multi-track timeline (out of MVP scope).
- Color grading, transitions, effects (out of MVP scope).
- Windows / Linux behavior (macOS-only for now).
- Per-rule regression tests (already in `docs/QA.md`).

## Reporting

After each flow run, capture:

1. Date, hardware, app version (git SHA).
2. Which flows ran, which passed, which failed.
3. For Flow D, the actual recall / precision numbers.
4. Screen recording (optional but valuable) of any failure.
5. New `docs/QA.md`-style bug entries for each failure.

Store under `~/Footage/QA/runs/<YYYY-MM-DD>/`. Do not commit to repo.

## Open Questions

1. ~~Should we ship a synthetic test fixture so this doc can be partially automated in CI?~~ **Done**: `scripts/synthetic_e2e_qa.py` generates synthetic footage (smooth hover / shaky jitter / mixed) and runs the full pipeline in-process — folder create, manual-harness analysis, smooth-vs-shaky discrimination, timeline edit, EDL/FCPXML/DaVinci exports with relative paths, and close/reopen state restore. Run with `backend/.venv/bin/python scripts/synthetic_e2e_qa.py`. Flows A–C remain manual for the real-Resolve import step; Flow D still needs real footage and human judgment.
2. What's the test machine baseline? Hardware-relative timing targets need a named reference machine.
3. Pi Agent vs Local Qwen: which is "the AI harness" for Flow D, or both?
