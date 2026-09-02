# Plan 029: Poster-first Candidate Clip cards and play-once previews

Status: PHASES 1-3 DONE (2026-09-03) · PHASE 5 TODO · Priority P1 · Effort M · Risk LOW · Category performance + UX
Written against `9ee7ee4`, 2026-09-02. Absorbs item 1 of
[`017-review-page-clarity-and-polish.md`](017-review-page-clarity-and-polish.md),
which now keeps only its smoothness-controls item.

> **For agentic workers:** phases are ordered and each step has its own
> verification. Do not start a later phase before the earlier one is green.
> Checkboxes track progress.

## Why

Grid is the default Review view (`SourceClipsPanel.tsx:82`) and every
`ClipCard` mounts a real `<video preload="metadata">`
(`ClipCard.tsx:139-142`). `preload="metadata"` is not free: the browser opens
the file, range-requests enough of the container to parse its header, and
allocates a demuxer per element.

`max_candidates_per_video` defaults to 30 (`clip_assembly.py:19`), so an
eight-file drone session produces up to ~240 cards, i.e. ~240 media elements and
~240 range requests against a local server that Chromium limits to roughly six
concurrent connections per origin. Plan 017 recorded observed jank at ~24 clips;
real footage lands an order of magnitude past that.

A poster image costs one small JPEG fetch instead. The frames already exist on
disk after analysis, so nothing needs re-encoding.

Second change, same component: previews currently **loop forever**. The
`onTimeUpdate` handler resets `currentTime` to `clip.start_sec` on reaching
`clip.end_sec` (`ClipCard.tsx:146-152`). A wall of looping 4K video is both
distracting and expensive. Default becomes play-once; a small icon lets the user
re-enable looping per card.

## Decisions already made — do not relitigate

- **Poster delivery is an HTTP route**, not preload/IPC. The rest of the
  renderer fetches media over HTTP (`api/client.ts`, `buildVideoMediaUrl`), so a
  route stays consistent and keeps the browser's image cache working.
- **No pagination and no virtualization in this plan.** Pagination targets data
  volume, but the payload is small JSON and the cost is media-element
  instantiation, so it addresses the wrong axis. Windowing would additionally
  break the exact-count E2E assertions at
  `review-browser-redesign.spec.ts:387-405`, which are what protect filtering
  correctness. Revisit windowing only if a measured 240-clip session still
  stutters *after* this plan lands.
- **Loop preference is per-card and in-memory.** Not persisted to the project
  or backend. If persistence is wanted later it is a separate plan.
- **No prototype step.** The mechanism and the numbers are already established.

## Phase 1 — Serve sampled frames

