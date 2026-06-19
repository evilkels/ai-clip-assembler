# Pi Harness Scaling — Design Spike

Date: 2026-06-19
Status: Spike complete (design + measured benchmarks). No production code changed.
Plan: [`docs/plans/002-pi-harness-scaling-spike.md`](../plans/002-pi-harness-scaling-spike.md)
Benchmark: [`scripts/spike_pi_scaling_benchmark.py`](../../scripts/spike_pi_scaling_benchmark.py)

## Question

The default AI harness (`pi_agent`) scores candidate clips **one `pi` subprocess
call at a time**, 180 s timeout each, and is **all-or-nothing within a video**:
the first clip that fails or returns unusable JSON aborts AI scoring for that
video and discards the scores already obtained. Will that survive a realistic
session (5–8 videos, 30–60 min, 15–80 clips), and if not, what is the
evidence-backed fix? This spike measures the current design and recommends a
change to be implemented under a **separate** plan.

## Baseline cost model

Derived from `backend/src/pi_cli_harness.py` and `backend/src/api.py`
(`run_analysis_pipeline` calls `enhance_clips_with_pi_cli` once **per video**,
`api.py:460`→`api.py:579`):

- **Calls per session** = total candidate clips across all videos. One `pi`
  subprocess + one model round-trip per clip, ≤4 frame JPEGs per call
  (`DEFAULT_MAX_FRAMES_PER_CLIP = 4`). Realistic set (5–8 videos × 3–10 clips):
  **≈ 15–80 calls**, run strictly sequentially.
- **Worst-case wall clock** = `clips × PI_TIMEOUT_SEC` (180 s). For 15–80 clips
  that is **45–240 min** if every call hits the timeout — pathological, but it
  is the current ceiling because there is no concurrency.
- **Failure exposure** = per-video, not per-project. For per-clip success rate
  `p` and a video with `N` clips, P(that video keeps its AI scores) = `p^N`; one
  flake discards **that one video's** scores (manual ranking is kept for it),
  not the whole project. The per-(frames+provider+model+prompt) sha256 score
  cache means a re-run only re-pays for clips not already cached, so failures
  are costly only on first analysis.

## Measurements

Live `pi` calls via `scripts/spike_pi_scaling_benchmark.py`
(`provider=openai-codex model=gpt-5.4-mini`, 4 synthetic 960px frames/clip).
Representative run (a second run was consistent; **0 parse failures across all
15 live calls** over both runs):

```
variant              mean/clip    p95/clip  parse-fail
per-clip                  8.9s       15.9s         0/5
batched (k=2)             5.2s        8.3s         0/2
```

Reading the numbers:

- **Per-clip latency ≈ 7–13 s mean, p95 ~16 s.** Sequential wall clock for the
  realistic set ≈ `clips × 9 s`: **~2.3 min (15 clips) to ~12 min (80 clips)**
  at the mean; at p95 (~16 s) the 80-clip upper end is **~21 min — over the
  15-minute Flow A budget** (`docs/plans/drone-workflow-qa-flows.md`).
- **Batching k=2 cuts effective per-clip latency ~40%** (5.2 s vs 8.9 s) and
  halves round-trips, with clean parsing in this sample.
- **Parse-failure rate: 0/15.** Encouraging, but with 0 failures in 15 calls the
  rule-of-three 95% upper bound on the true failure rate is still ≈ **20%** — so
  this sample **cannot** prove the all-or-nothing design is safe at 15–80 calls.

## Options

### 1. Retry-once per clip
One retry on `PiCliUnavailableError`/parse failure before counting the clip as
failed. Cost: at most **+1 call (~9 s) per failing clip**, zero when healthy
(0/15 here). Survival per clip improves `p → 1-(1-p)²` (e.g. p=0.95 → 0.9975).
Cheapest insurance; does not by itself fix the all-or-nothing abort.

### 2. Batched scoring (k clips/call)
Measured **5.2 s/clip at k=2** vs 8.9 s, and ~half the round-trips → less
provider exposure. Risks: response truncation, clip/score misalignment, harder
parsing, and **cache cold-start** — the score-cache key includes the prompt, so
changing to a batched prompt re-scores everything once. Recommend small k (2–3)
if adopted; k=2 parsed cleanly here.

