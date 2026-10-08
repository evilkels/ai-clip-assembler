# 019: Find more clips

A **Find more** button beside each Source Video on the Review Board with two
choices, **More clips** and **Longer clips**, that appends Candidate Clips
from the cached analysis while the Timeline, the Editor's decisions and the
Undo History stay exactly as they are. Roadmap milestone 6. Depends on
[037](037-extraction-quality.md) Phase 3.

## Context

The previous version of this plan (2026-07-22, absorbing 028 on 2026-09-02)
first collapsed the two generation callers behind a `generate_clip_library`
seam with behaviour parity, then built expansion on top. The seam is dropped:
the feature needs only the window selector 037 adds to
`backend/src/clip_assembly.py`, and the two existing callers (`analyze` and
`clips/rederive`) stay as they are. The step-level spec in
[`done/028-find-more-clips-from-source-video.md`](done/028-find-more-clips-from-source-video.md)
is replaced by this file; its requirements that still hold are listed under
Decisions (stable `clip_id`, cached analysis only, no overlap with the
existing library for More clips, at most three per request, Timeline and
decisions preserved, HTTP 422 without cached analysis, `added_count: 0` when
nothing is left, no new runtime dependencies).

What the code does today (verified 2026-10-08):

- The Review Board has no per-Source-Video grouping. Candidate Clips are one
  ranked list (`frontend/src/renderer/src/components/SourceClipsPanel.tsx`);
  each card shows the file name and a `SourceTrack` (`ClipCard.tsx:253-284`).
  A Source Video with no Candidate Clips is invisible on Review. The Source
  Video list is `uploadedVideos` in `state/ReviewContext.tsx:66`, and
  `generation_stats.per_file` has a key for every analyzed file.
- `POST /projects/{id}/clips/rederive` (`backend/src/api.py:824`) regenerates
  every cached file and resets decisions, trims and the Timeline. It is the
  wrong tool for this feature and stays on the Import step.
- `api._finalize_clip_set` calls `invalidate_timeline_controller`, which drops
  the controller and with it the Undo History. `TimelineLifecycle.get_controller`
  refreshes the candidate registry through `controller.update_sources` on
  every call (`backend/src/timeline_service.py:88-104`), so appending clips
  needs no invalidation.
- `clip_id` is `uuid5(file_id, start, end)` (`clip_assembly.py:132`); Look
  Groups come from `analysis_service._assign_look_groups`, which reuses cached
  embeddings and never re-embeds (`analysis_service.py:440-456`).
- Versions carry `based_on_review_context_fingerprint`, which covers the
  candidate list, so older Versions show as out of date after an append with
  no new code (`backend/src/review_state.py`).

### Decisions

- **D1 Endpoint.** `POST /projects/{project_id}/clips/find-more`. Request
  `FindMoreClipsRequest { file_id: str, mode: Literal["more", "longer"] }`,
  response `FindMoreClipsResponse { project_id, file_id, mode, clips, generation_stats, added_clip_ids: list[str], added_count: int }`
  where `clips` is the full ranked library. Both models live in
  `backend/src/models.py` so `npm run gen:types` emits them. 404 for an
  unknown project or `file_id`; 422 with detail
  `Analyze this video first; its cached frame scores are not available` when
  `project["frame_scores"]["per_file"]` has no entry for the file.
- **D2 Limit.** `FIND_MORE_LIMIT = 3` in `clip_assembly.py`; every request
  appends at most three. Repeated clicks keep appending until nothing is
  left.
- **D3 Preferences.** `preferences_from_request(generation_stats["preferences"])`,
  so Find more uses the same minimum, maximum, steadiness and turn-rate rules
  the library was built with; defaults apply when the stats carry none.
- **D4 More clips.** `find_more_clips(..., mode="more")`:
  tier 1 collects `candidate_windows(run, min, max, scene_end)` for every run
  from `candidate_runs(frames, smoothness_threshold, max_turn_rate)` and
  calls 037's `select_windows(all_windows, limit=3, exclude=existing)`,
  where `existing` is every `(start_sec, end_sec)` of this file already in
  `project["clips"]`, rejected ones included. If fewer than three come back,
  tier 2 enumerates ungated windows per scene (the fallback shape at
  `clip_assembly.py:230-256`) and calls
  `select_windows(..., limit=3 - len(tier1), exclude=existing + tier1)`;
  those are made with `make_clip(..., fallback=True)` so their honest scores
  and `fallback` tag show. No per-scene or per-video cap applies: the Editor
  asked for more. Result ordered by `overall_score` descending, then
  duration descending, then start ascending.
- **D5 Longer clips.** `find_more_clips(..., mode="longer")`:
  `longer_min = preferences.max_clip_duration_sec`,
  `longer_max = 2 * longer_min`, `interval` = the median gap between Frame
  Samples (1 s at 1 fps; expose the computation `candidate_windows` already
  does as `sample_interval(frames)`). Windows are
  `candidate_windows(run, longer_min + interval, longer_max, scene_end)` over
  steady runs only, no tier 2, so every result is strictly longer than the
  library's maximum and never repeats a library `clip_id`. The caller passes
  every existing range of the file; in this mode the function ignores ranges
  whose length is `<= longer_min`, so only earlier Longer results block a
  window. Overlap with shorter
  existing clips is intended: a longer take naturally contains them, the
  `clip_id` differs, and the draft and Timeline overlap guards keep both out
  of one edit. The library shows the highest-scored clip per Look Group, so a
  longer take may share a group with its shorter sibling; that is existing
  behaviour.