- [x] **Step 1.1 — Write the failing backend test.**
  Add to the existing backend API tests (follow the nearest existing route test
  as the pattern for client construction and project fixtures). Assert:
  - `GET /projects/{project_id}/videos/{file_id}/poster?at_ms=0` returns `200`
    with `content-type: image/jpeg` for a project whose analysis produced frames.
  - The response body is the bytes of the sampled frame nearest `at_ms`.
  - A project with no sampled frames yet returns `404`.
  - An unknown `project_id` or `file_id` returns `404`.
  - `at_ms` values that are negative or non-integer return `422`.
  - **Path traversal is impossible:** a `file_id` of `../../etc/passwd` returns
    `404` and reads nothing outside the samples directory.

  Verify: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q` fails on
  exactly these new tests and nothing else.

- [x] **Step 1.2 — Implement the route.**
  Add `GET /projects/{project_id}/videos/{file_id}/poster` to
  `backend/src/api.py`, placed next to the existing media route at
  `api.py:398` and mirroring its shape (`registered_video()` for the 404 path,
  `FileResponse` for the body).

  Resolution rules:
  - Base directory is `samples_dir(project_id) / str(file_id)`. Note
    `samples_dir` (`api.py:1552`) returns `.../samples` for folder-backed
    projects and `.../frames` otherwise — use the helper, never hand-build it.
  - Candidate files are `sorted(base.glob(f"{file_id}_*.jpg"))`, skipping any
    stem containing `raw`, exactly as `mcp_frame_paths` (`api.py:979-1005`)
    already does. Reuse that selection logic rather than duplicating it —
    extract a shared helper if that is cleaner.
  - Parse the trailing `_{milliseconds}` from each stem and return the file
    whose timestamp is nearest `at_ms`.
  - **Never join a caller-supplied string into a path.** `file_id` is only used
    inside a `glob` pattern and compared against resolved names; confirm the
    resolved path is inside the base directory before serving.
  - Set a long `Cache-Control` (frames are immutable once analysis has run).

  Verify: the Phase 1 tests pass; `cd backend && .venv/bin/ruff check src tests`
  is clean.

- [x] **Step 1.3 — Add the client URL builder.**
  Add `buildClipPosterUrl(projectId, fileId, atMs)` to
  `frontend/src/renderer/src/api/client.ts`, directly beside
  `buildVideoMediaUrl` (`client.ts:79-81`) and following its exact style,
  including `encodeURIComponent` on both path segments.

  Verify: `cd frontend && npm run typecheck && npm run lint:frontend`.

**Out of scope for Phase 1:** no Pydantic model changes, so `generated.ts` must
not change. If `npm run typecheck` reports generated-type drift, you have
changed a model — stop and report.

## Phase 2 — Poster-first cards

- [x] **Step 2.1 — Write the failing E2E assertions.**
  Extend `frontend/e2e/review-browser-redesign.spec.ts`. In the Grid view,
  assert:
  - `browser.locator('video')` has count `0` on first paint.
  - Every visible card renders an `<img>` whose `loading` attribute is `lazy`.
  - After clicking one card's play control, exactly `1` `<video>` exists.

  Verify: `cd frontend && npx playwright test e2e/review-browser-redesign.spec.ts`
  fails only on the new assertions.

- [x] **Step 2.2 — Render a poster instead of a video.**
  In `ClipCard.tsx`, replace the unconditional `<video>` with an `<img>`:
  - `src` from `buildClipPosterUrl(projectId, clip.file_id, clip.start_sec * 1000)`.
  - `loading="lazy"` and `decoding="async"` so off-screen deferral comes from
    the platform rather than custom scroll code.
  - `alt` must stay equivalent to the current
    `aria-label={`Preview ${clip.file_name}`}` so accessible naming does not
    regress.
  - Type the poster URL as `string | null` and narrow it in the component; do
    not use an empty string as a sentinel. A clip with no poster (analysis not
    run, or a 404) must still render the card and stay playable.

- [x] **Step 2.3 — Mount the video only on first play.**
  Keep a local `activated` boolean. The `<video>` is rendered only once
  `activated` is true; the play control sets it and then plays. Once activated,
  the element stays mounted for that card so the existing pause/seek and
  `usePreviewAudio` behaviour is untouched.

  Preserve exactly: `usePreviewAudio` muting, `SourceAudioBadge`,
  `SourceTrack`, the playhead readout, and the existing exclusive-playback
  behaviour where starting one preview pauses another.

  Verify: Phase 2 E2E assertions pass; `npm run typecheck && npm run lint`.

## Phase 3 — Play once by default, with an opt-in loop

- [x] **Step 3.1 — Write the failing E2E assertions.**
  In `review-browser-redesign.spec.ts`, assert that after a preview reaches
  `clip.end_sec` the video is paused rather than restarted, and that the loop
  control's `aria-pressed` reflects its state and survives a pause/play cycle.
  Drive playback deterministically by setting `currentTime` close to `end_sec`
  rather than waiting out the clip.

- [x] **Step 3.2 — Change the default to play-once.**
  In `ClipCard.tsx`, the `onTimeUpdate` handler currently resets
  `currentTime` to `clip.start_sec` when `currentTime >= clip.end_sec`
  (`ClipCard.tsx:146-152`), which loops forever. Change it so that on reaching
  `clip.end_sec` it **pauses** and resets `currentTime` to `clip.start_sec`, so
  the next press replays from the start.

- [x] **Step 3.3 — Add the loop toggle.**
  A small icon button on the card, following the existing
  `.clip-play-btn` pattern for placement and styling and reusing the repo's
  hand-authored inline SVG convention (see `Sidebar.tsx` for examples — do not
  add an icon dependency). Requirements:
  - `aria-pressed` reflects state; accessible name changes between
    "Loop preview" and "Play once".
  - Keyboard reachable and focus-visible, matching sibling controls.
  - When enabled, restore the previous restart-at-end behaviour for that card.

  Verify: Phase 3 E2E assertions pass.

## Phase 4 — Full gates and visual baselines

- [x] **Step 4.1 — Run every gate.**
  ```
  cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests
  cd frontend && npm run lint && npm run typecheck && npm run test:main
  ```
  All must pass.

- [x] **Step 4.2 — Visual baselines: no change needed. This step's premise was
      wrong.** It predicted the `review-grid` fixtures would fail. They do not:
      31/31 visual tests pass untouched. Opening
      `review-grid-1440x1000-light-chromium-darwin.png` shows why — the
      fixture's viewport stops at the "Your clips" filter row, so **the
      ClipCards are below the fold and were never in any baseline**.

      Record this as a coverage gap, not a success: the visual suite does not
      look at Candidate Clip media, so it neither validates nor guards this
      change. Do not cite "31/31 green" as evidence the cards render correctly.

- [ ] **Step 4.3 — Confirm the win, with numbers.**
  On a project with at least 60 candidate clips, record in the PR: the count of
  `<video>` elements in Grid on first paint (expected `0`), and the count of
  network requests for media versus posters. State the clip count used.

- [ ] **Step 4.4 — Reconcile the plans.**
  Mark item 1 in `017-review-page-clarity-and-polish.md` as delivered by this
  plan, and update the `react-doctor-triage.md` note if the `ClipCard` change
  resolves any finding cited there. Update `docs/plans/README.md`: this plan
  moves to `done/`, and 017's row should list only its smoothness item.

## Phase 5 — Write posters during analysis (decided 2026-09-03)

Phases 1-3 resolve a poster at **request** time: the route scans the sampled
frames for a Source Video and serves the one nearest `at_ms`. That works, but it
is the wrong place for the work, and it is the direct cause of three problems
already recorded below and in the review of PR #72:

- Every poster request re-sorts, re-resolves and re-stats every sampled frame
  for that source, so many cards from one long video repeat the same traversal.
- The poster is only ever *approximately* the clip's first frame, because the
  nearest sample is on the analysis sampling grid, not the clip boundary.
- The renderer has to send a millisecond offset, which is a float in the domain
  (`clip.start_sec` is a frame timestamp) but an integer in the route — the
  mismatch that made nearly every poster 422 before it was fixed by rounding.

**Decision:** a Candidate Clip's poster becomes a real artifact produced when
the clip is analysed, not something derived per request.

- [ ] **Step 5.1 — Write a poster per Candidate Clip during analysis.**
      After clip assembly, persist one poster for each Candidate Clip from the
      already-sampled frame nearest that clip's `start_sec`. This must be a copy
      of an existing sample — **no new FFmpeg work**, which is the same
      constraint plan 017 carried. Suggested location:
      `<project work dir>/posters/{clip_id}.jpg`, beside `samples/`.

- [ ] **Step 5.2 — Regenerate posters on re-derive.**
      Re-deriving clips from cached Frame Scores produces different ranges, and
      `clip_id` is a uuid5 of file plus range, so the ids change and stale
      posters would accumulate. Rewrite the poster set whenever the Candidate
      Clip library is rebuilt, and remove posters whose `clip_id` is no longer
      in the library.

- [ ] **Step 5.3 — Serve posters by `clip_id`.**
      Add the clip-scoped route and prefer it. Keep the existing
      file-plus-`at_ms` route as a fallback so projects analysed before this
      change still show posters instead of regressing to the placeholder;
      remove it only once no supported project predates Phase 5.

- [ ] **Step 5.4 — Simplify the client.**
      With a `clip_id` route the renderer no longer sends a timestamp at all,
      so `buildClipPosterUrl`'s rounding guard and the float/integer mismatch
      disappear rather than being defended against.

- [ ] **Step 5.5 — Cover the artifact, not just the endpoint.**
      Assert that analysing a project writes exactly one poster per Candidate
      Clip, that re-deriving replaces them, and that a poster is a readable
      JPEG. The Phase 1-3 tests prove the renderer contract with mocked
      responses; they cannot prove that posters exist in a real analysis, which
      is precisely the gap recorded in "Open question" below.

**This phase closes the open question.** Once posters are written by analysis,
"do sampled frames exist for this project?" stops being a question the UI can
get a surprising answer to.

## Corrections to this plan, found while executing

- **The loop control keeps a stable accessible name.** This plan originally
  asked for the name to change between "Loop preview" and "Play once". That is
  wrong: combined with `aria-pressed` it double-announces ("Play once,
  pressed"). The name is fixed at "Loop preview" and `aria-pressed` carries the
  state, which is the correct pattern.
- **There is no existing exclusive-playback behaviour to preserve.** Phase 2
  told the executor to preserve "the existing exclusive-playback behaviour
  where starting one preview pauses another". No such behaviour exists in
  `ClipCard`, before or after this change — the Version player has it, the
  Candidate Clip cards do not. Nothing was lost; the instruction was simply
  false.
- **Line references drift.** The exact-count assertions this plan told
  executors not to touch have moved from `290-313` to `387-405` as tests were
  added around them. They are unmodified.

## Follow-ups deliberately not done here

Both came out of the code-quality review and are real, but neither blocks this
change. Decide them separately rather than growing this plan:

- **Activated videos are never released.** `activated` only ever flips to
  true, so each card keeps its `<video>` until the card unmounts. A user who
  previews their way through a long library rebuilds the very cost this plan
  removes. Fixing it needs a policy decision: a single active clip lifted into
  `SourceClipsPanel`, or returning to the poster when playback ends.
- ~~Each poster request rescans every frame for that source.~~ **Now owned by
  Phase 5**, which removes the per-request scan entirely rather than caching
  around it.

## Open question to settle before calling this shipped

The E2E fixture's project has **no sampled frames on disk**, so the poster
route 404s there and every card shows the fallback. Real projects do have them
— 8,550 JPEGs exist under `.ai-clip-assembler/projects/*/frames/{file_id}/`,
at exactly the path the route resolves — so the feature works in normal use.
But confirm which analysis paths persist frames and which do not, because a
feature that works in principle and is inert in practice is exactly the failure
mode plan 025 documents for SigLIP. Verify on a real footage project before
ticking Step 4.3.

## Done criteria

- [x] Grid view mounts zero `<video>` elements before any play interaction,
      asserted by E2E.
- [x] Posters render from existing sampled frames with no new FFmpeg work.
- [x] A clip with no sampled frames still renders and still plays.
- [x] Previews play once by default; the loop toggle works, is labelled, and is
      keyboard reachable.
- [ ] Backend, ruff, lint, typecheck, `test:main` and the full Playwright suite
      pass, including exact-count filter assertions at
      `review-browser-redesign.spec.ts:290-313`, which must remain unchanged.
- [x] Visual baselines need no update — they never covered these cards (see Step 4.2).
- [x] `generated.ts` unchanged.

## Stop and report instead of improvising if

- The sampled frames are absent for a project that has completed analysis —
  that is an analysis-pipeline bug, not something to work around here.
- Making posters work appears to need a change to the analysis pipeline, a
  Pydantic model, or the HTTP contract beyond adding the one route.
- The exact-count E2E assertions start failing. They guard filtering
  correctness; changing them to accommodate this work is out of scope.
- Poster-first alone leaves Grid still visibly janky at 240 clips. Report the
  measurement; windowing is a separate decision.
