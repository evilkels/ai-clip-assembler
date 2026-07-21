# Plan 002: Design spike — make pi harness scoring survive a realistic session

## Status

DONE (2026-06-19). Priority P2, depends on none (pairs with plan 001).
Planned at commit `6a39ed1`, 2026-06-10.

## Why this matters

The default AI harness (`pi_agent`) scored candidate clips one subprocess
call at a time (180s per-clip timeout), all-or-nothing: the first clip that
failed or returned unusable JSON aborted scoring for that batch and
discarded scores already obtained. On the "realistic set" target (5-8 files,
30-60 min footage) that meant dozens of round-trips, hour-scale wall clock,
and a real chance one flake throws away completed work. **Spike only** —
measure the current design and recommend among retry, batching, bounded
concurrency, and partial-result acceptance, without touching production code.

## Key facts established

All-or-nothing abort existed because blended (0.7 technical + 0.3 visual) and
unblended scores aren't on the same scale — any partial-result design had to
answer this comparability argument. Failure blast radius is **per video**,
not per project (each video's clip set is its own batch in
`run_analysis_pipeline`). A score cache keyed by
sha256(frames+provider+model+prompt) makes reruns of unchanged footage free,
but changing prompt/provider/model invalidates it, so batching would
cold-start the cache.

## Decision options evaluated (in the spike doc)

Retry-once per clip (cheapest); batched scoring (fewer round-trips, risk of
truncation/misalignment); bounded concurrency (wall-clock win, risk of rate
limits); partial results (neutral visual-interest score for failed clips,
e.g. mean of successes, keeps every clip on the blended scale, dissolving
the comparability objection); do nothing (defensible only if measured
failure rate ~0 and latency fits budget).

## Outcome

Spike deliverables (`docs/specs/*pi-harness-scaling-design.md`,
`scripts/spike_pi_scaling_benchmark.py`) were produced; no production code
touched. Recommended combination and follow-up plan live in the spec doc.

## Gotchas / carried-forward notes

The spike script pins a prompt format that will drift once the follow-up
implementation lands (delete it then). Plan 001's Flow D validation session
is the natural consumer of the recommendation if it shows aborts or budget
overruns.
