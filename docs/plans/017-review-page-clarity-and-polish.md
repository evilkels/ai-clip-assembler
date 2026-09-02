# Plan 017: Review-page clarity and polish

Status: Step 1 DONE (2026-07-20). Remaining item 5 (design-system adoption)
DONE via `2026-08-14-studio-workflow-redesign.md`; items 1–4 still TODO, and
item 2 got *worse* — see "Reconciled 2026-08-31" below. Priority P1, effort M,
risk LOW/MED. Planned at `6fc6c6d`; depends on plans 012 and 016.

## Reconciled 2026-08-31 against `redesign/studio-workflows`

- **Item 5 (design-system adoption) is delivered.** The studio redesign restyled
  the Review shell (Tasks 3 and 4) onto shared tokens and added Grid/List/
  Filmstrip Candidate Clip views. This supersedes the pointer to
  `ui-polish-modern-shell.md`, which never executed as written.
- **Item 1 (poster-first cards) is partially delivered.** The new List and
  Filmstrip views mount no `<video>`, so a user can now browse many clips
  without the N×metadata-stream jank. `ClipCard` (Grid) still mounts one
  `<video>` per card, so the original defect survives in the default view. The
  remaining work is narrower than when written: poster-first `ClipCard` only.
- **Item 2 (one smoothness model) is now more urgent, not less.** The redesign
  added a *second* view-only smoothness control (`ReviewFilters.minSmoothness`
  in `lib/reviewView.ts`) alongside the existing generation
  `smoothness_threshold` in `ClipGenerationPanel.tsx`. That is exactly the
  two-confusable-controls problem this item exists to remove, now shipped in a
  more prominent toolbar. Resolve before further Review work.
- **Items 3 and 4 are untouched** by the redesign; they are behavioural and
  remain exactly as written.

## Goal and diagnosis

Make Candidate Clips discoverable and explain Suggested cuts, clip-generation
controls, include/exclude, and the Working Timeline. Live testing found clips
buried in a collapsed last panel, developer-facing generation copy, two
confusing smoothness controls, and excluded clips still entering AI proposals.

## Delivered — Step 1

- Reordered Review to Suggested cuts → Browse your clips → Advanced knobs.
- Reframed generation controls in plain language and made browsing actionable.
- Excluded clip IDs now leave the review agent's candidate pool via
  `_review_inputs`; covered by `test_excluded_clips_are_hidden_from_the_review_agent`.
- Verified 363 backend tests, ruff, TypeScript, ESLint, and dev-app HMR.

## Remaining work

1. **Poster-first cards:** reuse sampled frame JPEGs, render `<img>`, and mount
   `<video>` only on first play. Then open Browse by default or virtualize it.
   This avoids the documented N×metadata-stream jank around 24 clips.

   **Missing prerequisite (found 2026-09-02).** "Reuse sampled frame JPEGs"
   reads as though the frames are already reachable from the renderer. They are
   not. The only media route is
   `GET /projects/{project_id}/videos/{file_id}/media` (`api.py:398`); nothing
   serves the sample frames, and there is no `StaticFiles` mount. The one
   existing consumer, `mcp_frame_paths` (`api.py:979-1005`), returns **local
   filesystem paths** for an agent to open directly, not URLs. So this item
   needs a delivery mechanism decided and built first — either a new HTTP
   poster route mirroring the media route's shape, or a preload/IPC read via
   `window.clipAssembler`. Pick one deliberately; the rest of the renderer
   fetches media over HTTP (`api/client.ts`, `buildVideoMediaUrl`), so the
   route is the more consistent choice and keeps the browser cache working.

   The frames themselves do exist after analysis. Layout, from
   `mcp_frame_paths` and `analysis_service.py:226`:
   `samples_dir(project_id)/{file_id}/{file_id}_{milliseconds}.jpg`, sorted by
   the trailing millisecond stamp, skipping any stem containing `raw`. Choosing
   the frame nearest a clip's `start_sec` gives a poster with no new FFmpeg work.

   **Scale correction.** The plan's "around 24 clips" is the observed threshold,
   not the expected load. `max_candidates_per_video` defaults to 30
   (`clip_assembly.py:19`), so an 8-file drone session yields up to ~240 cards,
   each a `<video preload="metadata">` (`ClipCard.tsx:139-142`) — roughly ten
   times past where the jank was already noticeable, against a local server
   that Chromium limits to ~6 concurrent connections per origin.

   **Workaround available today:** the List and Filmstrip views mount no
   `<video>` at all, so switching away from the default Grid avoids this
   entirely without any code change. Grid is the default
   (`SourceClipsPanel.tsx:82`).
2. **One smoothness model:** remove the view-only filter or label it so clearly
   that it cannot be confused with the generation threshold.
Items 3 (included-means-preferred) and 4 (onboarding explainer) moved to
[`027-authoritative-candidate-library-and-diverse-edits.md`](027-authoritative-candidate-library-and-diverse-edits.md)
on 2026-09-02, since both depend on All Clips being the stated Candidate Clip
authority. Item 5 (design-system adoption) is DONE — delivered by the studio
redesign (`6d79c1b`), not by the retired modern-shell plan.

What remains here is presentation-only. Verified still outstanding on
2026-09-02: grid cards still mount `<video>` directly (`ClipCard.tsx:138-160`),
and both smoothness controls are still present (`Review.tsx:137-155` and
`SourceClipsPanel.tsx:250-260`).

## Verification and constraints

- Poster work must reuse existing samples, not rerun FFmpeg. Manually verify a
  24-clip Electron project has no multi-stream stutter.
- Backend: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`.
- Frontend: `cd frontend && npm run typecheck && npm run lint:frontend`.
- Add focused backend tests for preference semantics and preserve generated
  frontend contract freshness. Stop if drift makes cited behavior unrecognizable.
