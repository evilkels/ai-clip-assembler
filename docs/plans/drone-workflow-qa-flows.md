# Plan: QA Flows For The Drone Clip Extraction Workflow

**Status: partially automated; real-footage, performance, DaVinci, and signal QA remain.**
Owner: Elvijs / Codex. Related: `docs/QA.md` (per-feature pass/fail), `docs/MANUAL_QA_GUIDE.md` (launch/smoke test), [`done/project-folder-model.md`](done/project-folder-model.md) (folder layout these flows assume).

## Why this doc exists

Neither `docs/QA.md` nor `docs/MANUAL_QA_GUIDE.md` answers the real question: does the app take several long drone files and produce a clip selection usable in DaVinci? This doc defines the end-to-end flows that are the acceptance bar for folder-model + sidebar + AI-collaboration work to be called "done."

## The three success criteria

1. **Speed**: <15 min from "drop folder" to candidate clips visible on Review Board, for 30 min of 4K/60fps footage on the test machine.
2. **Signal**: ≥70% of accepted clips would have been picked by manual review of the same footage (measured against the user's own ground truth, Flow D).
3. **Handoff**: opening the exported DaVinci timeline resolves all media with zero relink prompts.

Resolve XML must retain linked source audio for audio-bearing clips while
silent-source clips remain video-only. EDL is a deliberately flattened handoff:
it uses `B` for mono, `AA/V` for stereo (including the first two channels of a
wider source), `V` for silent/legacy metadata, and warns only when channels
beyond 1–2 are dropped.

If any of these three fails, the workflow is not solved regardless of which feature shipped.

## Flows (A–E)

- **A — Cold start**: folder → auto-detected videos → analysis with per-file progress → Review Board ranked by Overall Score → accept/reject/reorder → export → open in DaVinci. Watch for: Review Board empty despite "done" analysis (scoring threshold too high), folder picker demanding a separate output location (folder-model regression), "Media offline" in DaVinci (absolute vs. relative paths bug), drag-reorder losing state.
- **B — Iterate**: reopen project, change smoothness threshold (must filter instantly, no full re-analysis), reject/trim clips, re-export without touching `clipassembler/analysis/` mtimes.
- **C — Portability**: copy the whole project folder to another volume; DaVinci must still resolve media with zero relink prompts. Failure here means export paths are absolute, not relative.
- **D — Signal test (the important one)**: manually pick ground-truth timecodes first, then compare Manual-harness vs. AI-harness (e.g. Pi Agent) suggestions against that ground truth. Recall ≥0.70, precision ≥0.50, ≥1 "surprise win" per session, ≤10% obvious-reject false positives (2-clip overlap rule: time ranges intersect ≥50% of either duration). Decision rule: if AI harness doesn't beat Manual by ≥10pp recall or ≥2 surprise wins, **default to Manual until the harness improves** — tracked as a finding, not a blocker.
- **E — Stress (optional)**: same as Flow A on 2+hr footage; analysis budget extends to 60 min, UI must stay responsive (no freezes >1s), renderer memory <1.5GB.

## Explicitly out of scope

Multi-track timeline, color grading/transitions/effects, Windows/Linux support
(macOS-only for now), per-rule regression tests (already in `docs/QA.md`).

## Automation status

**Implemented**: `scripts/synthetic_e2e_qa.py` generates synthetic smooth/shaky/mixed footage and drives the real backend pipeline — verifies folder discovery, manual-harness analysis, smooth-vs-shaky discrimination, timeline edits, all three exports with relative paths, and close/reopen restore. Playwright covers upload, analysis completion, Review/Timeline video preview, inclusion.

**Still manual** (not automatable): real-footage timing targets, renderer responsiveness under real load, actual DaVinci/FCP import with zero relink prompts and linked-audio verification, project move/Locate through the packaged app, and the Flow D AI-vs-Manual human judgment call.

## Open questions

Test-machine hardware baseline for timing targets — unnamed/unresolved. Whether Pi Agent or Local Qwen (or both) counts as "the AI harness" for Flow D — unresolved.
