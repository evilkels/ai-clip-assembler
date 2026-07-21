# Plan 004: Make Timeline play the assembled sequence, video-driven and stutter-free

## Status

- **Status**: DONE (2026-06-11) | **Priority**: P1 | **Effort**: M
- **Risk**: MED (rework of the page's central interaction) | **Depends on**: none
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

Real-footage QA found Timeline playback broken and janky, for two reasons:
(1) two unsynchronized clocks — a `requestAnimationFrame`-driven React
`playhead` vs. the `<video>` element's own clock, corrected via hard seeks
whenever they drifted >0.35s, which stutters/freezes on real 4K footage
because each hard seek lands on a non-keyframe; (2) two competing control
surfaces — native video controls played the *raw source file* (full duration
shown), clamped per-clip via `timeupdate`, while the transport's playhead
crossed clip boundaries by swapping `<video src>`, breaking playback.

## Decisions / target design

Single principle: **while playing forward, the `<video>` element is the only
clock**; React state follows it, never corrects it. Seeks became explicit
`{ time, epoch }` commands (bumped only on user scrub/click/nudge/segment
advance), replacing continuous drift-correction. `ClipPreview` reports
`video.currentTime` via RAF, not `timeupdate`, for smooth motion; Timeline
advances segments when `trimEnd` is reached (same `file_id` → cheap epoch
bump, keep playing; different `file_id` → reload, brief stutter accepted,
gapless dual-buffer preload explicitly deferred). The 60fps whole-component
re-render was eliminated via refs for playhead/timecode; React `playhead`
state throttled (~150ms). Native controls removed from the Timeline preview
only — `ClipCard`/Review board untouched (additive, backward-compatible
`ClipPreview` props, default preserving legacy behavior). Reverse (◀◀/J) is
honest scrub-style (video paused, epoch bumped ≤4Hz), not real reverse
decoding — HTML5 video can't play backwards.

Invariant exploited: consecutive timeline clips often share a source file, so
advancing within one file is a cheap seek, not a reload.

## Done criteria / maintenance notes

Plan marks this DONE; gates were typecheck/build/e2e/backend-test exit 0 plus
new e2e for boundary advance, controls-attribute split, zero `seeking` events
during 3s of steady play. Future gapless playback should reuse the seek-epoch
mechanism (preload next file's element, swap on boundary). The Review board's
N-video-elements problem (every ClipCard streams 4K metadata) is a known,
deliberately deferred jank source — candidate for a poster-thumbnail/
mount-on-hover follow-up. Reviewer focus: RAF cleanup on unmount, same-file
vs cross-file advance, ClipCard's DOM staying unchanged.
