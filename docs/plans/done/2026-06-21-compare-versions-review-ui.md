# Compare-Versions Review UI — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax. Read the whole phase before
> starting it; honour each phase's **Verify** gate and the **STOP conditions**.
> Update the status row in `docs/plans/README.md` when a phase lands. The design
> spec is the behavioural source of truth:
> [`docs/specs/2026-06-21-compare-versions-review-ui-design.md`](../../specs/2026-06-21-compare-versions-review-ui-design.md).
>
> **Drift check (run first):**
> `git diff --stat 2d0f918..HEAD -- backend/src/timeline_ops.py backend/src/api.py frontend/src/renderer/src/components/Timeline.tsx frontend/src/renderer/src/components/ClipPreview.tsx frontend/src/renderer/src/routes/Review.tsx frontend/src/renderer/src/state/ReviewContext.tsx`
> If any in-scope file changed since `2d0f918`, re-verify the "Current state"
> excerpts against live code before editing; on a structural mismatch, STOP.

## Status

- **Status**: DONE (2026-06-21)
- **Priority**: P1 (acts on direct user feedback on the Review screen)
- **Effort**: L (phased; Phases 1–2 independently shippable; Phase 5 is the heavy one)
- **Risk**: LOW (1 backend op, 2 types/mock), MEDIUM (3 — shared player + Timeline
  migration), MEDIUM-HIGH (5 — Review.tsx layout rebuild)
- **Depends on**: none to start
- **Category**: product + frontend architecture
- **Planned at**: commit `2d0f918`, 2026-06-21
- **Spec**: `docs/specs/2026-06-21-compare-versions-review-ui-design.md`

## Why this matters

Two annotations on the Review screenshot (2026-06-21): the layout is "not well
structured … I don't like field boxes and random cards. I want well displayed
videos so I can better see what agent suggests are good parts," and "I like this
chat component but it would be nicer if agent would be like a video editor
creative agent." Plus a functional gap: a 50s source yields ~one suggested clip.

This plan delivers **sub-project 1**: a video-forward Review where the user
**compares several complete candidate cuts ("versions")** side-by-side and adopts
one. The agent is mocked here (real creative agent = SP-B); versions use the
**preview-spec** model (build-recipe → client-side sequence playback → "Use this"
replays into the one live timeline).

## Prefactors included (and why)

The user asked to fold in pre-refactors that improve overall app state. Included,
each justified by this slice:

1. **Extract a shared `useSequencePlayer` hook** (Phase 3). `VersionPlayer` needs
   exactly the proven video-driven sequence engine that already lives — tangled
   with NLE chrome — in `Timeline.tsx` (built by plan 004 to kill drift/stutter).
   We extract it once and **migrate `Timeline.tsx` onto it** so there is a single
   playback engine, not a second copy. Migration is **e2e-gated with a rollback**
   (STOP conditions) so it can never endanger shipped Timeline playback.
2. **Decompose `Review.tsx` (396-line god component) into focused zone
   components** (Phase 5). We're rebuilding its layout anyway; this directly
   retires the `react-doctor` "giant-component" debt tracked in
   `docs/plans/react-doctor-triage.md`.
3. **Source-clips panel collapsed by default** (Phase 5). Demoting the `ClipCard`
   grid into a collapsed panel means the Review route stops mounting **N × 4K
   `<video>` elements** by default — the deferred jank source recorded in
   `docs/plans/README.md` "Dependency notes". A real perf win for free.

Explicitly **not** refactored (out of scope, would add risk without serving this
slice): `ReviewContext` internals (healthy; we only call its existing
`applyTimelineOperation`), `styles.css` split, the export engine, the scoring
pipeline.

## Build order

1. **Backend `replace_timeline` op** (TDD, pytest). Foundational for adopt.
2. **Frontend `Version` types + mock `proposeVersions`** (pure).
3. **Prefactor: `useSequencePlayer` + additive `ClipPreview` props + migrate `Timeline.tsx`** (e2e-gated).
4. **Version UI components** (`VersionPlayer`, `VersionCard`, `VersionGallery`).
5. **New Review shell** (3-zone layout, relocate chat, demote ClipCards, adopt wiring, working strip).
6. **Docs + final gate.**

Phases 1, 2, 4 are low risk and independently green. Phase 3's hook is required by
4; Phase 3's Timeline migration is the gated prefactor. Phase 5 composes
everything.

## Current state (read before editing)

- `backend/src/timeline_ops.py` (325 lines) — the ops core. `OPERATIONS: Dict[str, Callable]`
  (line 208) maps names → pure handlers `(_handler(doc, sources, *, **args) -> TimelineDocument)`.
  `apply_operation` (line 224) deep-copies then dispatches. `TimelineController.apply`
  (line 295) snapshots for undo + `_notify()` (persistence + SSE) under a per-project lock.
  Helpers: `_require_source(sources, clip_id)` (line 62, raises `TimelineOpError`),
  `_new_item_id()` (line 51). `_set_bounds` (line 119) shows the clamp pattern:
  `max(0.0, start)` / `min(source.source_duration_sec, end)`.
- `backend/src/models.py` — `TimelineItem(item_id, source_clip_id, start_sec, end_sec, speed=1.0, transform)`,
  `Transform(scale, x, y)`, `TimelineDocument(items, profile, target_duration_sec, version, decisions)`.
- `backend/src/api.py` — generic op endpoint `POST /projects/{id}/timeline/op` (line 874)
  → `controller.apply(request.operation, **request.args)`. **`replace_timeline` needs no
  new route or client function** once registered in `OPERATIONS`. `build_timeline_sources`
  (line 787) builds the `Sources` map (each `SourceClip` carries `source_duration_sec`).
