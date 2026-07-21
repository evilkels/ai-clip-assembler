# Compare-Versions Review UI — Implementation Plan

**Status:** DONE (2026-06-21). Planned at commit `2d0f918`. Spec (behavioural source of truth): `docs/specs/2026-06-21-compare-versions-review-ui-design.md`.

**Goal:** Rebuild the Review screen so the user compares several complete candidate cuts ("Versions") side-by-side and adopts one, instead of scanning a flat grid of individual clip cards. Triggered by direct user feedback: the old layout was "not well structured … random cards," and a 50s source yielded only ~one suggested clip.

**Architecture:** Versions use a preview-spec model — a mocked agent (`proposeVersions`, real agent is a separate plan "SP-B") builds candidate cuts client-side; a new backend op `replace_timeline` atomically swaps the single live Timeline Document's items in one undoable step when the user clicks "Use this version." No second mutation path was introduced; `ReviewContext.applyTimelineOperation` is called directly.

**Key decisions (with rationale):**
- Extracted a shared `useSequencePlayer` hook from `Timeline.tsx`'s existing forward-playback engine (built by plan 004 to kill drift/stutter) and migrated `Timeline.tsx` onto it, so Version previews and the Timeline share one playback engine rather than a second copy. This migration was **e2e-gated with an explicit rollback path** — if it regressed Timeline's sequence-playback e2e beyond one fix attempt, the migration was to be reverted while keeping the hook (still needed for Versions) and logging a follow-up.
- Decomposed the 396-line `Review.tsx` god component into zone components (chat spine, version gallery + source panel, collapsible working strip) to retire tracked `react-doctor` "giant component" debt.
- Source-clips panel collapsed by default — demotes the `ClipCard` grid so Review no longer mounts N × 4K `<video>` elements on load by default, fixing a previously-deferred jank source.
- Explicitly out of scope: `ReviewContext` internals, `styles.css` split, export engine, scoring pipeline, richer candidate pool (separate plan "SP-A"), drag-handle editing in the working strip (separate plan "SP-C" — numeric trim fields stay hidden in this plan).
- No frontend unit-test runner exists or was added (Playwright e2e is the only frontend test surface, per repo convention from plan 004); `proposeVersions` determinism is verified by e2e assertion, not a unit test.

**Surprises / gotchas:**
- The old Review.tsx had `<TimelineEditor/>` and `<ReviewChatPanel/>` mounted as siblings *after* `.page-body`, causing a scroll/hide bug; the new 3-zone shell fixes this structurally by giving each region (chat spine, main, working strip) independent `overflow` management.
- `ClipPreview` new props (`playbackRate`, `scale`) had to be strictly additive/optional with behaviour-preserving defaults so `ClipCard` and `Timeline` stayed byte-identical during the refactor.

**Outcome:** All 6 phases (backend op, Version types/mock, useSequencePlayer + Timeline migration, Version UI components, new Review shell, docs) landed; done criteria (typecheck/build/e2e/backend tests green, ≥3 playable versions, one-step undo adopt, independent scroll regions) were met per the plan's own status marker. Whether the Phase 3 Timeline migration ultimately shipped or was rolled back is not restated here — check `docs/plans/README.md` Dependency notes for the authoritative outcome if that matters.

**Maintenance notes carried forward:** `useSequencePlayer`'s `seek` epoch is the intended insertion point for future gapless cross-file preloading. `proposeVersions` mock is the seam for the real agent (SP-B) — swapping it is a local `Review.tsx` change.
