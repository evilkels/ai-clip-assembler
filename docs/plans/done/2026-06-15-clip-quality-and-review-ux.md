# Clip Quality, Composition & Review UX Improvements

**Planned at:** commit `3fdad32`, 2026-06-15. **Status: all 5 phases landed** (2026-06-15). Backend 160 tests green, frontend typecheck clean.

## Why this matters

A real 3-video analysis run showed the *output* quality, not runtime, was the weak link: clips felt "cut from the start" because detected scene boundaries were computed but never used for cut points; smoothness scoring was a crude `cv2.absdiff` proxy (weight 0.60) that conflated subject motion with camera shake, while `vidstabdetect` already wrote a `.trf` motion file that was thrown away; review flow reset profile/target on tab-switch and could drop decisions on reopen; rescan never removed deleted files. Key insight: the pipeline already computed the data needed for a better edit (scene boundaries, motion transforms, per-frame scores) and discarded most of it — several fixes cost **no extra processing time**.

## Decisions made

- **Rescan**: rewritten to reconcile against disk (keep/add/drop), not just append.
- **Review state**: `profile`/`targetDuration` moved into `ReviewContext` so selections survive tab switches and reopen.
- **Cuts**: anchored to scene boundaries; clip start/end chosen via sliding window maximizing mean `overall_score` within a scene (kills "cut from start" feel); capped clips per scene for diversity; profiles emit a length *range* for pacing variety.
- **Stability scoring**: replaced/blended `absdiff` motion proxy with a jerk/derivative-based stability score parsed from vidstab's `.trf` output (ffmpeg 8.x binary `TRF1` format); retired the separate optical-flow rotation pass since vidstab now supplies rotation — net time saving, not added cost. `fit_rotation_degrees` recovers per-frame rotation via least-squares about the centroid. **Manual calibration of `max_turn_rate_deg_per_sec` (12.0) and the 3°/s slow-mo gate against real footage still recommended.**
- **Editor profiles**: existing three profiles (not new ones) enriched with clip-length range, `max_clips_per_scene` (99/2/1), `speed_policy`, `ordering` — applied at draft time so switching re-drafts instantly. Speed variation now actually emitted by `export_engine` (previously `suggested_speed=1.0` was hardcoded and ignored).
- **Review UX**: clip cards use a poster thumbnail rather than a live `<video>` per card (avoids known N×4K jank); included/excluded/order/trims/profile/target are one shared source of truth across Review and Timeline tabs.

## Deferred / out of scope

Music beat-sync, multi-track, color grading (PRD Phase-2). Full `.app`/DMG packaging (tracked in `003-backend-packaging-spike.md`).