- `frontend/src/renderer/src/components/Timeline.tsx` (704 lines) — the NLE route. The
  **reusable engine** to extract: `seek` state `{time,epoch}` (line 70), `currentIndex`
  (line 69), `onPlaybackTime` segment-advance (lines 201–233), `advanceLockRef` (line 89),
  `jumpTo` (line 172). The **Timeline-only** chrome to keep: reverse-scrub RAF (237–267),
  `scrub`/`startScrub` (365–398), wheel-zoom (400–414), ruler/track/trim/drag JSX.
- `frontend/src/renderer/src/components/ClipPreview.tsx` (149 lines) — shared `<video>`.
  Already additive-prop friendly: `seek?: {time,epoch}` + `onPlaybackTime?` command path
  (lines 63–101). Has **no** `playbackRate`/`scale` props yet. **Any new prop MUST be
  optional with a default that leaves `ClipCard` + `Timeline` behaviour byte-identical.**
- `frontend/src/renderer/src/routes/Review.tsx` (396 lines) — god component: ranking,
  `draft-setup`, `accepted-strip` + inline `TrimEditor`, `review-grid` of `ClipCard`s, then
  mounts `<TimelineEditor/>` and `<ReviewChatPanel/>` **as siblings after `.page-body`** →
  the scroll/hide bug.
- `frontend/src/renderer/src/state/ReviewContext.tsx` (552 lines) — exposes
  `applyTimelineOperation(operation, args)` (line 143) which POSTs `/timeline/op` and
  reconciles. **The gallery calls this directly for adopt — no context change needed.**
- `frontend/src/renderer/src/api/client.ts` — `applyTimelineOp(projectId, operation, args)`
  (line 449), `buildVideoMediaUrl(projectId, fileId)` (line 40), `TimelineItem` (424),
  `TimelineDocument` (433).
- `styles.css` (~1432 lines) — plain CSS classes (no Tailwind utilities in components).
  Existing: `.page/.page-body` (256/286, the overflow split), `.review-grid` (505),
  `.timeline-editor*` (1418+), `.review-chat*` (1369+).
- **Frontend test surface = Playwright e2e only** (`frontend/e2e/`); there is **no**
  vitest/jest runner (per plan 004). Do **not** add one. Backend = pytest.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Backend tests | `cd frontend && npm run test:backend` (or `backend/.venv/bin/pytest backend/tests/test_timeline_ops.py -q`) | pass |
| Typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Build | `cd frontend && npm run build` | exit 0 |
| E2E (starts its own servers; needs backend venv + ffmpeg) | `cd frontend && npm run test:e2e` | pass |

Run the baseline (`npm run test:e2e` + `npm run test:backend`) on a clean branch
point **before any edit**. If either fails pre-change, STOP.

## Scope

**In:** `replace_timeline` op + tests; `types/version.ts`; `state/mockVersions.ts`;
`components/useSequencePlayer.ts`; additive `ClipPreview` props; `Timeline.tsx`
migration (gated); `VersionPlayer/VersionCard/VersionGallery`; the new Review shell
(`Review.tsx` + new zone components); `WorkingTimelineStrip`; `SourceClipsPanel`;
relocating `ReviewChatPanel`; CSS; e2e; docs.

**Out (separate plans):** richer candidate pool (SP-A); real creative agent + clean
proposal text (SP-B); drag-handle editing in the working strip (SP-C, numeric fields
stay hidden here); `ReviewContext` internal refactor; `styles.css` split.

## Git workflow

- Branch already in use: `feature/clip-quality-review-ux` (continue on it, or branch
  `feature/compare-versions-ui` if the operator prefers isolation).
- Conventional commits per task (`feat(review): …`, `test(timeline-ops): …`, `refactor(timeline): …`).
- Do **not** push or open a PR unless the operator says so.

---

## Phase 1 — Backend: `replace_timeline` operation

**Goal:** One atomic, undoable op that replaces the document's items with a list of
version-item specs. **Guardrail:** pure handler like its neighbours; validation
before mutation; one `controller.apply` snapshot.

### Task 1.1 — Failing tests for `replace_timeline`

**Files:** Test: `backend/tests/test_timeline_ops.py`

**Interfaces — Produces:** operation name `"replace_timeline"`, args
`items: list[dict]` where each dict is
`{source_clip_id, start_sec, end_sec, speed?, transform?}`; returns a
`TimelineDocument` whose `items` are fresh `TimelineItem`s (new `item_id`s) in order.

- [ ] **Step 1: Write the failing tests.** Append to `test_timeline_ops.py` (reuse
  the file's existing `make_document` / `make_sources` helpers — match their
  signatures; the excerpt below assumes a `sources` map with one clip `"c1"` of
  `source_duration_sec=10.0` and a doc seeded with one unrelated item):

