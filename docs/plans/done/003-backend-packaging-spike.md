# Plan 003: Spike — bundle the FastAPI backend into the packaged Electron app

## Status

- **State**: DONE — SUPERSEDED by shipped production packaging (2026-06-28).
- **Priority**: P3; **Depends on**: 001 (sequencing only)
- **Planned at**: commit `6a39ed1`, 2026-06-10

## Why this matters

`npm run dist` originally built a DMG with only the Electron shell — the FastAPI
backend was a dev-only process, never spawned by Electron. A non-developer
installer would get an app whose API calls all failed. This spike asked: can we
ship a single DMG that launches its own backend, which bundling approach, and
what do the landmines cost?

## What happened (2026-06-28 reconcile)

Rather than a throwaway prototype + decision doc, the team shipped real
self-contained packaging directly (`f469e43`): PyInstaller onedir bundle
(`backend/packaging/{entry.py,backend.spec}`, `npm run build:backend`) wired
via `extraResources`; `frontend/src/main/index.ts` spawns it when packaged
(port via `CLIP_ASSEMBLER_PORT`, PATH extended with
`/opt/homebrew/bin:/usr/local/bin`, health-checked, URL exposed to renderer,
CSP allows the dynamic port). Verified end-to-end via DMG install to
`/Applications`. **Not produced**: the planned decision doc — the four
landmines below were resolved in code instead of documented.

## Landmines resolved in code

1. CWD-relative `PROJECTS_DIR` (packaged app CWD is `/`, unwritable).
2. CORS allowlist (`file://` origin from packaged renderer).
3. PATH for ffmpeg/ffprobe (GUI-launched apps get a minimal PATH).
4. `.env` loading is CWD-relative and no-ops when packaged — config must come
   via spawn environment instead.

## Carried forward as live follow-ups (top adoption blockers)

- **ffmpeg-with-vidstab is NOT bundled** — PATH is merely extended, so a fresh
  installer still needs the ~30-min `ffmpeg --with-libvidstab` source build
  before analysis works.
- **Code signing / notarization** — DMG is unsigned; Gatekeeper friction.
- **Child-process orphan/port-collision hardening** — spawn code is
  prototype-grade (no retry/backoff), production should replace it, not
  extend it; an orphaned uvicorn keeps the port busy and breaks next launch.

These should become their own plan(s).
