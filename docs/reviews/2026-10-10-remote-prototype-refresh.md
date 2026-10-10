# Remote View prototype refresh regression — 2026-10-10

## Symptom and cause

The owner's iPhone recording showed a periodic clip-grid flicker in the separately served Remote View prototype. Browser observation retained zero of the initial thumbnail nodes after two 2.5-second polls. Consecutive `/api/project` payloads differed only in `server_time`. The full JSON comparison interpreted the changing clock as a Project change, and `render()` replaced `#app.innerHTML`.

The repair compares shallow copies with only `server_time` omitted. The complete response still becomes application data, and changed clip decisions still render. The tracked files are browser assets only; the local server, state, footage, cache and exports are excluded. This is distinct from the unfinished production Remote View implementation in PR #108/plan 041.

## Regression proof

The standalone command is `cd frontend && npm run test:e2e:remote-prototype`. The real prototype browser code runs against synthetic API payloads and neutral SVG thumbnails, using Playwright's clock to drive three actual polls.

- With the original machine-served `app.js`, the regression failed: captured thumbnail identity was false after timestamp-only polls.
- With the tracked repair, the regression passed in 1.6 seconds. It also verifies the connection sheet remains open and a remotely changed decision appears in Accepted/All.
- The controller corrected the test's capture point to occur after opening the connection sheet, because that explicit interaction already redraws the prototype. This keeps the assertion specific to idle polling.
- A dedicated config requires no backend process. The default app config excludes this spec to avoid using its different base URL; CI runs the dedicated command after browser installation.

Parent validation: frontend lint, typecheck/generated types and default test discovery passed. Worker build and JavaScript syntax/whitespace checks passed. The worker's browser launch was sandbox-blocked; the controller ran the actual red/green browser proof outside that sandbox. Machine-local proof logs are scratch, not committed artifacts.

## Independent review

A fresh Sol/high CLI reviewer checked Standards and Spec separately. Spec: no findings. Standards: one P2 finding that the plan index had not been regenerated; the controller resolves it with `scripts/plans.py sync` and verifies `scripts/plans.py check` before commit. The reviewer found the regression protects the real thumbnail-replacement symptom and meaningful data updates without test-only production exports. Existing prototype styling remains unchanged.

## Served verification

The controller applied the reviewed `app.js` and versioned HTML script reference to the running prototype, preserving backups first. The server caches static assets for an hour; the version query ensures reload requests the repaired script. No server restart or footage/state changes were required.

A live browser at the iPhone viewport (430×932) retained all four original thumbnail nodes over 8.1 seconds of polling: **4/4 retained, zero grid replacements**. The loaded script was `/app.js?v=20261010-refresh`. This checks the actual served app, but uses a desktop browser user agent; physical iPhone confirmation remains plan 043 H1. The dedicated synthetic browser regression also passed after the script-reference change (1 passed).
