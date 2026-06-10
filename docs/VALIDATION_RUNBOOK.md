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

## Findings

-
````

## Stop Conditions

Stop and record a blocker if source media is incomplete, Pi is unauthenticated,
the app crashes, timing telemetry is absent, or DaVinci cannot import the XML.
Do not change thresholds during the measured run.
