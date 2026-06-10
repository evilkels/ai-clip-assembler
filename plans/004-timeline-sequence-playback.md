# Plan 004: Make Timeline play the assembled sequence, video-driven and stutter-free

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a39ed1..HEAD -- frontend/src/renderer/src/components/Timeline.tsx frontend/src/renderer/src/components/ClipPreview.tsx frontend/src/renderer/src/components/ClipCard.tsx frontend/e2e/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (rework of the page's central interaction; mitigated by e2e gates)
- **Depends on**: none
- **Category**: bug / UX
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

Real-footage QA (2026-06-10, actual drone session) found the Timeline page's playback both broken and janky. Two architectural causes, confirmed by reading the code:

1. **Two unsynchronized clocks.** The transport (▶ ■ ◀◀, J/K/L) advances a `requestAnimationFrame`-driven `playhead` in React state, while the preview `<video>` plays on its own clock. A correction effect hard-seeks the video whenever the two drift more than 0.35 s apart — on real 4K footage streamed over ranged HTTP, each hard seek lands on a non-keyframe and visibly freezes/stutters the picture. This is the stutter the user reported.
2. **Two competing control surfaces, neither plays the sequence.** The preview `<video>` renders native browser controls. Pressing native play plays the *raw source file* (the control bar shows the source's full duration, e.g. `0:16/1:15`), clamped to the current clip's range by a `timeupdate` handler — it never advances to the next timeline clip. The transport's playhead does cross clip boundaries, but the boundary triggers a full `<video src>` swap and the playback experience falls apart.

After this plan: pressing Play plays the assembled sequence — clip 1's trimmed range, then clip 2, etc. — with the **video element as the only clock** while playing (no drift-correction seeks), native controls removed from the Timeline preview (transport + ruler scrub are the single control surface), and the 60 fps React re-render of the whole timeline eliminated. The Review-page card previews keep their current behavior.

## Current state

Relevant files:

- `frontend/src/renderer/src/components/Timeline.tsx` (480 lines) — the whole timeline UI: segments derivation, transport, RAF playhead loop, keyboard shortcuts, ruler/scrub, drag-reorder, trim handles, and the `<ClipPreview>` mount.
- `frontend/src/renderer/src/components/ClipPreview.tsx` (101 lines) — shared `<video>` wrapper used by BOTH the Timeline preview and every Review-board `ClipCard`. Any prop you add must be optional with a default preserving ClipCard behavior.
- `frontend/src/renderer/src/components/ClipCard.tsx` — Review-board card; mounts `<ClipPreview ... testId="clip-preview-video" />` with no `playing`/`currentTimeSec` props (defaults: `loop=true`, paused until user uses native controls). **Do not change its behavior.**
- `frontend/src/renderer/src/api/client.ts:34` — backend media URL: `window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000'`; `buildVideoMediaUrl(projectId, fileId)` returns a stable URL per source file (ranged streaming endpoint `GET /projects/{id}/videos/{file_id}/media`).
- `frontend/e2e/playwriter-preview.spec.ts` — existing Playwright spec; asserts `timeline-preview-video` reaches `readyState ≥ 2` and `timeline-preview-current-clip` is non-empty. Your changes must keep it green; you will extend it.

Key excerpts as of `6a39ed1`:

The RAF loop that makes React state the clock (`Timeline.tsx:118-142`):

```tsx
  // Transport: advance the playhead while playing.
  useEffect(() => {
    if (direction === 0 || totalDuration === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((p) => {            // <- 60fps setState re-renders the whole component
        const next = p + dt * direction;
        ...
```

The preview wiring and the source-time mapping (`Timeline.tsx:94-111` and `327-338`):

```tsx
  const currentSegment = segments.find(
    (seg) => playhead >= seg.offset && playhead < seg.offset + seg.duration,
  );
  ...
  const previewSourceTime = previewSegment
    ? previewSegment.trimStart + previewRelativeTime
    : 0;
  ...
          <ClipPreview
            mediaUrl={previewMediaUrl}
            startSec={previewSegment.trimStart}
            endSec={previewSegment.trimEnd}
            currentTimeSec={previewSourceTime}
            playing={direction === 1 && currentSegment?.clip.clip_id === previewSegment.clip.clip_id}
            loop={false}
            ...
```

The drift-correction hard seek that causes the stutter (`ClipPreview.tsx:43-49`):

```tsx
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (Math.abs(video.currentTime - targetTime) > 0.35) {
      video.currentTime = targetTime;   // <- fires repeatedly during playback
    }
  }, [mediaUrl, targetTime]);
```

The native controls + clip clamp (`ClipPreview.tsx:70-97`): `<video ... controls muted preload="metadata" ...>` with an `onTimeUpdate` that snaps `currentTime` back inside `[startSec, endSec)` and pauses/loops at `endSec`.

Conventions: function components + hooks, no external state library (plain React context in `state/ReviewContext.tsx`), CSS classes in `styles.css` (no Tailwind utility classes in these components despite Tailwind being installed — match the existing `className` style), `data-testid` attributes for Playwright hooks. TypeScript strict; `npm run typecheck` must stay clean.

Useful fact for the design: consecutive timeline clips frequently come from the **same source file** (real QA showed 3 of 4 clips from one file). `previewMediaUrl` is identical for same `file_id`, so React keeps the same `<video src>` — advancing within the same file is a seek, not a reload. The design below exploits this.

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 |
| E2E (starts its own servers per `playwright.config.ts`; needs backend venv + ffmpeg) | `npm run test:e2e` | all pass |
| Backend tests (regression guard, no backend changes expected) | `npm run test:backend` | all pass |

Check `frontend/playwright.config.ts` before running e2e to confirm how the backend/renderer are launched in this environment; the existing spec passing on your machine before you start is the baseline (run it first — if it fails at `6a39ed1`+, STOP).

## Scope

**In scope** (the only files you should modify):
- `frontend/src/renderer/src/components/Timeline.tsx`
- `frontend/src/renderer/src/components/ClipPreview.tsx` (additive, backward-compatible props only)
- `frontend/src/renderer/src/styles.css` (only if the controls removal needs minor styling)
- `frontend/e2e/playwriter-preview.spec.ts` (extend) or a new sibling spec file
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `frontend/src/renderer/src/components/ClipCard.tsx` and the Review page's behavior — Review keeps native controls and per-clip looping. (Known separate issue, deliberately deferred: every ClipCard mounts its own `<video>` against 4K sources — 14 candidates = 14 video elements. That is a future virtualization/thumbnail plan, not this one.)
- `frontend/src/renderer/src/state/ReviewContext.tsx` — trims/order state contracts stay as-is.
- `backend/**` — the media streaming endpoint is sufficient; no backend changes.
- Gapless dual-buffer preloading of the *next different-file* clip — explicitly deferred (operator accepted a brief switch at cross-file boundaries for v1).

## Git workflow

- Branch: `feature/timeline-sequence-playback` (repo convention `feature/<slug>`)
- Conventional commits, e.g. `fix(timeline): video-driven sequence playback`, `test(e2e): sequence playback coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Design (target architecture)

Single principle: **while playing forward, the `<video>` element is the only clock.** React state follows the video; it never corrects it.

- **Seeks become explicit commands.** Replace the continuous `currentTimeSec` prop + drift-correction with a `seek` prop of shape `{ time: number; epoch: number }`. `ClipPreview` seeks only when `epoch` changes. Timeline bumps the epoch on: user scrub (ruler click), clip click, arrow-key nudge, segment advance, and reverse-scrub ticks. During forward play, the epoch does not change, so the video is never hard-seeked → no stutter.
- **Playback follows the video.** `ClipPreview` gains an `onPlaybackTime?: (sourceTimeSec: number) => void` callback driven by a RAF loop reading `video.currentTime` while playing (RAF, not `timeupdate`, for smooth playhead motion). Timeline maps it: `timelineSec = seg.offset + (sourceTime - seg.trimStart)`.
- **Segment advance.** When the video reaches `seg.trimEnd` (checked in the same RAF read), Timeline advances to the next segment: same `file_id` → bump seek epoch to `next.trimStart`, keep playing (cheap seek, usually instant); different `file_id` → `mediaUrl` changes, `ClipPreview` reloads metadata, seeks to `next.trimStart`, and resumes via the `playing` prop (brief load acceptable). After the last segment: stop, playhead = `totalDuration`.
- **Kill the 60 fps re-render.** The playhead *line* and *timecode text* update via refs (direct `style.left` / `textContent` mutation inside the RAF callback). React `playhead` state updates are throttled to ~150 ms (it still drives `currentSegment` derivation and non-critical UI). The current segment index becomes explicit state (`currentIndex`), changed only at segment boundaries and explicit jumps — not re-derived 60×/s from playhead.
- **Native controls off on Timeline.** `ClipPreview` gains `controls?: boolean` (default `true` so ClipCard is untouched); Timeline passes `controls={false}`. The clip-clamping `onTimeUpdate` logic must apply only when native controls are in charge (ClipCard usage); for Timeline usage the RAF/segment-advance path owns boundaries — guard the clamp behind the `controls` flag or a new `manageBounds?: boolean` prop, your choice, but ClipCard behavior must be byte-identical.
- **Reverse (◀◀ / J) is scrub-style, not decoded playback.** HTML5 video cannot play backwards. Keep a RAF loop that walks the playhead backwards, with the video **paused**, bumping the seek epoch at most ~4×/s (throttled coarse preview). This is a deliberate downgrade from "pretend reverse playback" to honest scrubbing; keep J/K/L bindings as-is.

## Steps

### Step 1: Baseline

Run `npm run typecheck` and `npm run test:e2e` on a clean checkout of your branch point. Both must pass before any edit.

**Verify**: both exit 0. If e2e fails pre-change, STOP.

### Step 2: Rework `ClipPreview` props (backward-compatible)

Add optional props: `controls?: boolean` (default `true`), `seek?: { time: number; epoch: number }`, `onPlaybackTime?: (sourceTimeSec: number) => void`. Behavior:

- Seek exactly once per `epoch` change (and on `loadedmetadata` after a `mediaUrl` change, to `seek.time` if provided, else existing `safeStart` behavior).
- Remove the unconditional drift-correction effect (`ClipPreview.tsx:43-49`) — its job is replaced by epoch seeks. Preserve the legacy path for ClipCard: when `seek` is undefined, keep today's behavior (initial seek to `startSec`, loop clamp, native controls).
- While `playing && onPlaybackTime`, run a RAF loop reporting `video.currentTime`; cancel on pause/unmount.
- Render `controls` attribute from the prop.

**Verify**: `npm run typecheck` → exit 0. `npm run test:e2e` → still green (ClipCard + current Timeline both still on legacy props at this point).

### Step 3: Rework `Timeline.tsx` playback engine

- Add `currentIndex` state; replace the RAF `setPlayhead` advance loop (`Timeline.tsx:118-142`) for `direction === 1` with the video-driven flow from the Design section (`onPlaybackTime` → ref-mutate playhead line + timecode, throttled `setPlayhead`, boundary check → segment advance with same-file/cross-file handling).
- Keep the RAF loop only for `direction === -1` (reverse scrub, video paused, epoch bumps ≤ 4 Hz).
- All explicit jumps (ruler scrub `Timeline.tsx:240-249`, clip `onPointerDown` `:438-442`, ArrowLeft/Right nudges `:191-199`) set `currentIndex` + bump the seek epoch.
- Pass `controls={false}` and the new props to the Timeline's `<ClipPreview>`; drop the now-unused `currentTimeSec` plumbing (`previewRelativeTime`/`previewSourceTime` derivation, `Timeline.tsx:101-107`) in favor of the explicit engine.
- Add `data-testid="transport-play"`, `"transport-stop"`, `"transport-reverse"` to the three transport buttons (`Timeline.tsx:354-361`) for the e2e tests.
- Playhead line element (`Timeline.tsx:469`) and timecode (`:363-365`) get refs and are updated imperatively in the RAF path; their React-rendered values remain as the throttled fallback.

**Verify**: `npm run typecheck` → exit 0. Manual smoke via `npm run dev:with-backend`: play crosses a clip boundary and keeps going; no native control bar on the Timeline preview; ruler click jumps both playhead and video.

### Step 4: Extend Playwright coverage

In `frontend/e2e/playwriter-preview.spec.ts` (or a sibling `timeline-playback.spec.ts` reusing its fixture helpers), after the existing timeline-preview assertions add:

1. **Sequence playback test**: ensure ≥2 clips are on the timeline (the existing fixture flow includes clips; if it yields only one, extend the fixture flow the same way the current spec builds it). Click `transport-play`; poll that the imperatively-updated timecode (or `video.currentTime`) advances monotonically for ≥2 s **with no `src` attribute change** while inside clip 1; then seek near clip 1's end via the engine (e.g. set playhead by clicking the ruler near the boundary — use the track's bounding box), click play, and poll that `timeline-preview-current-clip` text changes to clip 2's file name while the video element reports `paused === false` within 5 s of the boundary.
2. **Controls removed**: `expect(timelinePreview).not.toHaveAttribute('controls', ...)` — assert the attribute is absent on the Timeline preview, AND still present on `clip-preview-video` (Review page unchanged).
3. **No-stutter proxy**: while playing within one clip for 3 s, count `seeking` events on the video element (attach a listener via `evaluate`) → expect 0.

**Verify**: `npm run test:e2e` → all pass, including the new tests.

### Step 5: Full gate

**Verify**:
- `npm run typecheck` → exit 0
- `npm run build` → exit 0
- `npm run test:e2e` → all pass
- `npm run test:backend` → all pass (proves no accidental backend coupling)

## Test plan

- Extended/new Playwright spec per step 4: sequence advance across a clip boundary, controls absent on Timeline / present on Review, zero `seeking` events during steady forward play, existing readyState assertions stay green.
- Pattern to follow: the existing `expect.poll(... readyState ...)` style in `frontend/e2e/playwriter-preview.spec.ts:51-66`.
- No component-level unit test infra exists in `frontend/` (no vitest/jest config — do not add one in this plan; Playwright is the test surface).

## Done criteria

ALL must hold:

- [ ] `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run test:backend` all exit 0
- [ ] New e2e assertions exist for: boundary advance, controls-attribute split (Timeline absent / Review present), zero `seeking` events during 3 s of steady play
- [ ] `grep -n 'controls' frontend/src/renderer/src/components/ClipPreview.tsx` shows the attribute is prop-driven; `grep -n '0.35' frontend/src/renderer/src/components/ClipPreview.tsx` returns nothing (drift-correction removed)
- [ ] `git diff --name-only` touches only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift past `6a39ed1`).
- The baseline e2e run (step 1) fails before any change.
- Cross-file segment advance cannot resume playback within ~2 s in the e2e environment (signals a media-endpoint/`preload` problem — that would need backend or preload-strategy work, which is out of scope; report measurements instead).
- Keeping ClipCard behavior identical forces non-additive changes to `ClipPreview`'s existing props — report the conflict rather than altering Review behavior.
- You find yourself wanting to restructure `ReviewContext` state — out of scope; report why.

## Maintenance notes

- This plan makes the video the clock for forward play; if "fully gapless" preview is built later (dual-buffer, deferred by the operator), the seek-epoch mechanism is the right insertion point — preload the next file's element and swap on boundary instead of bumping the epoch.
- The Review board's N-video-elements problem (every ClipCard streams 4K metadata) is a known, deliberately deferred jank source — likely the next UX plan (poster thumbnails + mount video on hover/select).
- Reviewer should scrutinize: RAF loop cleanup on unmount/route change (leaked RAF keeps seeking a dead element), the same-file vs cross-file advance branch, and that `ClipCard`'s rendered DOM is unchanged (diff the e2e snapshot or inspect manually).
- Real-footage validation (plan 001's runbook, Flow A/B) should be re-run on the Timeline page after this lands — playback quality is part of the "feels like a real editor" bar in `plans/product/drone-workflow-qa-flows.md` Flow B.