```python
def test_replace_timeline_swaps_all_items():
    sources = {"c1": SourceClip(clip_id="c1", start_sec=0.0, end_sec=10.0, source_duration_sec=10.0)}
    doc = TimelineDocument(items=[TimelineItem(item_id="old", source_clip_id="c1", start_sec=0.0, end_sec=2.0)])
    result = apply_operation(
        doc, sources, "replace_timeline",
        items=[
            {"source_clip_id": "c1", "start_sec": 1.0, "end_sec": 3.0, "speed": 2.0},
            {"source_clip_id": "c1", "start_sec": 4.0, "end_sec": 5.0},
        ],
    )
    assert [i.source_clip_id for i in result.items] == ["c1", "c1"]
    assert result.items[0].start_sec == 1.0 and result.items[0].end_sec == 3.0
    assert result.items[0].speed == 2.0
    assert result.items[1].speed == 1.0                      # default
    assert result.items[0].item_id != "old"                  # fresh ids
    assert len({i.item_id for i in result.items}) == 2       # unique
    assert doc.items[0].item_id == "old"                     # input untouched


def test_replace_timeline_clamps_bounds_to_source():
    sources = {"c1": SourceClip(clip_id="c1", start_sec=0.0, end_sec=10.0, source_duration_sec=10.0)}
    doc = TimelineDocument(items=[])
    result = apply_operation(doc, sources, "replace_timeline",
        items=[{"source_clip_id": "c1", "start_sec": -5.0, "end_sec": 99.0}])
    assert result.items[0].start_sec == 0.0 and result.items[0].end_sec == 10.0


def test_replace_timeline_unknown_source_raises():
    doc = TimelineDocument(items=[])
    with pytest.raises(TimelineOpError):
        apply_operation(doc, {}, "replace_timeline",
            items=[{"source_clip_id": "missing", "start_sec": 0.0, "end_sec": 1.0}])


def test_replace_timeline_empty_clears():
    doc = TimelineDocument(items=[TimelineItem(item_id="old", source_clip_id="c1", start_sec=0.0, end_sec=2.0)])
    result = apply_operation(doc, {}, "replace_timeline", items=[])
    assert result.items == []
```

- [ ] **Step 2: Run to verify they fail.** Run:
  `backend/.venv/bin/pytest backend/tests/test_timeline_ops.py -k replace_timeline -q`
  Expected: FAIL — `unknown operation: replace_timeline`.

### Task 1.2 — Implement `_replace_timeline` + register

**Files:** Modify `backend/src/timeline_ops.py`

- [ ] **Step 3: Add the handler** (place after `_set_target_duration`, before the
  `OPERATIONS` dict). Mirror the existing clamp/validate style:

```python
def _replace_timeline(doc: TimelineDocument, sources: Sources, *, items: List[dict]) -> TimelineDocument:
    """Replace every timeline item with a fresh build-recipe (used to adopt a Version).

    Each spec: {source_clip_id, start_sec, end_sec, speed?, transform?}. Validates the
    source exists and clamps bounds to [0, source_duration] (same rule as set_bounds),
    so a bad recipe is rejected before any mutation.
    """
    rebuilt: List[TimelineItem] = []
    for spec in items:
        source = _require_source(sources, spec["source_clip_id"])
        start = max(0.0, float(spec["start_sec"]))
        end = min(source.source_duration_sec, float(spec["end_sec"]))
        if end <= start:
            raise TimelineOpError(
                f"item bounds [{spec['start_sec']}, {spec['end_sec']}] clamp to an empty "
                f"span within [0, {source.source_duration_sec}]"
            )
        speed = float(spec.get("speed", 1.0))
        if speed <= 0:
            raise TimelineOpError("speed must be > 0")
        transform = spec.get("transform")
        try:
            resolved = Transform.model_validate(transform) if transform is not None else Transform()
        except Exception as exc:
            raise TimelineOpError(f"invalid transform: {exc}") from exc
        rebuilt.append(TimelineItem(
            item_id=_new_item_id(),
            source_clip_id=spec["source_clip_id"],
            start_sec=start, end_sec=end, speed=speed, transform=resolved,
        ))
    doc.items = rebuilt
    return doc
```

- [ ] **Step 4: Register** in the `OPERATIONS` dict (line ~208), after `"set_target_duration"`:

```python
    "set_target_duration": _set_target_duration,
    "replace_timeline": _replace_timeline,
}
```

- [ ] **Step 5: Run unit tests to verify they pass.** Run:
  `backend/.venv/bin/pytest backend/tests/test_timeline_ops.py -k replace_timeline -q`
  Expected: 4 passed.

### Task 1.3 — Undo is a single snapshot (controller-level test)

**Files:** Modify `backend/tests/test_timeline_ops.py`

- [ ] **Step 6: Add a controller test** (reuse the file's existing async-controller
  pattern — find a test that builds a `TimelineController` and copy its setup):

```python
@pytest.mark.asyncio
async def test_replace_timeline_is_one_undoable_step():
    sources = {"c1": SourceClip(clip_id="c1", start_sec=0.0, end_sec=10.0, source_duration_sec=10.0)}
    doc = TimelineDocument(items=[TimelineItem(item_id="old", source_clip_id="c1", start_sec=0.0, end_sec=2.0)])
    controller = TimelineController(doc, sources)
    await controller.apply("replace_timeline", items=[
        {"source_clip_id": "c1", "start_sec": 1.0, "end_sec": 3.0},
        {"source_clip_id": "c1", "start_sec": 4.0, "end_sec": 6.0},
    ])
    assert len(controller.document.items) == 2
    reverted = await controller.undo()
    assert [i.item_id for i in reverted.items] == ["old"]   # one undo restores the prior timeline
```

- [ ] **Step 7: Run + full ops suite.** Run:
  `backend/.venv/bin/pytest backend/tests/test_timeline_ops.py -q` → all pass.
- [ ] **Step 8: Commit.**

```bash
git add backend/src/timeline_ops.py backend/tests/test_timeline_ops.py
git commit -m "feat(timeline-ops): replace_timeline op for adopting a full version"
```

**Phase 1 Verify:** `npm run test:backend` green.

---

## Phase 2 — Frontend: `Version` types + mock `proposeVersions`

**Goal:** The `Version` contract (the seam the mock fills now, the real agent fills
later) and a deterministic mock that builds varied versions from real candidate clips.

