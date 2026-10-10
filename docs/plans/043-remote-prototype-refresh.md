# 043: Remote View prototype refresh stability

The running Remote View prototype keeps its clip cards and thumbnails in place when background polling reports no visible change. Real progress, decisions and connection changes still appear.

## Context

The owner's screen recording on 2026-10-10 showed periodic thumbnail flicker. Browser diagnosis reproduced complete grid replacement every 2.5 seconds. Consecutive `/api/project` responses differed only in `server_time`; excluding that field retained the original image nodes over two polls.

The prototype is served from a machine-local directory and is separate from the unfinished production Remote View implementation in [PR #108](https://github.com/evilkels/ai-clip-assembler/pull/108), [plan 041](https://github.com/evilkels/ai-clip-assembler/blob/feat/remote-view/docs/plans/041-remote-view.md). This plan preserves only its browser assets, a synthetic API harness and the refresh regression. It does not import private footage, exports, pairing state or the machine-specific server.

Decisions: compare Project snapshots excluding only `server_time`, retain the complete response as application data, and keep meaningful polling changes observable. Preserve existing design and interactions. The controller may update the served `app.js` and its HTML script-version reference after the tracked fix passes independent review. The version reference ensures a page reload bypasses the prototype's one-hour static-asset cache.

## Phase 1: Preserve, fix and verify

- [x] 1.1 Preserve the prototype browser assets under `docs/designs/remote-view/prototype/` with a synthetic API harness. Done when it runs without the machine-specific server or private data.
- [x] 1.2 Ignore server clock changes when deciding whether to repaint. Done when two otherwise identical poll responses retain the same thumbnail nodes.
- [x] 1.3 Add a browser regression for unchanged polls and meaningful changes. Done when it fails on the pre-fix code, passes after the fix, and a changed decision or progress is rendered.
- [x] 1.4 Independently review and verify the served prototype. Done when the original no-change polling loop retains its image nodes and the PR records the checked change and results.

## Human tasks

- [ ] H1 Refresh the prototype on the iPhone and confirm the clip grid no longer flashes while idle.
