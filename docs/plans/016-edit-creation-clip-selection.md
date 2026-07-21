# Plan 016: Fix edit creation — no duplicate clips, no unusable slivers, agent-influenced selection

## Status

STEPS 1–2 DONE; STEP 3 SUPERSEDED by plan 018; STEP 4 TODO. Priority P1
(breaks the core "create an edit" flow). Depends on plans 005, 012,
agent-operable-timeline (MCP + ops core). Planned at commit `6fc6c6d`,
2026-07-20.

## Symptom (reported) / root causes

7-8 videos → 24 source clips → "create an edit" produced short, unusable
edits: slivers (final ~1s clips) and duplicate/overlapping windows of the
same footage. Root cause: `clip_assembly.py`'s `candidate_windows` emitted
every (start,end) window per smooth run, heavily overlapping;
`_bounded_scene_pool` capped count per scene but did not de-overlap.
`assembly_profiles.py`'s `build_draft_timeline` selects by score into a
duration budget with `target - total` as the last clip's size (only guarded
by `> 0`) — `short_social`'s `max_clips_per_scene = 99` let one scene's
overlaps dominate. Reproduced concretely: target=50 with six 30s clips gave a
dur=1.0 tail; `short_social` selected 12 overlapping clips from one run.

## Decisions / status by step
- **Step 1 (DONE)** — de-overlap + sliver floor at draft time
  (`build_draft_timeline`): tracks claimed spans per `file_id`, skips
  candidates overlapping an already-selected range from the same file, stops
  selecting once remaining budget < shortest intended clip length (first clip
  exempt). Chosen as pure/deterministic, fixing the visible edit without
  touching clip identity/Review/persistence.
- **Step 2 (DONE via plan 018)** — de-overlap at candidate generation. Plan
  018 Phase A replaced the originally-proposed tolerance/NMS approach with a
  simpler deterministic invariant: keep the single best window per smooth run
  (`edd4f16`, stable uuid5 identities, 364 tests + ruff green).
- **Step 3 (SUPERSEDED by plan 018)** — one-best-window has no overlap
  tolerance left to expose; plan 018 Phase E moved generation controls to
  Import instead (`2f48e2f`, `b0c46dc`). Don't re-add unless a new use case
  reopens this.
- **Step 4 (TODO)** — let the in-app review agent influence *selection*, not
  just trims: candidate pool + overlap/scene metadata, an op to swap a
  selected clip for a better non-overlapping candidate, prompt guidance
  mirroring the deterministic invariants.

## Accepted tradeoffs / constraints

Step 1 can under-fill the duration budget (49s vs 50s) — better than a 1s
stub. Overlap = "any intersection on the same file"; deliberate overlap
should become a knob, not remove the guard. Further de-overlap work must use
cached frame scores only (never re-run ffmpeg) and must not change `clip_id`s
(uuid5 of file+range) where the top window is unchanged — would break
decision/version provenance (plan 009).
