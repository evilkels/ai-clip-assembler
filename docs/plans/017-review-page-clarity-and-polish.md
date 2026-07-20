# Plan 017: Review-page clarity & polish

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. On a STOP condition, stop and
> report. When done, update this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 6fc6c6d..HEAD -- frontend/src/renderer/src/routes/Review.tsx frontend/src/renderer/src/components/ClipGenerationPanel.tsx frontend/src/renderer/src/components/SourceClipsPanel.tsx frontend/src/renderer/src/components/ClipCard.tsx backend/src/api.py`
> Re-read cited ranges against live code if any changed.

## Status

- **Status**: STEP 1 DONE (shipped this session), STEPS 2–6 TODO
- **Priority**: P1 (Review is the core workflow; users could not find their clips)
- **Effort**: M (Steps 2–4), L if Step 6 design-system upgrade is taken
- **Risk**: LOW (Steps 1–4), MEDIUM (Step 6)
- **Depends on**: complements `ui-polish-modern-shell.md` (chrome/design system) and
  `016-edit-creation-clip-selection.md` (candidate quality)
- **Planned at**: commit `6fc6c6d`, 2026-07-20

## Problem (from live testing)

On the Review page the user could not tell that generated clips were browsable,
did not understand the "Clip generation" knobs or why they existed, and could
not tell whether the AI reviews *all* clips or only the ones they included.
Root causes found in code:

- **Buried clips**: `SourceClipsPanel` is a `<details>` collapsed by default,
  positioned *last* in `review-main` (`Review.tsx`), under the advanced knobs and
  the AI suggestions. Its summary read as a plain heading, so "All clips (24)"
  looked like an empty section.
- **Advanced knobs in prime real estate**: `ClipGenerationPanel` (plan 012) sat
  first, with developer-speak copy ("Adjust source clip creation without
  rerunning FFmpeg").
- **Two smoothness controls**: header "Display filter" (`Review.tsx:112`) and
  panel "Smoothness used to generate clips" — still confusing even after plan
  012's relabel.
- **Include/exclude semantics were invisible and, worse, partly untrue**: the
  agent's candidate pool (`api.py:_review_inputs` → `mcp_server._list_candidates`)
  was **unfiltered** — excluding a clip did not keep it out of AI "Suggested
  cuts"; the model only saw decisions as read-only context.

## Step 1 — Structure, copy & exclude-honoring (DONE this session)

Shipped (verified: `tsc` + `eslint` clean; 363 backend tests + ruff green;
HMR-confirmed in the running dev app):

1. **Reordered `review-main`**: "Suggested cuts" (AI) → "Browse your clips"
   (source clips) → "Advanced: how clips are found" (knobs, last).
2. **Reframed the generation panel** — plain-language summary + intro paragraph
   explaining what the levers do and that defaults suit most footage.
3. **Made the clips panel discoverable** — actionable "Browse your clips (N)"
   summary, a boxed panel with padding, and a helper line explaining that adding
   a clip builds your own edit and removing it also drops it from AI suggestions.
4. **Behavior fix**: excluded clips are now filtered out of the agent's candidate
   pool in `api._review_inputs(project_id, excluded_clip_ids)`, driven by
   `controller.document.decisions` in `_run_review_turn`. Test:
   `test_excluded_clips_are_hidden_from_the_review_agent`.

## Step 2 — Poster thumbnails, then open clips by default (TODO)

`ClipCard` mounts a `<video preload="metadata">` per card
(`ClipCard.tsx:173`); ~24 cards is the documented N-stream jank, which is why
the clips list must stay lazily-mounted and cannot simply open by default.

1. Extract a poster frame per candidate at analysis time (reuse the frame JPEGs
   already sampled for the review agent — `mcp_frame_paths`) and render an
   `<img>` poster in the card; mount the `<video>` only on first play.
2. With posters, open "Browse your clips" by default (or show a paged/virtualized
   grid) so clips are visible without a click.
- **Verify**: a 24-clip project renders without the multi-stream stutter (manual
  QA on the Electron stack); `tsc` + `eslint` clean.

## Step 3 — Consolidate the two smoothness controls (TODO)

Fold the header "Display filter" and the panel "generation smoothness" into one
mental model. Options: drop the display filter entirely (generation smoothness is
the real knob), or clearly label the header as a *view-only* filter that never
regenerates. Decide and remove the redundant one.
- **Verify**: only one smoothness control affects results; copy names it plainly.

## Step 4 — Honor "included" as an AI preference (TODO)

Step 1 gave excluded clips a hard guarantee (never proposed). Included clips are
in the pool but not preferred. Pass an `included_clip_ids` hint into
`run_review_turn` and bias `deterministic_versions` + the prompt to prefer them,
so "include" is meaningful for AI suggestions, not just the manual timeline.
- **Verify**: with clips included, proposed Versions favour them; backend test.

## Step 5 — Mental-model onboarding (TODO)

A one-time inline explainer (dismissible) distinguishing the three objects:
**Suggested cuts** (complete AI edits) · **Your clips** (individual pieces you add
to your own edit) · **Working timeline** (the edit you're building / will export).
Mirror the `UBIQUITOUS_LANGUAGE.md` terms.
- **Verify**: renders once, dismiss persists per project; `tsc`/`eslint` clean.

## Step 6 — Adopt the design system (TODO, optional/larger)

Execute `ui-polish-modern-shell.md` (shadcn/Radix/lucide) for the Review shell so
sections, cards, sliders, and dialogs read as one professional editor rather than
plain scaffolding. Larger effort; sequence after Steps 2–5 land.

## STOP conditions

- Drift check shows a cited range moved and cannot be confidently re-mapped.
- Step 2 poster extraction would re-run ffmpeg beyond the frames already sampled.

## Verification (run before claiming done)

```
cd backend && source .venv/bin/activate && python -m pytest -q && .venv/bin/ruff check src tests
cd frontend && npx tsc --noEmit -p tsconfig.json && npx eslint . --max-warnings=0 --ignore-pattern src/renderer/src/types/generated.ts
```