### Task 2.1 — `Version` types

**Files:** Create `frontend/src/renderer/src/types/version.ts`

**Interfaces — Produces:** `VersionItem`, `Version`.

- [ ] **Step 1: Write the file:**

```ts
import type { AssemblyProfile } from './clip';

/** One placement in a proposed cut — a build-recipe entry, not a live TimelineItem
 *  (no item_id yet). Carries file_id/file_name so the sequence player can resolve
 *  media without a separate lookup. */
export interface VersionItem {
  source_clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  speed: number;
  transform: { scale: number; x: number; y: number };
}

/** A complete alternative cut the user can preview and adopt. */
export interface Version {
  version_id: string;
  title: string;
  vibe: string;
  rationale: string;
  profile: AssemblyProfile;
  total_duration_sec: number;
  items: VersionItem[];
}
```

- [ ] **Step 2: Typecheck.** Run `cd frontend && npm run typecheck` → exit 0.

### Task 2.2 — Deterministic mock `proposeVersions`

**Files:** Create `frontend/src/renderer/src/state/mockVersions.ts`

**Interfaces — Consumes:** `ClipCandidate` (`types/clip`). **Produces:**
`proposeVersions(clips: ClipCandidate[]): Version[]`.

- [ ] **Step 3: Write the mock.** Deterministic (no `Math.random`): 3 fixed recipes,
  sub-slicing real clips so previews play real media even with a sparse pool.

```ts
import type { ClipCandidate } from '../types/clip';
import type { Version, VersionItem } from '../types/version';

const IDENTITY = { scale: 1, x: 0, y: 0 };

// Each recipe: how many clips, the per-item target length, speed, and copy.
const RECIPES = [
  { id: 'v-social', title: 'Punchy Social Cut', vibe: 'fast & upbeat',
    profile: 'short_social' as const, count: 4, seg: 3, speed: 1,
    rationale: 'Quick 3s hits for a vertical-friendly social edit.' },
  { id: 'v-cinematic', title: 'Cinematic Highlight', vibe: 'slow & sweeping',
    profile: 'cinematic_highlight' as const, count: 3, seg: 6, speed: 0.5,
    rationale: 'Fewer, longer beats at half-speed for a cinematic feel.' },
  { id: 'v-scenic', title: 'Long Scenic', vibe: 'relaxed & wide',
    profile: 'long_scenic' as const, count: 5, seg: 6, speed: 1,
    rationale: 'A longer establishing montage that lets each location breathe.' },
];

/** Build an item from a clip, taking a `seg`-second window from `offset` inside the
 *  clip's own range (clamped so it never leaves the candidate bounds). */
function sliceItem(clip: ClipCandidate, offset: number, seg: number, speed: number): VersionItem {
  const start = Math.min(clip.start_sec + offset, Math.max(clip.start_sec, clip.end_sec - 1));
  const end = Math.min(start + seg, clip.end_sec);
  return {
    source_clip_id: clip.clip_id, file_id: clip.file_id, file_name: clip.file_name,
    start_sec: Number(start.toFixed(2)), end_sec: Number(Math.max(start + 0.5, end).toFixed(2)),
    speed, transform: { ...IDENTITY },
  };
}

export function proposeVersions(clips: ClipCandidate[]): Version[] {
  if (clips.length === 0) return [];
  const ranked = [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
  return RECIPES.map((r) => {
    const items: VersionItem[] = [];
    for (let n = 0; n < r.count; n += 1) {
      const clip = ranked[n % ranked.length];           // reuse clips if pool is sparse
      const offset = Math.floor(n / ranked.length) * r.seg; // later passes slice deeper in
      items.push(sliceItem(clip, offset, r.seg, r.speed));
    }
    const total = items.reduce((s, it) => s + (it.end_sec - it.start_sec) / it.speed, 0);
    return {
      version_id: r.id, title: r.title, vibe: r.vibe, rationale: r.rationale,
      profile: r.profile, total_duration_sec: Number(total.toFixed(1)), items,
    };
  });
}
```

- [ ] **Step 4: Typecheck** → exit 0. **Step 5: Commit.**

```bash
git add frontend/src/renderer/src/types/version.ts frontend/src/renderer/src/state/mockVersions.ts
git commit -m "feat(review): Version contract + deterministic mock proposeVersions"
```

**Phase 2 Verify:** `npm run typecheck` exit 0.

---

## Phase 3 — Prefactor: shared `useSequencePlayer` + Timeline migration

**Goal:** One video-driven sequence engine, reused by `VersionPlayer` (Phase 4) and
`Timeline.tsx`. **Guardrail:** `ClipPreview` prop additions are additive with
behaviour-preserving defaults; the Timeline migration must keep the existing
Playwright sequence-playback spec green.

### Task 3.1 — Additive `ClipPreview` props: `playbackRate`, `scale`

**Files:** Modify `frontend/src/renderer/src/components/ClipPreview.tsx`

**Interfaces — Produces:** `ClipPreviewProps.playbackRate?: number` (default 1),
`ClipPreviewProps.scale?: number` (default 1).

- [ ] **Step 1: Add props to the interface** (after `onPlaybackTime`):

```ts
  /** Source playback speed; sets video.playbackRate. Default 1. */
  playbackRate?: number;
  /** Digital zoom; CSS-scales the rendered video. Default 1 (no zoom). */
  scale?: number;
```

- [ ] **Step 2: Apply `playbackRate`** — add an effect (next to the `playing` effect):

```ts
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate ?? 1;
  }, [mediaUrl, playbackRate]);
```

