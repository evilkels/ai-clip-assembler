# Plan 002: Design spike — make pi harness scoring survive a realistic session (batching, retries, partial results)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a39ed1..HEAD -- backend/src/pi_cli_harness.py backend/src/api.py backend/tests/test_pi_cli_harness.py`
> If any in-scope-for-reading file changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (spike itself S–M; later implementation is a separate plan)
- **Risk**: LOW (spike produces a document + scratch benchmarks, no production code)
- **Depends on**: none (pairs well with plan 001 — its Flow D session will consume this spike's recommendation)
- **Category**: direction
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

The default AI harness (`pi_agent`) scores candidate clips **one subprocess call at a time**, with a 180 s per-clip timeout, and is **all-or-nothing**: the first clip that fails or returns unusable JSON aborts AI scoring for the entire run and discards every score already obtained in that run (cache aside). On the project's own "realistic set" target (5–8 files, 30–60 min of footage — see `docs/plans/drone-workflow-qa-flows.md`), that design means potentially dozens of sequential model round-trips, an hour-scale wall clock, and a high probability that one provider flake throws away all completed AI work. This spike produces measured numbers for the current design and a written, evidence-backed recommendation among: per-clip retry, batched multi-clip scoring, bounded concurrency, and partial-result acceptance — **without changing production code**.

## Current state

Relevant files (read, do not modify):

- `backend/src/pi_cli_harness.py` — the whole harness. Key facts:
  - `_call_pi_cli` (line 143) spawns one `pi` CLI subprocess per clip with `--provider openai-codex --model gpt-5.4-mini`, attaching up to 4 frame JPEGs (`DEFAULT_MAX_FRAMES_PER_CLIP = 4`, line 48) and a prompt demanding a single JSON object.
  - `enhance_clips_with_pi_cli` (line 301) loops clips sequentially; per-clip durations are recorded into `metadata["scoring_seconds_per_clip"]` (line 443-444).
  - All-or-nothing abort on first failure (lines 377–400). The stated rationale (docstring lines 10–13 and 320–324): *"blended (0.7 technical + 0.3 visual interest) scores and unblended technical scores are not on the same scale, so the first failed clip aborts AI scoring for the whole run."* Any partial-result design must answer this comparability argument.
  - A score cache keyed by sha256(frames + provider + model + prompt) (lines 245–258) makes re-runs of unchanged footage free — failures are costly only on *first* analysis.
  - `PI_TIMEOUT_SEC` default 180 s per clip (line 47).
- `backend/src/api.py` — `run_analysis_pipeline` (line 327) calls `enhance_clips_with_pi_cli` once **per video** (line 421), with a progress callback and `cache_dir=analysis_dir(project_id)/"ai-scores"`. So a multi-video project multiplies the exposure: each video's clip set is its own all-or-nothing batch.
- `backend/tests/test_pi_cli_harness.py` — existing unit tests; they stub `subprocess.run`. Use as the pattern for any scratch test you write.
- `scripts/synthetic_e2e_qa.py` — generates synthetic smooth/shaky/mixed footage and runs the real pipeline with the **manual** harness; useful as a frame-sample generator for benchmarks.

Excerpt — the abort path (`backend/src/pi_cli_harness.py:377-388`):

```python
        except PiCliUnavailableError as exc:
            elapsed = time.monotonic() - started
            logger.warning(
                "pi harness: clip %d/%d failed after %.1fs, aborting AI scoring "
                "(all-or-nothing): %s",
                clip_index, len(clip_samples), elapsed, exc,
            )
            return _fallback_result(
                manual_result,
                f"pi harness fallback: clip {clip_index}/{len(clip_samples)} "
                f"failed after {elapsed:.1f}s ({exc}); manual ranking kept",
            )
```

Excerpt — the blend that creates the comparability constraint (`backend/src/pi_cli_harness.py:414-417`):

```python
        new_visual_interest = round(_clamp_score(score.get("visual_interest", 0)), 2)
        new_overall = round(
            0.7 * original_clip.overall_score + 0.3 * new_visual_interest, 2
        )
```

Environment facts: the `pi` CLI must be authenticated (`pi /login`) and on
PATH; configuration via `PI_PROVIDER`/`PI_MODEL`/`PI_BIN`/`PI_TIMEOUT_SEC`
env vars, loaded from repo-root `.env` by the backend (`backend/src/api.py:22`).
If `pi` is not authenticated in your environment, the live-benchmark steps
below will fail — that is a STOP condition, not something to work around.

## Commands you will need

| Purpose | Command (from repo root) | Expected on success |
|---|---|---|
| Backend tests | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` | all pass |
| Harness tests only | `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_pi_cli_harness.py -q` | all pass |
| pi CLI sanity | `pi --provider openai-codex --model gpt-5.4-mini --print --mode text --no-session --no-context-files --no-skills --no-extensions "reply with the word ok"` | prints `ok`-ish text, exit 0 |
| Synthetic footage | `backend/.venv/bin/python scripts/synthetic_e2e_qa.py` | exit 0; generates footage + samples under a temp project |

## Scope

**In scope** (the only files you should create or modify):
- `docs/specs/<YYYY-MM-DD>-pi-harness-scaling-design.md` (create — the spike deliverable; use the actual date)
- `scripts/spike_pi_scaling_benchmark.py` (create — throwaway benchmark driver, clearly headed "SPIKE — not production code")
- `docs/plans/README.md` (status row update)

**Out of scope** (do NOT touch):
- `backend/src/pi_cli_harness.py`, `backend/src/api.py` — **no production changes in this spike**; the recommendation becomes a follow-up implementation plan.
- `backend/src/local_qwen_harness.py` — postponed harness, explicitly disabled; not part of this question.
- `harness/` configs and `docs/HARNESS_SPEC.md` — contract changes only if the follow-up implementation plan demands them.

## Git workflow

- Branch: `feature/pi-scaling-spike`
- Conventional commits (`docs:`, `chore:`); benchmark script committed with the spec.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Establish the cost model of the current design (no model calls)

From the code, derive and write down (these go in the spec's "Baseline" section):

- Calls per session = total candidate clips across all videos (1 subprocess + 1 model round-trip each, 4 frame images per call).
- Worst-case wall clock = clips × `PI_TIMEOUT_SEC` (default 180 s).
- Failure exposure: P(all clips in a video survive) = p^N for per-clip success rate p; with the per-video batching in `run_analysis_pipeline`, one flake discards that video's scores only — confirm this by reading `api.py:421-441` and state it precisely (the all-or-nothing blast radius is per *video*, not per *project*).

**Verify**: the spec draft contains a "Baseline cost model" section with these three formulas instantiated for the realistic set (assume 5–8 videos, 3–10 clips each → 15–80 calls).

### Step 2: Measure real per-call latency

Write `scripts/spike_pi_scaling_benchmark.py` that:

1. Generates or reuses frame JPEGs (either run `scripts/synthetic_e2e_qa.py` and harvest its `clipassembler/samples/` output, or generate 4 synthetic 960px JPEGs with Pillow — already a backend dependency).
2. Calls `backend.src.pi_cli_harness._call_pi_cli` directly N=5 times with 4 frames each; records per-call latency, success/parse-failure counts.
3. Calls it once with a **batched prompt variant**: 2 clips × 4 frames in one invocation, prompt asking for a JSON **array** of two `{"clip": i, "smoothness": N, "visual_interest": N, "reason": "..."}` objects (build the prompt in the script; do not modify the harness — pass it via the `prompt_template` parameter and parse the output in the script).
4. Prints a summary table: per-clip mean/p95 latency, batched per-clip effective latency, parse failure rate per variant.

Run it. Copy the output table into the spec.

**Verify**: `backend/.venv/bin/python scripts/spike_pi_scaling_benchmark.py` → exits 0 and prints the summary table (model calls succeed). If `pi` is unauthenticated or the provider errors on every call, STOP.

### Step 3: Analyze the design options against the comparability constraint

In the spec, evaluate each option in its own subsection, explicitly answering
the docstring's argument that blended and unblended scores can't be ranked
together:

1. **Retry-once per clip** (cheapest): one retry on `PiCliUnavailableError`/parse failure before aborting. Estimate the survival-rate improvement using the measured failure rate from step 2.
2. **Batched scoring** (k clips per call): fewer round-trips, lower cost; risks — response truncation, clip/score misalignment, harder parse. Use the measured batched latency. Recommend a k.
3. **Bounded concurrency** (2–4 parallel subprocesses): wall-clock win without prompt changes; risks — provider rate limits, interleaved logs, progress-callback ordering.
4. **Partial results**: accept per-clip failures by giving failed clips a *neutral* visual-interest score so every clip stays on the blended scale (e.g. `overall = 0.7*technical + 0.3*neutral_visual` with neutral = the mean visual score of successfully scored clips, or 5.0). This dissolves the comparability objection — state the chosen neutral-score rule and its bias trade-off explicitly. Note the existing per-(frames,model,prompt) cache means retried runs only re-score the failed clips.
5. **Do nothing**: defensible if measured failure rate is ~0 and latency × realistic clip count fits the 15-minute budget from `docs/plans/drone-workflow-qa-flows.md`. Say so if the numbers support it.

**Verify**: spec contains all five subsections, each citing a measured number from step 2 or a formula from step 1.

### Step 4: Write the recommendation and the follow-up plan sketch

End the spec with:

- A single recommended combination (e.g. "retry-once + partial results with neutral-mean backfill; batching deferred"), justified by the numbers.
- An implementation sketch: which functions in `backend/src/pi_cli_harness.py` change, which tests in `backend/tests/test_pi_cli_harness.py` to add, expected size (S/M).
- Open questions for the maintainer (e.g. provider rate limits, whether `scoring_seconds_per_clip` telemetry should feed plan 001's timing report).

**Verify**: `grep -c '^## ' docs/specs/*pi-harness-scaling-design.md` → ≥ 4 (Baseline, Measurements, Options, Recommendation).

## Test plan

This is a spike: no production tests. The benchmark script must be runnable
end-to-end (`backend/.venv/bin/python scripts/spike_pi_scaling_benchmark.py`
exits 0) and the existing suite must stay green
(`cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py`)
— it will, since no production file changes.

## Done criteria

ALL must hold:

- [ ] `docs/specs/<date>-pi-harness-scaling-design.md` exists with Baseline / Measurements / Options (all five) / Recommendation sections
- [ ] Measurements section contains a real output table from `scripts/spike_pi_scaling_benchmark.py` (not hypothetical numbers)
- [ ] `git diff --name-only` shows changes ONLY to the in-scope files
- [ ] `cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py` exits 0
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pi` CLI is missing, unauthenticated, or every benchmark call fails — report the exact error; do not substitute a different provider or fake the numbers.
- `enhance_clips_with_pi_cli` or `_call_pi_cli` no longer match the excerpts above (someone already changed the harness — the spike's premise may be stale).
- Benchmark calls cost-explode (e.g. provider starts rejecting with quota errors) — stop after the failures, record what you got.
- You find yourself editing `backend/src/pi_cli_harness.py` — that is the follow-up plan, not this one.

## Maintenance notes

- The spec's recommendation should be turned into a numbered implementation plan (`docs/plans/00X-...`) before anyone touches the harness.
- Plan 001's Flow D session is the natural consumer: if the validation run shows AI scoring aborting or blowing the time budget, this spec says what to do; if validation shows ~0 failures and acceptable latency, the "do nothing" option wins and this spike still paid for itself.
- Anything that changes `DEFAULT_PROMPT_TEMPLATE`, provider, or model invalidates the score cache by design (the key includes all three) — batching therefore cold-starts the cache; note this in the spec.
- Delete `scripts/spike_pi_scaling_benchmark.py` when the follow-up implementation lands (it pins a prompt format that will drift).
