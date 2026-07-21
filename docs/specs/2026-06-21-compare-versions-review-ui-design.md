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

Two annotations on a Review screenshot (2026-06-21): the timeline/clip area
felt unstructured ("random cards"; wanted well-displayed videos instead), and
the chat felt like it should read as a video-editor creative agent, not a
generic form. Plus a functional gap the user hit: a 50s source yields only
**one** suggested clip instead of several 3–10s options (root-caused below).

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

## The candidate-pool gap (context, not in this slice)

Why a 50s file yields ~one clip: `scene_detection.py` (PySceneDetect
`ContentDetector`) fires on hard visual cuts, and continuous drone footage has
none, so the whole file is one scene. `clip_assembly.py::assemble_smooth_clips`
then dedupes into a final cut (`max_clips_per_scene = 2`, non-overlap rule
deletes neighbours), netting ~1 clip. The new flow needs the opposite — a rich
pool of overlapping 3–10s candidate segments. This is a backend sub-project
(Roadmap SP-A) and a real prerequisite for versions on *real* footage, but it
does **not** block this slice: the mock fabricates its own item ranges.

## Version data contract (the seam)

The mock emits this shape; the real agent implements the **same** shape later,
so swapping the producer is a one-line change
(`frontend/src/renderer/src/types/version.ts`): a `Version` has `version_id`,
`title`, `vibe`, `rationale`, `profile` (`AssemblyProfile`),
`total_duration_sec`, and `items: VersionItem[]`; a `VersionItem` has
`source_clip_id`, `file_id`, `file_name`, `start_sec`, `end_sec`, `speed`, and
`transform: {scale, x, y}`. `VersionItem` mirrors the backend `TimelineItem`
**minus `item_id`** (versions aren't live yet) **plus** `file_id`/`file_name`
(so the player can resolve media without a separate lookup). When the real
agent lands, this type is mirrored in `backend/src/models.py`.

## Layout / information architecture

One scroll-managed shell replaced the stacked `Review.tsx` body: header (title
+ smoothness filter), a left chat spine, a side-by-side version compare
gallery (click-to-expand focus player) with a collapsible "Source clips" panel
below it, and a full-width collapsible working-timeline filmstrip at the
bottom. All zones live inside managed scroll/collapse regions (fixes the
scroll/hide bug); collapse state is local UI state.

## Components

`VersionPlayer` is the sequence player: plays a version's `items` in order
(load media, seek to `start_sec`, play to `end_sec` at `playbackRate = speed`,
apply `transform.scale`, auto-advance to the next item), with compact (card)
and focus (expanded) presentations. `VersionCard` wraps it with poster/preview,
title, vibe, `total_duration_sec`, rationale, and a **Use this version** button;
click body → expand to focus. `VersionGallery` is the side-by-side row plus the
expand-to-focus state machine (one focused version at a time). `WorkingTimelineStrip`
is a read-mostly filmstrip of the adopted timeline items, with minimal
reorder/remove buttons in this slice — full drag-handle editing is Roadmap SP-C.

## The mock agent

`proposeVersions(clips: ClipCandidate[]): Version[]` builds **2–4** versions
from the project's **real** candidate clips by slicing sub-ranges and varying
order/speed/total duration, with titles/vibes/rationale drawn from the profile
set. Because it fabricates its own `VersionItem` ranges, it is **not** blocked
by the sparse candidate pool, and it satisfies the signature the real agent
will implement later.

## Adopt ("Use this version")

New backend operation **`replace_timeline(items)`** in `timeline_ops.py`:
atomically replaces the timeline document's items with the given `VersionItem`
specs in **one undoable snapshot**, emits `timeline-changed` over SSE, and lands
in undo history (reuses the existing controller snapshot path).

*Rejected alternative:* sequencing existing `remove_item` + `add_item` + `set_*`
ops client-side — messy undo granularity (N snapshots) and requires
round-tripping freshly created `item_id`s. `replace_timeline` is the only
backend touch in this slice.

## Data flow

`proposeVersions(clips)` → `VersionGallery` renders cards → `VersionPlayer`
plays real media sequences → **Use this version** → `replace_timeline(items)`
→ SSE reconcile in `ReviewContext` → `WorkingTimelineStrip` reflects the
adopted timeline. The chat stays in propose-mode (relocated, unchanged this
slice).

## Roadmap (deferred dependencies)

- **SP-A — Richer candidate pool (backend).** Emit an overlapping 3–10s
  candidate pool; prerequisite for versions on real footage.
- **SP-B — Real creative agent (voice + powers).** Implement a
  `proposeVersions`-equivalent in `review_agent.py`.
- **SP-C — Drag-handle visual editing.** Replace the hidden numeric controls in
  `WorkingTimelineStrip` with drag trim handles, visual speed, and a
  zoom/reframe box.

## Risks / open implementation details

- **Src-swap flash** between items of different source files: mitigate by
  preloading the next item or double-buffering two `<video>` elements.
- **`replace_timeline` vs live-sync/undo:** must go through the existing
  controller snapshot path so undo/redo and SSE stay consistent (additive
  live-sync is otherwise the rule; replace is a deliberate, one-snapshot
  exception).