- [ ] **Step 3: Apply `scale`** on the `<video>` via inline style (identity by
  default so ClipCard/Timeline are unchanged):
  `style={{ transform: scale && scale !== 1 ? `scale(${scale})` : undefined }}`.
  Destructure `playbackRate` and `scale` in the props param list.

- [ ] **Step 4: Verify behaviour preserved.** Run `npm run typecheck` (exit 0) and
  `npm run test:e2e` (ClipCard + Timeline previews unchanged → existing specs green).
- [ ] **Step 5: Commit** (`feat(clip-preview): additive playbackRate + scale props`).

### Task 3.2 — Create `useSequencePlayer`

**Files:** Create `frontend/src/renderer/src/components/useSequencePlayer.ts`

**Interfaces — Consumes:** `buildVideoMediaUrl`. **Produces:**

```ts
export interface SequenceSegment { file_id: string; start_sec: number; end_sec: number; speed?: number }
export interface UseSequencePlayerArgs {
  projectId: string | null;
  segments: SequenceSegment[];
  loop?: boolean;
  onProgress?: (index: number, sourceTimeSec: number) => void; // Timeline paints its playhead here
}
export interface SequencePreviewProps {
  mediaUrl: string | undefined; startSec: number; endSec: number;
  playing: boolean; loop: false; controls: false;
  seek: { time: number; epoch: number };
  onPlaybackTime: (sourceTimeSec: number) => void; playbackRate: number;
}
export interface UseSequencePlayerResult {
  playing: boolean; currentIndex: number;
  play: () => void; stop: () => void; toggle: () => void;
  seekTo: (index: number, sourceTimeSec: number) => void;
  previewProps: SequencePreviewProps;
}
```

- [ ] **Step 6: Implement** by lifting the forward-advance engine from `Timeline.tsx`
  (lines 69–233): `currentIndex` + `seek` state, `advanceLockRef`, the
  `onPlaybackTime` boundary→advance logic, generalised with `speed`, `loop`, and an
  `onProgress` callback. Full implementation:

```ts
import { useCallback, useMemo, useRef, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type { SequenceSegment, UseSequencePlayerArgs, UseSequencePlayerResult } from './useSequencePlayer.types';

const SEGMENT_END_EPSILON = 0.05;

export function useSequencePlayer(
  { projectId, segments, loop = false, onProgress }: UseSequencePlayerArgs,
): UseSequencePlayerResult {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [seek, setSeek] = useState<{ time: number; epoch: number }>({ time: 0, epoch: 0 });
  const advanceLockRef = useRef(false);
  const segmentsRef = useRef<SequenceSegment[]>(segments);
  segmentsRef.current = segments;

  const seekTo = useCallback((index: number, sourceTimeSec: number) => {
    advanceLockRef.current = false;
    setCurrentIndex(index);
    setSeek((prev) => ({ time: sourceTimeSec, epoch: prev.epoch + 1 }));
  }, []);

  const onPlaybackTime = useCallback((sourceTimeSec: number) => {
    const segs = segmentsRef.current;
    const seg = segs[currentIndex];
    if (!seg) return;
    if (sourceTimeSec >= seg.end_sec - SEGMENT_END_EPSILON) {
      if (advanceLockRef.current) return;
      advanceLockRef.current = true;
      const next = currentIndex + 1;
      if (next >= segs.length) {
        if (loop && segs.length > 0) { seekTo(0, segs[0].start_sec); return; }
        setPlaying(false); return;
      }
      seekTo(next, segs[next].start_sec);
      return;
    }
    advanceLockRef.current = false;
    onProgress?.(currentIndex, sourceTimeSec);
  }, [currentIndex, loop, onProgress, seekTo]);

  const play = useCallback(() => {
    const segs = segmentsRef.current;
    if (segs.length === 0) return;
    // Restart from the top if we stopped at the end.
    setCurrentIndex((idx) => (idx >= segs.length ? 0 : idx));
    setPlaying(true);
  }, []);
  const stop = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? stop() : play()), [playing, play, stop]);

  const seg = segments[currentIndex];
  const previewProps = useMemo<UseSequencePlayerResult['previewProps']>(() => ({
    mediaUrl: projectId && seg ? buildVideoMediaUrl(projectId, seg.file_id) : undefined,
    startSec: seg?.start_sec ?? 0, endSec: seg?.end_sec ?? 0,
    playing, loop: false, controls: false, seek,
    onPlaybackTime, playbackRate: seg?.speed ?? 1,
  }), [projectId, seg, playing, seek, onPlaybackTime]);

  return { playing, currentIndex, play, stop, toggle, seekTo, previewProps };
}
```

  (Put the shared interfaces in a sibling `useSequencePlayer.types.ts` so both the
  hook and consumers import them without a circular dependency.)

- [ ] **Step 7: Typecheck** → exit 0. **Step 8: Commit**
  (`feat(player): useSequencePlayer shared forward-sequence engine`).

### Task 3.3 — Migrate `Timeline.tsx` onto the hook (GATED PREFACTOR)

**Files:** Modify `frontend/src/renderer/src/components/Timeline.tsx`

- [ ] **Step 9: Baseline.** Run `npm run test:e2e` and confirm the sequence-playback
  spec (`frontend/e2e/playwriter-preview.spec.ts` or `timeline-playback.spec.ts`) is
  green at the current commit. If not, STOP.