- **D6 Merge.** The endpoint does not call `finalize_clip_set`. It drops new
  clips whose `clip_id` is already present, runs
  `enrich_clips_with_source_metadata({"clips": new, "videos": project["videos"]})`,
  appends to `project["clips"]`, calls the renamed public
  `analysis_service.assign_cached_look_groups(all_clips, project)`
  (today `_assign_look_groups`), re-sorts by `overall_score` descending,
  adds `added_count` to `generation_stats.per_file[file_id].candidates_generated`
  and `.candidates_kept` and to the totals, and calls
  `persist_project_results`. It never touches `project["timeline"]`,
  `project["harness_id"]`, `frame_scores`, decisions or the saved
  `timeline.json`, and never calls `invalidate_timeline_controller`.
- **D7 Zero candidates.** A Source Video with cached frame scores but no
  Candidate Clips still gets both choices; More clips reaches tier 2, so it
  returns something unless the file is shorter than the minimum clip length,
  in which case `added_count` is 0. A Source Video with no cached frame
  scores (never analyzed) shows the button disabled with the title
  `Analyze this video on the Import step first`.
- **D8 Cached only.** No FFmpeg, scene detection, motion analysis, embedding
  or AI call. New clips are rule-scored even when the library was AI-scored.
  Re-analysis remains the Import step's scoped Analyze.
- **D9 Placement and copy.** A `Source videos` strip at the top of the clips
  panel, above `.review-browser-toolbar` in `SourceClipsPanel.tsx`, new
  component `components/SourceVideoStrip.tsx`, `data-testid="source-video-strip"`.
  One row per `uploadedVideos` entry: the file name, a count (`4 clips`,
  `1 clip`, `No clips yet`) and a `Find more` button
  (`aria-haspopup="menu"`, `aria-expanded`) opening a `role="menu"` with two
  `role="menuitem"` buttons `More clips` and `Longer clips`. While a request
  runs, that row's button reads `Finding…` and is disabled; other rows stay
  live. A `role="status"` line with `aria-live="polite"` under the strip says
  `Added 3 clips from DJI_0814.MP4`, `Added 2 longer clips from DJI_0814.MP4`,
  `No more clips found in DJI_0814.MP4`,
  `No longer steady stretches in DJI_0814.MP4 — try More clips`, or the
  backend's error detail. Cards in `added_clip_ids` get a `New` chip and
  `data-new="true"` until the next successful Find more; the first new card
  scrolls into view. The helper copy
  `which clips exist is set by How clips are found on the Import step` gains
  `; Find more adds clips from one Source Video`.
- **D10 State.** `api/client.ts` gets
  `findMoreClips(projectId, fileId, mode): Promise<FindMoreClipsResponse>`.
  `ReviewContext` gets `findMoreClips(fileId, mode): Promise<number>` and
  `findMorePendingFileId: string | null`. On success it calls a new
  `applyClipLibrary(clips, generationStats)` that replaces only `clips` and
  `generationStats` (unlike `setClips`, which resets decisions, order, trims
  and Timeline Items), then `refreshTimelineDocument()`.
- **D11 Not exposed to chat or MCP.** No Review-chat Operation and no MCP
  tool in this plan.

## Phase 1: Backend

- [ ] 1.1 Add tests for `find_more_clips`. Done when the tests below exist in
  `backend/tests/test_clip_assembly.py` and fail because the function does
  not exist.
  - Fixture: 61 frames 0–60 s, smoothness 9.0 except 20–25 s at 4.0 (two
    steady runs), `scene_bounds={0: (0.0, 61.0)}`, preferences min 3 / max
    10. `existing` is the library's ranges from `assemble_smooth_clips` on
    the same frames.
  - `test_find_more_returns_up_to_three_ranges_outside_the_library`:
    `mode="more"` → exactly three clips with ranges `(10, 19)` and `(56, 60)`
    from the steady leftovers and `(19, 26)` tagged `fallback` from tier 2;
    none overlaps `existing` or another result; `file_id` and `file_name` as
    given; a second call returns the same ids.
  - `test_find_more_tops_up_with_honest_fallback_windows`:
    `exclude=[(0.0, 20.0), (25.0, 61.0)]` (every steady second is taken) →
    exactly one clip, range 20–25 s, tagged `fallback`, `smoothness_score`
    4.0.
  - `test_find_more_returns_nothing_when_footage_is_exhausted`:
    `exclude=[(0.0, 61.0)]` → `[]`.
  - `test_find_longer_returns_windows_longer_than_max_and_overlaps_short_clips`:
    `mode="longer"` with the library's ranges as `exclude` → the range set
    `{(0, 19), (26, 46), (46, 60)}`; every `duration_sec` is in `(10, 20]`;
    at least one overlaps a 10 s library clip; none overlaps another result.
  - `test_find_longer_returns_nothing_without_long_steady_runs`: a frame at
    4.0 every 8 s → `[]`.
