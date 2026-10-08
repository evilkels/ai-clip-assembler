# Self-contained macOS runtime tools

Every architecture-specific DMG ships the PyInstaller backend plus one verified
`ffmpeg`/`ffprobe` pair with `vidstabdetect`, so the packaged app runs without
developer tools on a clean Mac.

## Context

In progress. Packaged startup preflight and CI staging work on Apple Silicon;
compliance material, fixture tests, Intel evidence, diagnostics,
signing/notarization, and clean-machine validation remain. Written at `f6ea3d4`.

Claude Code and Codex are never bundled or installed by the app (ADR 0008); only FFmpeg/ffprobe and the backend are bundled.

### Goal and architecture

Every architecture-specific DMG ships the PyInstaller backend plus one verified
`ffmpeg`/`ffprobe` pair with `vidstabdetect`. Electron preflights private tools,
prepends their directory only to the backend `PATH`, and reports health in
Settings. Development keeps system `PATH`; provider CLIs are never bundled.

### Gates and STOP conditions

- `cd frontend && npm run test:main && npm run typecheck && npm run build` exits
  0 and packaged resources contain both tools and compliance files.
- Stop if no compliance owner/source material exists, either architecture is
  unsupported, `vidstabdetect` is absent, or clean-machine use reaches system
  FFmpeg or developer tooling.

## Phase 1: Delivered

- [x] 1.1 `preflightRuntimeTools` returns structured missing/not-executable/missing-vidstab/preflight-failed states; main-process tests and typecheck pass (shipped before v0.4.0)
- [x] 1.2 `stage-runtime-tools.mjs` accepts `CLIP_ASSEMBLER_FFMPEG_BIN`, stages the pair plus recursive Homebrew dylibs, rewrites install names, and rejects builds without `vidstabdetect`; CI invokes it before packaging (shipped before v0.4.0)
- [x] 1.3 electron-builder places staged files under `resources/tools`; packaged startup preflights them and prepends the ready directory; development is unchanged (shipped before v0.4.0)

## Phase 2: Remaining work

- [ ] 2.1 Commit pinned FFmpeg/libvidstab revisions, SHA-256 checksums, exact configure line, GPLv3 text, build config, and durable source offer. Done when staging rejects missing or placeholder compliance files.
- [ ] 2.2 Add fixture tests for the complete staged tree and missing `ffprobe`; enforce staging in local distribution commands; record arm64 and x64 evidence. Done when the fixture tests pass in `npm run test:main` and arm64 and x64 evidence is recorded.
- [ ] 2.3 Persist startup status and expose read-only IPC/preload diagnostics. Done when a Playwright spec in `frontend/e2e/` (the renderer has no unit runner) opens Settings › Diagnostics and asserts the persisted startup status for a ready and a missing-vidstab start, and `npm run test:main` covers the IPC handler.
- [ ] 2.4 Build, sign and notarize matching DMGs for arm64 and x64. Done when `build-dmg.yml` produces arm64 and x64 DMGs whose packaged resources contain both tools and the compliance files, and for each DMG `spctl -a -vvv -t install` reports `accepted` (`source=Notarized Developer ID`) and `xcrun stapler validate` passes. Needs [033](033-in-app-updates-and-a-trusted-build.md) H1 (enrollment).

## Human tasks

- [ ] H1 Install and smoke-test the matching DMGs on clean arm64 and x64 Macs through Import → Analyse → Export without developer tools. Stop if clean-machine use reaches system FFmpeg or developer tooling.