- [ ] **Step 10: Replace** Timeline's `seek`/`currentIndex`/`onPlaybackTime`/advance
  block (lines 69–233) with `useSequencePlayer({ projectId, segments: segments.map(s => ({file_id:s.clip.file_id, start_sec:s.trimStart, end_sec:s.trimEnd})), onProgress })`.
  Keep Timeline-only chrome **unchanged**: reverse-scrub RAF (237–267), `scrub`/
  `startScrub`, wheel-zoom, ruler/track/trim/drag JSX, `previewHeight`. Wire:
  - transport play/stop/reverse buttons → `play()`/`stop()` (reverse stays its own RAF);
  - `jumpTo(timelineSec)` → compute `(index, sourceTime)` then `seekTo(index, sourceTime)` + paint;
  - `onProgress(index, sourceTimeSec)` → the existing `paintPlayhead(seg.offset + (sourceTimeSec - seg.trimStart))` ref-paint + throttled `setPlayhead`;
  - spread `previewProps` onto the Timeline `<ClipPreview>` (replacing the hand-wired `seek`/`onPlaybackTime`/`controls`/`playing`).
- [ ] **Step 11: Verify — the gate.** Run `npm run typecheck` (0), `npm run build`
  (0), `npm run test:e2e` (**all green, incl. boundary-advance + zero-`seeking`
  specs**). Manual smoke (`npm run dev:with-backend`): play crosses a boundary; J/K/L
  + scrub still work.
- [ ] **Step 12: Commit** (`refactor(timeline): drive playback via useSequencePlayer`).

**Phase 3 Verify:** typecheck + build + full e2e green.

**STOP / rollback for Task 3.3:** If Timeline's reverse-scrub or `jumpTo` cannot be
expressed via `seekTo`/`onProgress` without contorting the hook, **or** any
sequence-playback e2e regresses and isn't green within one fix attempt: **revert the
Timeline.tsx change** (`git checkout -- frontend/src/renderer/src/components/Timeline.tsx`),
keep Tasks 3.1–3.2 (the hook still serves Phase 4), and record a follow-up
"migrate Timeline to useSequencePlayer" in `docs/plans/README.md` Dependency notes.
The feature does not depend on this task.

---

## Phase 4 — Version UI components

**Goal:** `VersionPlayer` (sequence preview), `VersionCard` (one cut), `VersionGallery`
(side-by-side + expand-to-focus). Presentational; fed by props; no Review wiring yet.
**Guardrail:** match existing className conventions in `styles.css`; add `data-testid`
hooks for e2e.

### Task 4.1 — `VersionPlayer`

**Files:** Create `frontend/src/renderer/src/components/VersionPlayer.tsx`

**Interfaces — Consumes:** `useSequencePlayer`, `ClipPreview`, `Version`.
**Produces:** `<VersionPlayer version projectId expanded testId />`.

- [ ] **Step 1: Implement.** Map the version's items to segments; render `<ClipPreview>`
  with `{...previewProps}` plus the current item's `scale`; a play/pause button; loop on.