- [ ] 1.2 Implement `find_more_clips`. Done when 1.1 passes. (after 1.1)
  - `clip_assembly.find_more_clips(file_id, file_name, frames, preferences, *, mode, exclude, scene_bounds=None, source_duration_sec=None, limit=FIND_MORE_LIMIT) -> list[ClipSuggestion]`
    per D4 and D5, reusing `candidate_runs`, `candidate_windows`,
    `select_windows` and `make_clip`. Extract the scene-end clamp from
    `assemble_smooth_clips` into a helper both functions use.
- [ ] 1.3 Add endpoint tests. Done when
  `cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -k find_more -q`
  fails on a missing route. (after 1.2)
  - Build a folder project with two stubbed files the way
    `test_analyze_folder_project_persists_and_reloads_frame_scores` does, then
    analyze with `max_clips_per_scene: 1` so footage is left over.
  - Assert: 404 for unknown project and unknown `file_id`; 422 with the D1
    detail for a file without cached frame scores; a successful call persists
    the new clips in `results.json`, returns them in `clips`, and their
    `look_group` is an `int`; `GET /projects/{id}/timeline/document` is
    byte-equal before and after; an `include` Operation made before the call
    can still be undone after it; `document.decisions` is unchanged; a second
    identical call adds no duplicate ids; when nothing is left the response
    is 200 with `added_count == 0`; `frame_scores.json` is unchanged; a
    monkeypatched `run_vidstabdetect` and `extract_frames` are never called.
- [ ] 1.4 Implement the endpoint and models. Done when 1.3 passes and
  `npm run gen:types && npm run check:types-fresh` succeed from `frontend/`.
  (after 1.3)
  - Models per D1 in `backend/src/models.py`; route in `backend/src/api.py`
    next to `rederive_clips`; merge per D6; rename `_assign_look_groups` to
    `assign_cached_look_groups` and update its callers.

## Phase 2: Review Board

- [ ] 2.1 Add a failing Playwright spec. Done when
  `cd frontend && npx playwright test e2e/find-more-clips.spec.ts` fails
  because the strip does not exist.
  - Real backend through `setupReview(page, { videos: [fixtureVideo('find-more-a', 'slateblue', 12), fixtureVideo('find-more-b', 'seagreen', 8)] })`;
    capture the project id from the analyze request.
  - `More clips appends cards and keeps the Timeline`: click
    `Add to working timeline` on the first card; route
    `**/projects/*/clips/find-more` with `route.fetch()`, and when the real
    body has `added_count: 0` append one synthetic clip for `find-more-a.mp4`
    at 9–12 s to `clips` and `added_clip_ids`; open the first row's
    `Find more` menu, click `More clips`; assert the request body is
    `{ file_id, mode: 'more' }`, the row read `Finding…` while pending, the
    status reads `Added 1 clip from find-more-a.mp4`, the card count grew by
    one, the new card shows `New`, the first card still reads
    `Remove from working timeline`, and
    `page.request.get(.../timeline/document)` has the same item count as
    before.
  - `Longer clips with nothing to add says so`: fulfil with `added_count: 0`;
    assert the status
    `No longer steady stretches in find-more-a.mp4 — try More clips` and the
    button is enabled again.
- [ ] 2.2 Add the client call and Review state. Done when
  `npm run typecheck` passes with `findMoreClips`, `findMorePendingFileId`
  and `applyClipLibrary` in place per D10. (after 2.1)
- [ ] 2.3 Add the strip and copy. Done when 2.1 passes and
  `npx playwright test e2e/review-browser-redesign.spec.ts` still passes.
  (after 2.2)
  - `SourceVideoStrip.tsx` per D9; styles in `styles.css` next to
    `.source-clips-head`; menu closes on Escape, outside click and after a
    choice; focus returns to the button.
- [ ] 2.4 Run the PR gate. Done when `npm run lint`, `npm run typecheck`,
  `npm run test:backend`, `npm run test:main`, `npm run test:e2e` and
  `npm run build` pass from `frontend/`. (after 2.3)

## Phase 3: Docs

- [ ] 3.1 Document the feature. Done when `../USER_GUIDE.md` has a
  `Find more clips` section (what More and Longer do, that they use the
  analysis already on disk, and that the Timeline is untouched) and
  `frontend/e2e/README.md` lists `find-more-clips.spec.ts`.
- [ ] 3.2 Close the loop. Done when `done/028-find-more-clips-from-source-video.md`
  says under its banner `Replaced by [019](../019-clip-library-generation-and-expansion.md) on <date>`
  and `python3 scripts/plans.py sync` runs clean.

## Human tasks

- [ ] H1 Try More clips and Longer clips on Estepona in the built app and say
  whether the status copy and the `New` chip read right.
