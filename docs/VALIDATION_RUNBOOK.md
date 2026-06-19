# Real-Footage Validation Runbook

## Purpose

Measure the core workflow against three acceptance criteria: folder to Review
Board in under 15 minutes for 30 minutes of 4K/60fps footage, recall of at
least 0.70 against manual ground truth, and zero DaVinci Resolve relink
prompts.

## Prerequisites

Prepare:

```text
~/Footage/QA/
├── small-set/
│   └── MANIFEST.md
├── realistic-set/
│   └── MANIFEST.md
└── stress-set/
    └── MANIFEST.md
```

Each manifest records source durations, resolution, FPS, expected notable
moments, and known bad motion. Launch the app using
[`MANUAL_QA_GUIDE.md`](MANUAL_QA_GUIDE.md), install DaVinci Resolve, and record
the test machine name and hardware in the report.

## Capture Timings

After analysis, inspect the per-phase timing report:

```bash
curl -s http://127.0.0.1:8000/projects/<id>/analyze/status | python3 -m json.tool
```

Use the returned `timings.pipeline_total_sec` for the speed criterion instead
of a stopwatch. Record the per-video motion analysis, frame extraction, scene
detection, assembly, and AI scoring durations.

## Procedure

1. **Flow A, cold start:** launch the app, open `realistic-set`, analyze with
   `pi_agent`, review candidates, create the Timeline, export Resolve XML, and
   confirm the total analysis time.
2. **Flow C, portability:** copy the complete project folder to another volume,
   open the copied project, import its Resolve XML, and record every relink
   prompt.
3. **Flow D, signal:** manually review `realistic-set` first and write desired
   ranges to `MANUAL_GROUND_TRUTH.md`. Analyze once with `manual` and once with
   `pi_agent`. Compare both outputs to ground truth.
4. Count clips as overlapping when their time ranges intersect by at least 50%
   of either clip's duration.
5. Calculate recall as overlapping app picks divided by ground-truth picks.
   Calculate precision as overlapping app picks divided by total app picks.
6. **Flow F, agent-operable timeline:** with `realistic-set` open and analyzed
   (the GUI on the Review route), exercise the agent-operable timeline. This
   flow validates that the GUI, an external agent over MCP, and the in-app
   review agent all drive the one backend-authoritative Timeline Document. See
   [`MCP_SERVER.md`](MCP_SERVER.md) for the MCP endpoint and tool list.
   1. **External agent + live GUI.** Connect Claude Code to the running backend:
      `claude mcp add --transport http clip-assembler http://127.0.0.1:8000/mcp`.
      Ask it to `list_candidates` for the open `project_id`, read frames with
      `get_frame_paths`, then apply one operation (e.g. `include` a strong clip,
      or `set_speed` an item to `0.5`). **Confirm the edit appears in the GUI
      without a manual refresh** (SSE live-sync).
   2. **Editor ceiling, survives reload.** From the GUI/agent, apply each of:
      **split**, **extend** (set bounds past the original candidate, clamped to
      the source), **speed**, and **transform** (digital zoom/pan). Save, close,
      and reopen the project; confirm every edit is restored from the saved
      Timeline Document.
   3. **In-app review agent.** On the Review route, let the review agent post its
      opening message and proposals; accept one **Proposal** and confirm the
      timeline updates correctly and the change is undoable; reject one and
      confirm the timeline is unchanged.
   4. **Export speed/transform.** Export the speed/transform timeline to Resolve
      XML, import it into DaVinci, and confirm **zero relink prompts** (reuse the
      Flow C handoff criterion) and that the retime + reframe survive. Export EDL
      and confirm the **flatten warning** is surfaced (speed/transform dropped).

## Report Template

Store the completed report at
`~/Footage/QA/runs/<YYYY-MM-DD>/REPORT.md`. Never commit footage reports.

````markdown
# Real-Footage Validation Report

- Date:
- Git SHA:
- Machine:
- Dataset:

## Criteria

- Speed, <15 min for 30 min 4K/60fps: PASS / FAIL
- Signal, recall >=0.70: PASS / FAIL
- DaVinci handoff, zero relink prompts: PASS / FAIL

## Timings

```json
{}
```

## Signal

| Harness | Recall | Precision | Surprise wins | False positives |
|---------|--------|-----------|---------------|-----------------|
| manual | | | | |
| pi_agent | | | | |

## Agent-Operable Timeline (Flow F)

- External agent (Claude Code over `/mcp`) edit appeared live in the GUI: PASS / FAIL
- Claude Code version / date:
- split / extend / speed / transform applied and survived save+reload: PASS / FAIL
- In-app review agent proposal → accept produced a correct, undoable edit: PASS / FAIL
- In-app review agent reject left the timeline unchanged: PASS / FAIL
- Resolve XML of a speed/transform timeline imported with zero relink prompts: PASS / FAIL
- EDL flatten-warning surfaced for speed/transform: PASS / FAIL
- Notes:

## Findings

-
````

## Stop Conditions

Stop and record a blocker if source media is incomplete, Pi is unauthenticated,
the app crashes, timing telemetry is absent, or DaVinci cannot import the XML.
Do not change thresholds during the measured run.
