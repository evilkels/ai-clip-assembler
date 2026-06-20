# Compare-Versions Review UI Design

Date: 2026-06-21
Status: Implemented (SP1)
Owner: Elvijs

## Goal

Turn the Review step from a forms-and-cards surface into a **video-forward,
creative workspace** where the user compares several complete candidate cuts
("versions") of the montage and adopts one, with the agent framed as a creative
collaborator.

This spec covers the **first sub-project only**: the compare-versions UI built
against a **mocked agent**, using the **preview-spec** versions model. The real
creative agent and a richer candidate pool follow behind the same seam (see
Roadmap).

### Origin

Two annotations on a Review screenshot (2026-06-21):

1. Over the timeline editor / clip area: *"not well structured … I don't like
   field boxes and random cards. I want well displayed videos so I can better
   see what agent suggests are good parts."*
2. Over the chat: *"I like this chat component but it would be nicer if agent
   would be like a video editor creative agent."*

Plus a functional gap the user hit: a 50s source yields only **one** suggested
clip instead of several 3–10s options (root-caused in §"The candidate-pool
gap").

## Decisions locked during brainstorm

1. **Review focus:** compare *full versions* (complete alternative cuts), not
   just better single-clip review.
2. **Versions model:** **preview-specs** — a version is a build-recipe;
   previewed by **client-side sequence playback** (no render); "Use this version"
   **replays** the recipe into the single authoritative timeline. *Rejected:*
   persisted parallel timelines (too invasive to storage/undo/SSE); backend
   ffmpeg-rendered previews (too slow to regenerate interactively).
3. **Build order:** **compare-UI first** with a mocked agent; the real agent and
   richer candidate pool come later behind the same `Version` contract.
4. **Layout:** chat-led **left spine** + **side-by-side compare gallery** with
   **click-to-expand focus player** (main) + full-width **collapsible
   working-timeline filmstrip** (bottom).
5. **Fine-tuning:** numeric In/Out/Speed/Zoom inputs are replaced by **drag
   handles** — deferred to a later sub-project; these controls are **hidden** in
   this slice.
6. **ClipCards** are **demoted** to a collapsible "Source clips" panel (kept for
   inspection/hand-pick, no longer the star).
7. **Adopt** uses a new atomic backend operation **`replace_timeline(items)`**.

## The scroll/hide bug (confirmed root cause)

The user reported the timeline editor can't scroll or hide. In `styles.css`,
`.page` is `overflow:hidden` and only `.page-body` is `overflow:auto`. In
`Review.tsx`, `<TimelineEditor>` and `<ReviewChatPanel>` render as **siblings
after** `.page-body` — outside the scroll region — so they get pushed below the
fold, clipped by `.page`, with no scroll and no collapse. The new 3-zone shell
puts every zone inside a managed scroll/collapse region, fixing this
structurally.

## The candidate-pool gap (point 2 — context, not in this slice)

Why a 50s file yields ~one clip:

- `scene_detection.py` uses PySceneDetect `ContentDetector`, which fires on hard
  visual cuts. Continuous drone footage has none → the whole file is **one
  scene** (shared `scene_id`).
- `clip_assembly.py::assemble_smooth_clips` then **dedupes into a final cut**:
  `max_clips_per_scene = 2` caps the file; it greedily takes the single
  highest-scoring/longest window, then the **non-overlap rule deletes its
  neighbours**, and stops at `target_duration_sec`. Net: ~1 clip.

The new flow needs the opposite — a **rich pool of overlapping 3–10s candidate
segments**. This is a backend sub-project (Roadmap SP-A) and a real prerequisite
for versions on *real* footage, but it does **not** block this slice: the mock
fabricates its own item ranges (see §4).

## Scope of this sub-project

**In:** new layout shell; `Version` data contract; `VersionGallery` /
`VersionCard` / `VersionPlayer`; `WorkingTimelineStrip` (read-mostly); mock
`proposeVersions`; adopt via `replace_timeline`; relocate the chat; demote
ClipCards.

**Out (separate sub-projects; dependencies noted in Roadmap):** richer candidate
pool; real creative agent (voice + powers); drag-handle visual editing.

## Section 1 — Version data contract (the seam)

The mock emits this shape now; the real agent implements the **same** shape
later, so swapping the producer is a one-line change. New file
`frontend/src/renderer/src/types/version.ts`:

```ts
interface VersionItem {
  source_clip_id: string;          // references a Candidate Clip
  file_id: string;                 // for media URL + sequence playback
  file_name: string;
  start_sec: number;               // in/out within the source video
  end_sec: number;
  speed: number;                   // 1 = normal; playbackRate
  transform: { scale: number; x: number; y: number }; // digital zoom/pan
}

interface Version {
  version_id: string;
  title: string;                   // e.g. "Punchy Social Cut"
  vibe: string;                    // short mood/pacing phrase
  rationale: string;               // 1–2 sentence creative "why"
  profile: AssemblyProfile;        // reuse existing union
  total_duration_sec: number;      // sum of effective item durations
  items: VersionItem[];            // ordered build-recipe
}
```

`VersionItem` mirrors the backend `TimelineItem` **minus `item_id`** (versions
aren't live yet) **plus** `file_id`/`file_name` (so the player can resolve media
without a separate lookup). When the real agent lands, this type is mirrored in
`backend/src/models.py`.

## Section 2 — Layout / information architecture

One scroll-managed shell replacing the current stacked `Review.tsx` body:

```
┌ page-header (title · smoothness filter) ───────────────────────────┐
├ Agent chat   │  Version compare gallery                            ┤
│ (left spine, │  ┌ V1 ┐ ┌ V2 ┐ ┌ V3 ┐   ← side-by-side, playable    │
│  collapsible)│  └────┘ └────┘ └────┘   click → expands to focus    │
│              │  ▸ Source clips (collapsible: old ClipCard grid)    │
├──────────────┴─────────────────────────────────────────────────────┤
│ ▾ Working timeline (full-width collapsible filmstrip)              │
└────────────────────────────────────────────────────────────────────┘
```

Mapping every existing `Review.tsx` section to its new home:

| Today | New home |
| --- | --- |
| `ReviewChatPanel` | Left spine (relocated, restyled; behaviour unchanged this slice) |
| `review-grid` of `ClipCard`s | Collapsible **Source clips** panel (secondary) |
| `draft-setup` (profile/target/regenerate) | Folds into gallery header ("ask the agent for cuts") |
| `accepted-strip` + `TimelineEditor` | **WorkingTimelineStrip** (filmstrip; numeric fields hidden) |
| score legend | Moves into Source clips panel |

All zones live inside managed scroll/collapse regions (fixes the scroll/hide
bug). Collapse state is local UI state.

## Section 3 — Components (new)

- **`VersionPlayer`** — sequence player. Plays a version's `items` in order:
  load `item[i]` media (`buildVideoMediaUrl(projectId, file_id)`), seek to
  `start_sec`, play to `end_sec` at `playbackRate = speed`, apply
  `transform.scale` as a CSS transform, then **auto-advance** to `item[i+1]`
  (swap `src` + seek). Optional whole-sequence loop. Two presentations: compact
  (card) and focus (expanded). Reuses `ClipPreview` patterns; factor the
  per-item seek/clamp into a shared hook if it reduces duplication.
- **`VersionCard`** — poster/preview (compact `VersionPlayer`), title, vibe,
  `total_duration_sec`, rationale, **Use this version** button; click body →
  expand to focus.
- **`VersionGallery`** — the side-by-side row + the expand-to-focus state
  machine (one focused version at a time; others stay as a strip).
- **`WorkingTimelineStrip`** — read-mostly filmstrip of the adopted timeline
  items (thumbnail + duration + order). Keep the existing minimal reorder/remove
  buttons in this slice; full drag-handle editing is Roadmap SP-C.

## Section 4 — The mock agent

`proposeVersions(clips: ClipCandidate[]): Version[]` (frontend, e.g.
`state/mockVersions.ts`). Builds **2–4** versions from the project's **real**
candidate clips by slicing sub-ranges and varying order / speed / total
duration, with titles/vibes/rationale drawn from the profile set (e.g. a punchy
`short_social`, a slow `long_scenic`). Because it **fabricates its own
`VersionItem` ranges** from available source files, it is **not** blocked by the
sparse candidate pool. It satisfies the exact signature the real agent will
implement, so the later swap is local.

## Section 5 — Adopt ("Use this version")

New backend operation **`replace_timeline(items)`** in `timeline_ops.py`:
atomically replaces the timeline document's items with the given `VersionItem`
specs in **one undoable snapshot**, emits `timeline-changed` over SSE, and lands
in undo history (reuse the existing `controller.apply` snapshot path). The
frontend button calls
`applyTimelineOperation('replace_timeline', { items })`.

*Rejected alternative:* sequencing existing `remove_item` + `add_item` + `set_*`
ops client-side — messy undo granularity (N snapshots) and requires
round-tripping freshly created `item_id`s before `set_bounds`/`set_speed`/
`set_transform`. `replace_timeline` is the only backend touch in this slice;
small and well-scoped.

## Section 6 — Data flow

`proposeVersions(clips)` → `VersionGallery` renders cards → `VersionPlayer`
plays real media sequences → **Use this version** →
`replace_timeline(items)` → SSE reconcile in `ReviewContext` →
`WorkingTimelineStrip` reflects the adopted timeline. The chat stays in
propose-mode (the real `ReviewChatPanel`, just relocated) — unchanged this slice.

## Section 7 — Testing

- **Unit:** `proposeVersions` (returns 2–4 versions; item bounds within source
  durations; `total_duration_sec` consistent; deterministic given fixed input).
  `VersionPlayer` advance logic (mocked video element clock). `replace_timeline`
  (pytest alongside `timeline_ops` tests: clears + rebuilds; single undoable
  snapshot; emits change).
- **Component / e2e (Playwright, matching existing patterns):** gallery renders
  N cards; click expands to focus; **Use this version** updates the working
  strip.
- **Regression:** timeline strip and chat are both reachable/collapsible (guards
  the scroll/hide fix).

## Section 8 — Roadmap (deferred dependencies)

- **SP-A — Richer candidate pool (backend).** Emit an overlapping 3–10s
  candidate pool (relax `max_clips_per_scene` / non-overlap for the *pool*;
  optionally sub-segment long single scenes). Prerequisite for versions on real
  footage. Addresses the user's point 2 directly.
- **SP-B — Real creative agent (voice + powers).** Implement a
  `proposeVersions`-equivalent in `review_agent.py` with a creative voice and the
  power to propose scenarios/versions with rationale; replace raw-UUID proposal
  text with plain language.
- **SP-C — Drag-handle visual editing.** Replace the hidden numeric controls in
  `WorkingTimelineStrip` with drag trim handles, visual speed, and a zoom/reframe
  box, wired to existing `set_bounds`/`set_speed`/`set_transform`.

## Risks / open implementation details

- **Src-swap flash** between items of different source files: mitigate by
  preloading the next item or double-buffering two `<video>` elements. Player
  internal detail.
- **Mock variety with very few clips:** acceptable; it fabricates sub-ranges.
- **`replace_timeline` vs live-sync/undo:** must go through the existing
  controller snapshot path so undo/redo and SSE stay consistent (memory note:
  "additive live-sync only" — replace is a new, deliberate exception handled in
  one snapshot).
