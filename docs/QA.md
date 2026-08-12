# QA Plan

Drone-first acceptance for local import, Manual/Pi scoring, Candidate Clip
review, backend-authoritative Timeline editing/agents, and FCPXML/EDL/Resolve
XML handoff. Prefer real footage; never commit private media.

## Assets

| Asset | Expected signal |
|---|---|
| Smooth pan / shaky move (10–30s each) | smooth ranks high; shaky below 7 |
| Blur / bad exposure | lower sharpness / exposure |
| Mixed source (1–3m) | multiple ranked Candidate Clips |
| H.264 MP4 + H.265 MOV | probe and extraction succeed |
| Long source (5–10m; 1h 4K if available) | practical timing evidence |

Record names, durations, codec, and expected behavior outside git.

## Acceptance checks

### Project/import and scoring

1. Start app; create a project; import H.264 MP4 and H.265 MOV.
2. Confirm duration/FPS/resolution/codec within probe tolerance; no remote upload
   under Manual; missing ffmpeg/ffprobe errors are actionable.
3. Analyze smooth, shaky, blurry, and exposure-problem footage. Confirm stable
   0–10 Review Board scores: smooth > shaky, sharp > blurry, good exposure > bad.

### Candidate Clips and Review

1. Analyze mixed footage at default smoothness 7. Candidate Clips are normally
   3–15s (unless preferences change), shaky spans excluded/low, and Clip Reason
   explains technical quality; total duration approaches target when possible.
2. Change filter; accept/reject/reorder. States are distinct, export order
   follows the Review Board's Candidate Clip decisions, and rule-based scores
   avoid AI-only language.

### Export and Pi

The Export page must read the current backend Timeline Document without a
legacy Timeline write. Its result card shows the generated path, item count,
effective duration, backend status and duration metadata, and every backend
warning. **Review export payload** must retain repeated Timeline Items with
`item_id`, resolved file metadata, bounds, Speed, and Transform. EDL must make
its Speed/Transform flattening warning visible; FCPXML and Resolve XML must
retain their supported values. The synthetic browser regression covers these
read-only UI and response-surface checks; it does not replace manual NLE import
validation.

1. Accept 3+ clips from 2 sources. Import FCPXML into FCP; inspect/import EDL.
   Original media references, order, edit timecodes, and source timecodes match.
   FCPXML/Resolve preserve speed/transform; EDL flattens and warns.
2. Analyze with authenticated Pi: visual-interest and written Clip Reason appear.
   Break it with `PI_BIN=/bin/false`: per-video Manual fallback warns, with no
   crash or project loss.

### Timeline and agents

1. Reorder/extend/speed/transform/split/remove; undo/redo; reopen and export.
   Every backend Timeline Item remains visible, including repeated Candidate
   Clips. Effective duration is source span divided by Speed; visual and
   detailed edits use `item_id` through the Operations core and are undoable.
   Transform values are editable; full pan/crop preview remains pending visual
   QA.
2. Apply one `/mcp` operation; it appears live in GUI over SSE. Accept one in-app
   Proposal and reject another: Accept mutates through core, Reject does nothing.
   Run measured Flow F from `VALIDATION_RUNBOOK.md`.

### Resolve XML and EDL

1. Export folder-project Resolve XML; import via File → Import → Timeline.
   Confirm no dialog/relink, matching count/order/in-out, and relative media.
2. Move the whole folder and repeat: still zero relink.
3. Run `scripts/backend_smoke_test.py` on real footage, add original media to
   Resolve, import EDL, and confirm count, positions/durations, online/relink
   behavior, frame-rate timing, and vertical orientation. Track #19.

## Closeout evidence

Capture smooth, shaky, mixed, long, H.264, and HEVC cases; EDL in Resolve;
FCPXML (with FCP if available). For each: filename, duration, codec, FPS,
resolution, command/result, count, total Timeline duration, editorial match,
NLE result, relink/orientation, long-source processing time, and linked issues.

## Regression commands

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
cd ../frontend
npm install
npm run typecheck
npm run build
cd ..
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

Also smoke a real drone MP4: Manual analysis produces a Candidate Clip and the
Review Board renders it.

The Plan 020 browser regression uses deterministic synthetic fixtures. It does
not replace the real-footage, Final Cut Pro, or DaVinci Resolve checks below.
The Plan 021 browser regression also uses synthetic fixtures and does not prove
real-footage behavior or NLE import compatibility.

## Risks

Real gimbals/light/codecs vary; synthetic tests do not prove editorial value;
Manual cannot distinguish smooth-boring from smooth-strong; Pi needs authenticated
CLI and may approach time budgets; actual FCP is required to validate FCPXML.

## Bug template

```md
## What happened
[Actual user-visible behavior]
## What I expected
[Expected behavior using domain terms]
## Steps to reproduce
1. [Source type, duration, codec]
2. [Import/analyze/review/export action]
3. [Observed result]
## Additional context
[Scores, threshold, export, footage character, harness]
```