```tsx
import { useMemo } from 'react';
import { useSequencePlayer } from './useSequencePlayer';
import { ClipPreview } from './ClipPreview';
import type { Version } from '../types/version';

export function VersionPlayer(
  { version, projectId, expanded = false, testId }:
  { version: Version; projectId: string | null; expanded?: boolean; testId: string },
) {
  const segments = useMemo(
    () => version.items.map((it) => ({ file_id: it.file_id, start_sec: it.start_sec, end_sec: it.end_sec, speed: it.speed })),
    [version.items],
  );
  const player = useSequencePlayer({ projectId, segments, loop: true });
  const scale = version.items[player.currentIndex]?.transform.scale ?? 1;
  return (
    <div className={`version-player${expanded ? ' expanded' : ''}`} data-testid={testId}>
      <ClipPreview {...player.previewProps} scale={scale}
        label={version.title} testId={`${testId}-video`} />
      <button type="button" className="version-player-play"
        onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
        {player.playing ? '❚❚' : '▶'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** → 0. **Step 3: Commit** (`feat(review): VersionPlayer sequence preview`).

### Task 4.2 — `VersionCard` + `VersionGallery`

**Files:** Create `frontend/src/renderer/src/components/VersionCard.tsx`,
`frontend/src/renderer/src/components/VersionGallery.tsx`

**Interfaces — Produces:**
`<VersionCard version projectId expanded onExpand onAdopt />`;
`<VersionGallery versions projectId onAdopt />` (owns the single-focus state).

- [ ] **Step 4: `VersionCard`** — `VersionPlayer` + title, `vibe`, `total_duration_sec`,
  `rationale`, and a **Use this version** button (`data-testid="version-adopt"`).
  Clicking the card body (not the button) calls `onExpand(version.version_id)`.

```tsx
export function VersionCard(
  { version, projectId, expanded, onExpand, onAdopt }:
  { version: Version; projectId: string | null; expanded: boolean;
    onExpand: (id: string) => void; onAdopt: (v: Version) => void },
) {
  return (
    <div className={`version-card${expanded ? ' expanded' : ''}`} data-testid="version-card">
      <button type="button" className="version-card-surface" onClick={() => onExpand(version.version_id)}>
        <VersionPlayer version={version} projectId={projectId} expanded={expanded}
          testId={`version-player-${version.version_id}`} />
      </button>
      <div className="version-card-body">
        <strong>{version.title}</strong>
        <span className="version-vibe">{version.vibe} · {version.total_duration_sec}s</span>
        <p className="version-rationale">{version.rationale}</p>
        <button type="button" className="btn primary" data-testid="version-adopt"
          onClick={() => onAdopt(version)}>Use this version</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `VersionGallery`** — owns `expandedId` state; lays cards side-by-side
  (`.version-gallery`); the expanded card gets the `expanded` flag.

```tsx
export function VersionGallery(
  { versions, projectId, onAdopt }:
  { versions: Version[]; projectId: string | null; onAdopt: (v: Version) => void },
) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (versions.length === 0) return <p className="draft-summary">No versions yet — ask the agent for cuts.</p>;
  return (
    <div className={`version-gallery${expandedId ? ' has-focus' : ''}`} data-testid="version-gallery">
      {versions.map((v) => (
        <VersionCard key={v.version_id} version={v} projectId={projectId}
          expanded={expandedId === v.version_id}
          onExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onAdopt={onAdopt} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: CSS** in `styles.css` — `.version-gallery` (flex row, gap, wrap;
  `.has-focus` lets the `.expanded` card grow, e.g. `flex: 2`), `.version-card`,
  `.version-card-surface` (unstyled button reset), `.version-player`/`.expanded`
  (aspect-ratio box), `.version-vibe`/`.version-rationale`. Follow existing token
  variables (`var(--text-muted)` etc.).
- [ ] **Step 7: Typecheck + build** → 0. **Step 8: Commit**
  (`feat(review): VersionCard + VersionGallery with expand-to-focus`).

**Phase 4 Verify:** typecheck + build green.

---

## Phase 5 — New Review shell (layout rebuild + adopt wiring)

**Goal:** Replace `Review.tsx`'s stacked body with a 3-zone shell (chat spine ·
gallery+source-clips · collapsible working strip), fixing the scroll/hide bug; wire
adopt; demote ClipCards (collapsed). **Guardrail:** every zone inside a managed
scroll/collapse region; numeric editing fields stay hidden (SP-C).

### Task 5.1 — `WorkingTimelineStrip`

**Files:** Create `frontend/src/renderer/src/components/WorkingTimelineStrip.tsx`

- [ ] **Step 1:** Read-mostly filmstrip from `useReview().timelineItems` (thumbnail =
  `VersionPlayer`-free static; show `file_name`, effective duration `(end-start)/speed`,
  order). Keep minimal reorder (`↑`/`↓` via `applyTimelineOperation('reorder', …)`)
  and remove (`✕` via `remove_item`) buttons — **no numeric inputs** (SP-C). Wrap in a
  `<details>`/collapse with `data-testid="working-timeline-strip"`. Map `item_id` from
  `timelineItems` for ops.
- [ ] **Step 2: Typecheck** → 0.

### Task 5.2 — `SourceClipsPanel` (collapsed by default)

**Files:** Create `frontend/src/renderer/src/components/SourceClipsPanel.tsx`

- [ ] **Step 3:** Move the existing `review-grid` of `<ClipCard>` (Review.tsx lines
  360–390) into a `<details>` (closed by default) titled "Source clips ({n})",
  `data-testid="source-clips-panel"`. **Because it's closed, the `ClipCard` `<video>`
  elements don't mount until expanded** — this is the N×4K-jank fix; note it in a code
  comment. Keep the smoothness filter + `ClipCard` props exactly as today.

### Task 5.3 — Assemble the shell in `Review.tsx`

**Files:** Modify `frontend/src/renderer/src/routes/Review.tsx`; Modify `styles.css`

**Interfaces — Consumes:** `proposeVersions`, `VersionGallery`, `WorkingTimelineStrip`,
`SourceClipsPanel`, `ReviewChatPanel`, `useReview`.

- [ ] **Step 4: Compute versions** from the pool:
  `const versions = useMemo(() => proposeVersions(filtered), [filtered]);`
- [ ] **Step 5: Adopt handler** — calls the Phase 1 op directly through the existing
  context action (no ReviewContext change):

```tsx
const { applyTimelineOperation } = useReview();
const adoptVersion = useCallback((v: Version) => {
  if (acceptedOrder.length > 0 &&
      !window.confirm('Replace the current timeline with this version?')) return;
  void applyTimelineOperation('replace_timeline', {
    items: v.items.map(({ source_clip_id, start_sec, end_sec, speed, transform }) =>
      ({ source_clip_id, start_sec, end_sec, speed, transform })),
  });
}, [applyTimelineOperation, acceptedOrder.length]);
```

- [ ] **Step 6: Replace the `.page-body` subtree** with the 3-zone shell. Critical fix:
  `<ReviewChatPanel/>` and the working strip now live **inside** the scroll-managed
  shell, not as siblings after `.page-body`. Structure:

```tsx
return (
  <div className="page review-shell">
    <div className="page-header">{/* title + smoothness filter (unchanged) */}</div>
    <div className="review-shell-body">
      <aside className="review-spine"><ReviewChatPanel /></aside>
      <main className="review-main">
        <section className="version-zone" aria-label="Proposed versions">
          <div className="version-zone-head"><strong>Versions</strong>
            <span className="draft-summary">compare cuts, then use one</span></div>
          <VersionGallery versions={versions} projectId={projectId} onAdopt={adoptVersion} />
        </section>
        <SourceClipsPanel /* smoothness/filtered/clip props */ />
      </main>
    </div>
    <WorkingTimelineStrip />
  </div>
);
```

- [ ] **Step 7: CSS** in `styles.css`:
  - `.review-shell { display:flex; flex-direction:column; overflow:hidden; height:100% }`
  - `.review-shell-body { flex:1; display:flex; min-height:0; overflow:hidden }`
  - `.review-spine { width:300px; flex-shrink:0; overflow:auto; border-right:1px solid var(--border) }`
  - `.review-main { flex:1; overflow:auto; padding:20px 24px; display:flex; flex-direction:column; gap:16px }`
  - `.review-chat` (relocated) → make it fill `.review-spine` height (remove any fixed
    sizing that assumed bottom placement).
  - `WorkingTimelineStrip` `<details>` sits below `.review-shell-body`, full width,
    `flex-shrink:0`, with its own internal `overflow:auto`.
  This guarantees the spine, main, and strip each scroll independently — the
  scroll/hide bug is structurally gone.
- [ ] **Step 8: Remove** the now-relocated `review-grid`, `accepted-strip`,
  `draft-setup`, inline `TrimEditor`, and the old `<TimelineEditor/>` mount from
  `Review.tsx` (their behaviour moved to the gallery / working strip / source panel, or
  is deferred to SP-C). Keep `rankClips`/`filtered`/`clipsByFile` derivation feeding
  `SourceClipsPanel`.
- [ ] **Step 9: Verify.** `npm run typecheck` (0), `npm run build` (0). Manual smoke
  (`npm run dev:with-backend`): three versions render and play; "Use this version"
  populates the working strip; chat is the left spine; Source clips is collapsed (no
  video mounts until opened); all three regions scroll independently.
- [ ] **Step 10: Commit** (`feat(review): compare-versions shell — gallery, chat spine, collapsible strip`).

### Task 5.4 — E2E coverage

**Files:** Create `frontend/e2e/compare-versions.spec.ts` (reuse the project-setup
fixture from `frontend/e2e/playwriter-preview.spec.ts` — read it first for the helper).

- [ ] **Step 11: Add assertions:**
  1. `version-gallery` renders ≥3 `version-card`s; each `version-vibe` shows a non-zero `s` duration.
  2. Clicking a card surface toggles `expanded` (class present on one card).
  3. Clicking `version-adopt` makes `working-timeline-strip` non-empty (poll for item rows).
  4. **Scroll/hide regression:** `review-chat-panel` (spine) and `working-timeline-strip`
     are both visible/reachable without the page being clipped; `source-clips-panel`
     starts collapsed (`<details>` not `[open]`).
- [ ] **Step 12: Run** `npm run test:e2e` → all pass. **Step 13: Commit**
  (`test(e2e): compare-versions gallery, adopt, layout regions`).

**Phase 5 Verify:** typecheck + build + full e2e green.

---

## Phase 6 — Docs + final gate

**Files:** `docs/plans/README.md`, `docs/ARCHITECTURE.md`, `docs/specs/2026-06-21-compare-versions-review-ui-design.md`

- [ ] **Step 1:** Add a product-plan row for this plan in `docs/plans/README.md` and,
  if Task 3.3 rolled back, a Dependency-notes line for the deferred Timeline migration.
- [ ] **Step 2:** One paragraph in `docs/ARCHITECTURE.md` on the Version preview-spec
  model + `replace_timeline` adopt path (note: single live timeline preserved).
- [ ] **Step 3:** Flip the spec's `Status:` to "Implemented (SP1)".
- [ ] **Step 4: Final gate** — all green:
  `npm run typecheck` · `npm run build` · `npm run test:e2e` · `npm run test:backend`.
- [ ] **Step 5: Commit** (`docs(review): record compare-versions UI (SP1)`).

## Test plan

- **Backend (pytest):** `replace_timeline` — swap, clamp, unknown-source raise, empty
  clears, single undoable snapshot (Phase 1).
- **Frontend (Playwright e2e — the only frontend test surface):** gallery renders
  versions, expand-to-focus, adopt → working strip populated, layout regions reachable
  + Source clips collapsed (Phase 5); existing Timeline sequence-playback specs stay
  green through the Phase 3 migration (the gate).
- **Determinism:** `proposeVersions` is pure/deterministic; eyeball-verified via e2e
  (durations > 0, ≥3 cards). A vitest unit test is a future nicety — do **not** add a
  runner here (repo convention).

## Done criteria

ALL must hold:
- [ ] `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run test:backend` all exit 0.
- [ ] `grep -n '"replace_timeline"' backend/src/timeline_ops.py` shows it registered; its 5 tests pass.
- [ ] Review route renders ≥3 playable versions; "Use this version" replaces the timeline in one undo step.
- [ ] Chat is the left spine; Source clips panel is collapsed by default (no ClipCard `<video>` until opened).
- [ ] Spine, main, and working strip each scroll independently (scroll/hide bug gone) — asserted in e2e.
- [ ] Phase 3 either migrated Timeline onto `useSequencePlayer` with all e2e green, **or** rolled back per the STOP note with a recorded follow-up.
- [ ] `docs/plans/README.md` row added/updated.

## STOP conditions

Stop and report (do not improvise) if:
- The "Current state" excerpts don't match live code (drift past `2d0f918`).
- Baseline `npm run test:e2e` fails before any change.
- Task 3.3 regresses sequence-playback e2e beyond one fix attempt → execute the rollback note; continue with Phases 4–5 (unaffected).
- Adopting a version doesn't reflect in the GUI within ~2s (the SSE reconcile path is broken — that's a backend/runtime issue; report measurements).
- You find yourself needing to change `ReviewContext` internals or add numeric editing fields — out of scope (numeric fields are SP-C); report why.

## Maintenance notes

- `useSequencePlayer` is the single forward-playback engine. If gapless cross-file
  preloading (dual-buffer) is built later, the `seek` epoch is the insertion point
  (carried over from plan 004's note).
- The mock `proposeVersions` is the seam for SP-B: replacing it with a real
  agent-backed call (same `Version[]` return) is a local change in Review.tsx.
- Source-clips virtualization is now partly mooted (collapsed by default); if it's
  expanded heavily, revisit poster-thumbnail virtualization.