### 3. Bounded concurrency (2–4 parallel subprocesses)
Wall-clock ÷ concurrency with **no prompt change** (cache stays warm): 80 clips
× 9 s ÷ 3 ≈ **4 min** vs ~12 min sequential. Risks: provider rate limits,
interleaved logs, and progress-callback ordering (the per-video callback assumes
sequential indices). Biggest wall-clock win for the least correctness risk.

### 4. Partial results (neutral backfill)
Replace the all-or-nothing abort: give a failed clip a **neutral** visual-interest
score so every clip stays on the blended scale
`overall = 0.7·technical + 0.3·visual`. Chosen rule: **neutral = the mean
visual_interest of successfully scored clips in that video** (fall back to 5.0
if none succeeded). This keeps blended and unblended clips comparable —
dissolving the docstring's comparability objection — at the cost of a small bias
toward the cohort mean for failed clips. With the existing cache, a re-run only
re-scores the previously failed clips.

### 5. Do nothing
Defensible **only** if measured failure rate is ~0 and latency × realistic clip
count fits the 15-min budget. The mean (9 s/clip) fits for ≤~80 clips, **but**
the p95 (16 s/clip) pushes the 80-clip upper end to ~21 min, and the failure-rate
CI is too wide (0/15 ⇒ up to ~20%) to bet a whole video's scores on. Do-nothing
is **not** recommended for the realistic set's upper bound.

## Recommendation

**Bounded concurrency (2–3) + retry-once + partial-results (neutral-mean
backfill); defer batching.**

- *Concurrency 2–3* gives the wall-clock win (12 → ~4–6 min at 80 clips) with no
  prompt change, so the cache stays warm — directly addresses the Flow A budget
  risk the p95 exposed.
- *Retry-once* + *partial results* together remove the all-or-nothing cliff: a
  transient flake costs one retry and, if it still fails, one neutral-scored clip
  instead of a whole video reverting to manual ranking.
- *Batching deferred*: it cold-starts the cache and adds alignment/truncation
  risk, and concurrency already buys the latency win without prompt churn.
  Revisit only if provider per-call latency, not count, becomes the bottleneck.

### Implementation sketch (separate plan, size M)

- `backend/src/pi_cli_harness.py` — in `enhance_clips_with_pi_cli`: replace the
  sequential loop with a bounded pool (e.g. `concurrent.futures.ThreadPoolExecutor`,
  max_workers from a new `PI_CONCURRENCY` env, default 3); wrap each `_call_pi_cli`
  in a retry-once; replace the abort path (`pi_cli_harness.py:377-400`) with
  neutral backfill; keep `metadata["used_ai"]` truthful and add
  `metadata["ai_failed_clips"]`. Ensure progress-callback ordering is stable
  under concurrency (emit by completed count, not loop index).
- `backend/tests/test_pi_cli_harness.py` — add: retry-then-succeed path; final
  failure → neutral backfill keeps the clip on the blended scale; concurrency
  preserves per-clip score↔clip mapping; partial-failure metadata shape.

### Open questions for the maintainer

- Provider rate limits at concurrency 3–4 (openai-codex) — needs a real-session
  check; start at 3 and back off on 429s.
- Should `scoring_seconds_per_clip` telemetry feed plan 001's timing report so
  Flow A speed is measured end-to-end?
- Neutral score: mean-of-successful (chosen) vs fixed 5.0 — confirm the bias
  trade-off is acceptable, or surface failed clips in the UI instead.
- Batching k and prompt format if we ever revisit — note it invalidates the
  score cache by design.

## Notes

- Changing `DEFAULT_PROMPT_TEMPLATE`, provider, or model invalidates the score
  cache (the key includes all three); batching therefore cold-starts the cache.
- Plan 001's Flow D session is the natural consumer: if validation shows AI
  scoring aborting or blowing the budget, adopt the recommendation; if it shows
  ~0 failures and acceptable latency on the actual realistic set, the
  do-nothing/observe path is still informed by these numbers.
- `scripts/spike_pi_scaling_benchmark.py` pins a prompt format that will drift —
  delete it when the follow-up implementation lands.
