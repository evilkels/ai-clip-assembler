# Self-contained macOS runtime tools

Status: IN PROGRESS. Packaged startup preflight and CI staging work on Apple
Silicon; compliance material, fixture tests, Intel evidence, diagnostics,
signing/notarization, and clean-machine validation remain. Written at `f6ea3d4`.

## Goal and architecture

Every architecture-specific DMG ships the PyInstaller backend plus one verified
`ffmpeg`/`ffprobe` pair with `vidstabdetect`. Electron preflights private tools,
prepends their directory only to the backend `PATH`, and reports health in
Settings. Development keeps system `PATH`; provider CLIs are never bundled.

## Delivered

- `preflightRuntimeTools` returns structured missing/not-executable/
  missing-vidstab/preflight-failed states; main-process tests and typecheck pass.
- `stage-runtime-tools.mjs` accepts `CLIP_ASSEMBLER_FFMPEG_BIN`, stages the pair
  plus recursive Homebrew dylibs, rewrites install names, and rejects builds
  without `vidstabdetect`; CI invokes it before packaging.
- electron-builder places staged files under `resources/tools`; packaged startup
  preflights them and prepends the ready directory. Development is unchanged.

## Remaining work

1. Commit pinned FFmpeg/libvidstab revisions, SHA-256 checksums, exact configure
   line, GPLv3 text, build config, and durable source offer. Staging must reject
   missing or placeholder compliance files.
2. Add fixture tests for the complete staged tree and missing `ffprobe`; enforce
   staging in local distribution commands; record arm64 and x64 evidence.
3. Persist startup status and expose read-only IPC/preload diagnostics. If no
   renderer component-test runner exists, stop and select one before UI changes.
4. Build, sign, notarize, install, and smoke-test matching DMGs on clean arm64
   and x64 Macs through Import → Analyse → Export without developer tools.

## Gates and STOP conditions

- `cd frontend && npm run test:main && npm run typecheck && npm run build` exits
  0 and packaged resources contain both tools and compliance files.
- Stop if no compliance owner/source material exists, either architecture is
  unsupported, `vidstabdetect` is absent, or clean-machine use reaches system
  FFmpeg or developer tooling.
