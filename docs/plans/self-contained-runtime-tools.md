# Self-Contained macOS Runtime Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Python backend, `ffmpeg`, and `ffprobe` in every macOS DMG so a clean Mac can analyse footage without Python, pip, Homebrew, or a terminal.

**Architecture:** Keep the backend frozen with PyInstaller. Stage one verified `ffmpeg`/`ffprobe` pair into Electron resources for the target architecture; Electron preflights those private tools before spawning the backend and puts their directory first in the backend-only `PATH`. Surface preflight status in existing Settings diagnostics.

**Tech Stack:** Electron main process, TypeScript/node:test, electron-builder, PyInstaller, FastAPI, FFmpeg with `libvidstab`.

**Written against:** `f6ea3d4`

**Status:** IN PROGRESS — packaged-startup preflight and CI staging are
implemented and locally verified on Apple Silicon. Release diagnostics,
compliance material, Intel CI evidence, and clean-machine DMG validation remain.

**Reconciled 2026-07-21:** Task 1 and the executable parts of Task 3 are
implemented and test-green. Task 2 is only partial: CI stages the binary pair
and dynamic-library closure, but the required committed compliance materials
and staging tests do not exist yet. Task 4 has not started.

## Global Constraints

- macOS only: ship separate Apple Silicon and Intel artifacts; never run a mismatched binary.
- Release users never need Python, pip, Homebrew, or a first-run download.
- Development mode retains the developer's `PATH` behavior.
- `ffmpeg` must include `vidstabdetect`; `ffprobe` comes from the same build.
- Do not bundle provider CLIs such as `pi`.
- The final distribution includes GPL/source-compliance material for the chosen FFmpeg build.

---

### Task 1: Define and test the packaged-tool contract

**Files:**
- Modify: `frontend/src/main/backendLifecycle.ts`
- Modify: `frontend/tests/main/backendLifecycle.test.ts`

**Produces:**

```ts
export type RuntimeToolStatus =
  | { ready: true; ffmpegPath: string; ffprobePath: string; toolDirectory: string }
  | { ready: false; reason: 'missing-ffmpeg' | 'missing-ffprobe' | 'not-executable' | 'missing-vidstabdetect' | 'preflight-failed'; detail: string };
```

- [x] Tests cover a valid executable pair, missing `ffmpeg`, and missing `vidstabdetect`.
- [x] The tests were introduced before the implementation in the delivery workflow.
- [x] `preflightRuntimeTools(options)` returns structured expected damage states.
- [x] `npm run test:main && npm run typecheck` exits 0 (re-verified 2026-07-21).
- [x] The preflight implementation is committed.

### Task 2: Stage verified architecture-specific FFmpeg tools and compliance material

**Files:**
- Create: `frontend/scripts/stage-runtime-tools.mjs`
- Create: `frontend/resources/runtime-tools/README.md`
- Create: `frontend/resources/runtime-tools/licenses/ffmpeg/COPYING.GPLv3`
- Create: `frontend/resources/runtime-tools/licenses/ffmpeg/build-config.txt`
- Create: `frontend/resources/runtime-tools/licenses/ffmpeg/source-offer.txt`
- Modify: `frontend/package.json`
- Modify: `.gitignore`

**Consumes:** a vetted Homebrew FFmpeg build with `libvidstab` on each matching CI runner.

**Produces:** `frontend/build/runtime-tools/ffmpeg`, `ffprobe`, and `licenses/ffmpeg/*` for exactly the current architecture.

- [ ] Document the required binaries, source revisions, checksum format, configure line, and release compliance check in `resources/runtime-tools/README.md`. The staging script must reject placeholder compliance documents.
- [ ] Write a fixture test/dry run: with executable `ffmpeg` and `ffprobe`, assert the staged output includes both tools and all license files; with missing `ffprobe`, assert non-zero exit and a clear error.
- [~] `stage-runtime-tools.mjs` accepts `CLIP_ASSEMBLER_FFMPEG_BIN`, copies the
  binary pair and recursive Homebrew dylib closure, rewrites install names, and
  rejects FFmpeg without `vidstabdetect`; license copying/rejection remains.
- [~] `stage:runtime-tools` exists and CI runs it before packaging; the generic
  local `build`/`dist` scripts do not yet enforce staging.
- [ ] Add and run the missing fixture/compliance-tree test, then record both-architecture evidence.

### Task 3: Package and prefer the private tools at application startup

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/tests/main/backendLifecycle.test.ts`

**Consumes:** `process.resourcesPath/tools/ffmpeg` and `ffprobe` in packaged builds.

**Produces:** backend `PATH` starting with `dirname(ffmpegPath)` only after a ready preflight.

- [ ] Write failing tests for packaged paths resolving to `join(resourcesPath, 'tools', 'ffmpeg')` and `ffprobe`, and for the private tools directory being the first `PATH` entry.
- [x] Add electron-builder `extraResources`: `{ "from": "build/runtime-tools", "to": "tools", "filter": ["**/*"] }`.
- [x] `startPackagedBackend` preflights private tool paths and prepends the ready tool directory; development startup remains unchanged.
- [ ] Run `cd frontend && npm run test:main && npm run typecheck && npm run build`; expect exit 0 and a built resources tree containing `tools/ffmpeg`, `tools/ffprobe`, and `tools/licenses/ffmpeg/`.
- [ ] Commit with `git commit -m "feat: bundle and prefer private ffmpeg tools"`.

### Task 4: Surface runtime-tool health in Settings diagnostics

**Files:**
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/renderer/src/components/SettingsModal.tsx`
- Modify: the existing preload type declaration under `frontend/src/renderer/src/types/`
- Test: existing renderer test location, after verifying its runner

**Produces:** Electron IPC `runtime-tools:status` returning the final `RuntimeToolStatus`, and a Settings diagnostics row for it.

- [ ] Characterize the renderer-test harness. If no component harness exists, STOP and amend this plan with a test-runner selection before modifying `SettingsModal`.
- [ ] Write a failing diagnostics test for `ready: false, reason: 'missing-vidstabdetect'` that asserts the exact message: “Bundled video tools need repair. Reinstall AI Clip Assembler.” It must not mention Homebrew, Python, or terminal commands.
- [ ] Persist the startup status in the main process, expose a read-only preload method, and add a Runtime Tools row beside backend diagnostics. Non-ready status can offer only “Reveal diagnostic log” and concise reinstall copy.
- [ ] Run `cd frontend && npm run typecheck && npm run build && npm run test:main`; then clean-machine test both architectures: install the matching DMG, confirm `vidstabdetect`, and complete Import → Analyse → Export without developer tools.
- [ ] Commit with `git commit -m "feat: report bundled runtime tool health"`.

## Release checklist

- [ ] Pin FFmpeg/libvidstab revisions and SHA-256 checksums.
- [ ] Record the exact configure line and tool versions in `build-config.txt`.
- [ ] Include GPL notice and durable corresponding-source offer/link in every DMG.
- [ ] Build, sign, notarize, and smoke-test arm64 and x64 DMGs.
- [ ] Verify each DMG's packaged `ffmpeg -hide_banner -filters` includes `vidstabdetect`.

## STOP conditions

- No compliance owner can provide source/license material for the bundled binary.
- A tool build does not support both target architectures.
- A tool build lacks `vidstabdetect`.
- A clean-machine test invokes system FFmpeg or needs developer tooling.
