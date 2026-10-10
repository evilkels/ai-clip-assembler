# 041: Remote View

The Editor opens `https://<mac>.<tailnet>.ts.net:8448/remote/` on their iPhone, over their own tailnet, pairs once with approval on the Mac, sends footage into a Project with verified resumable uploads, sees what the Mac is doing, reviews Candidate Clips with prepared previews, and gets Phone Exports (rendered MP4s, original or 9:16) back onto the phone for Instagram. Remote View is off by default, and one switch on the Mac blocks all phone access at once.

## Context

Owner request (2026-10-10). Remote View is not on the v1.0.0
[ROADMAP](../ROADMAP.md); The owner placed it before v1.0.0 as an experiment (H7). Each phase is one
PR and one delivery gate. A phase is done only when its physical-iPhone human
task passes.

Documents. Where they differ, the architecture spec decides internals and the
UX spec decides what the Editor sees. This plan decides order and scope.

- [UX spec](../specs/2026-10-10-remote-view-ux.md): screens, copy, connection
  states, accessibility.
- [Architecture spec](../specs/2026-10-10-remote-view-architecture.md):
  listener, Serve ownership, pairing and session lifetimes, tus uploads,
  integrity, persistence, previews, rendering, test gates. Sections are cited
  below as §n.
- [ADR 0010](../adr/0010-remote-view-over-tailnet.md) (Proposed; Accepted in
  1.20).
- [Mockup](../designs/remote-view/remote-view.html) with
  [light](../designs/remote-view/remote-view-light.png) and
  [dark](../designs/remote-view/remote-view-dark.png) renders.
- Related: [ADR 0001](../adr/0001-local-first-and-cloud-consent.md) and
  [ADR 0007](../adr/0007-ai-access-is-granted-when-connecting.md) (AI Access),
  [ADR 0002](../adr/0002-backend-authoritative-timeline.md) (Operations),
  [ADR 0003](../adr/0003-project-folder-persistence.md) (Project folders),
  [ADR 0004](../adr/0004-editable-export-and-edl-degradation.md) (Export). The
  2026-09-03 native-app research
  (`docs/research/2026-09-03-ios-react-native-feasibility.md`) was never
  committed. It is cited by name only.

### Decisions so far

- **Security over Tailscale comes first.** Exposure is `tailscale serve` only:
  dedicated HTTPS port **8448**, handler `/remote`, target
  `http://127.0.0.1:<remotePort>/<ingress>/`. The app never runs `tailscale
  funnel` or `tailscale serve reset`. It adds or removes only a handler it can
  prove is its own, and checks that every other Serve entry is unchanged
  (§2.2–2.3).
- **Port: 8448 by default, changeable; conflict refuses.** The owner's Mac
  already serves 8443, so the default is 8448. The Remote View panel has a Port
  field (stored in app settings; 1024–65535). If another app holds the chosen
  port or Funnel is on for it, enabling fails with "Remote View is off: port
  <port> is in use by another app. Nothing else was changed. Choose another
  port." (or "…has Funnel on…"). The app never picks or switches ports by
  itself. Elsewhere in this plan, read "8448" as "the configured port".
- **One Mac-side switch.** Settings → Remote View is off by default. Turning it
  off closes the gate in the backend first: every request fails and SSE and
  media streams end. Then sessions are dropped, the listener stops, and the
  owned Serve handler is removed. The same happens on quit, on Funnel or
  handler conflicts, on Tailscale account change, and when Electron dies (the
  lease is lost).
- **Separate remote listener** in the same backend process, with an explicit
  allow-list. It never forwards to the desktop API or MCP. The desktop API
  keeps its random loopback port and CORS (`api.py:98-114`) (§2.1).
- **Two gates**: the owner's exact `Tailscale-User-Login` **and** a Paired
  Device approved on the Mac. Identity headers alone never grant access
  (§2.4, §3).
- **Lease and control channel.** Electron spawns the backend with an extra
  pipe on fd 3. Newline-delimited JSON runs both ways: enable/disable,
  heartbeats, pairing codes, approvals, revocations, Project exposure and
  state events. EOF or 15 s without a heartbeat disables Remote View. Remote
  administration never goes over the unauthenticated desktop HTTP API.
- **"Show on phone" is per Project and off by default.** The list on the Mac
  shows the Recent Projects (folder Projects) from `projectRecents`. Exposure
  is stored in the remote store under the app's local data, keyed by the
  durable Project UUID, never in the Project folder. When an exposed Project is
  not open, the backend opens it on demand through the Project service.
  - This changes the UX draft's "Projects open in the app". The backend only
    knows Projects opened since it started, so after a restart the phone would
    see almost nothing.
- **Phone Exports are 1080p only.** Original aspect fits within 1920×1080 or
  1080×1920, and vertical is 1080×1920 (centre crop or fit). H.264 `yuv420p`,
  AAC-LC, `+faststart`. Rendered from the original Source Video, never the
  preview (§9.2).
- **Stitching covers only the Edit**: the Timeline Document in Timeline order,
  captured at its revision. Stitching an arbitrary selection is not planned.
- **No raw-footage fallback for previews.** A preview that is pending shows
  "Preparing preview…"; a failed one shows the error and Try again (§8.1).
- **Accept/Reject from the phone** use the existing `include` / `exclude` /
  `reset_decision` Operations, with a required expected revision. Undo from the
  phone re-applies the previous decision at the returned revision. It never
  calls Timeline undo, which could pop a desktop edit.
- **Copy follows the glossary and ADR 0007.** The phone never says "harness",
  "consent", "Pi" or "review model". The phone cannot change AI Access or a
  Project's AI: On / Off.

### What current main already has (verified on `e147618`)

These corrections replace the stale draft's claims:

- **The desktop Review Board already uses Operations.** `ReviewContext.tsx`
  `include`/`exclude`/`resetDecision` (lines 480-509) call
  `applyTimelineOp` → `POST /timeline/op` (`api.py:1046`). Decisions live in
  `TimelineDocument.decisions` with Undo History. The desktop already
  live-syncs from `/projects/{id}/events` (`ReviewContext.tsx:294`,
  `api.py:1095`).
  - What remains: decision Operations do not send `expected_revision`
    (optional in `timeline_ops.py:432`), and the commit is in memory before
    persistence (`_commit`, `timeline_ops.py:436`). The persistence error is
    then swallowed (`_write_timeline_for_project`, `api.py:995`).
  - `PUT /projects/{id}/timeline` (`api.py:760`) is no longer called by the
    renderer, only by e2e fixtures and `test_api.py`. It stays desktop-only,
    is never on the remote listener, and gets the revision rule in 2.6.
- **Settings is a modal**, not a page: `SettingsModal.tsx`, with panels `ai`,
  `connections`, `diagnostics` and `general`. Remote View is a new panel
  there. Plan 038 will reshape the AI panels. Remote View touches only its own
  panel and the panel list.
- **The glossary is `GLOSSARY.md`.** There is no `CONTEXT.md` or
  `UBIQUITOUS_LANGUAGE.md`.
- **The manifest is still schema v1.** It has `filename` and `imported_at`
  only (`project_store.py:61-95`), and Source Video `file_id` = filename
  (`api.py:1680-1703`). Plan 038 task 4.3 also bumps `PROJECT_SCHEMA_VERSION`
  (to 2, for `ai_enabled`), so 1.3 takes the next free version.
- **`from-folder` mints a fresh runtime ID on every open** (`api.py:270`), so
  the same folder opened twice gets two controllers.
- **Direct `write_text` writes**: `project_store.py:198, 256, 287, 314, 384`
  and `app_settings.py:88`. `persist_project_results` (`api.py:1804`) and
  `_write_timeline_for_project` (`api.py:995`) log and swallow `OSError`.
- **Electron spawns the backend only when packaged.**
  `startPackagedBackend` (`index.ts:320`, spawn at `:349`) returns early in
  dev, and dev uses `npm run dev:backend` on port 8000. The control channel
  therefore needs a dev spawn path (1.12).
- **Other code the plan depends on**:
  - Range utilities: `ranged_video_response` / `iter_file_range` /
    `parse_byte_range` at `api.py:1724-1794`.
  - Frame Samples by timestamp: `timestamped_frame_paths` at `api.py:1122`,
    plus a poster route at `api.py:470`.
  - Analysis progress is in memory and polled (`api.py:490-510`). It starts at
    `api.py:512` (blocking) and cancels at `api.py:607`.
  - Export writes NLE documents only (`api.py:1408`).
- **Packaging and CI**:
  - electron-builder copies `out/**` into the asar, which the Python backend
    cannot read. The remote UI therefore ships as an `extraResources` folder
    (1.14).
  - CI installs only Chromium for Playwright (`.github/workflows/test.yml:93`).
  - The probe reads rotation (`video_probe.py:35`) but not HDR transfer (2.2).

### How to run things

- **Backend tests**: `cd frontend && npm run test:backend`. This runs
  `PYTHONPATH=. .venv/bin/python -m pytest` in `backend/`. Lint with
  `npm run lint`.
- **Electron main tests**: `cd frontend && npm run test:main`. This runs
  `node --test` over `tests/main/*.test.ts`, compiled by
  `tsconfig.main-tests.json`.
- **Typecheck**: `npm run typecheck`. It fails if `types/generated.ts` is stale
  against `backend/src/models.py`; regenerate with `npm run gen:types`.
- **Playwright**: `cd frontend && npm run test:e2e`, or
  `npx playwright test --project=remote-iphone` for the phone suite (after
  1.18).
  - Playwright starts the backend on 8000 and the renderer on 5173, with
    `workers: 1`.
  - First run: `npx playwright install chromium webkit`.
  - macOS screenshot baselines are created locally. Linux ones come from
    `.github/workflows/update-linux-baselines.yml`.
- **Dev app with Remote View**: `npm run dev:remote` (1.12). The plain
  `npm run dev` + `npm run dev:backend` flow has no control channel, so Remote
  View shows "Available when the app starts its own backend".

### Later (not in this plan)

- Start and cancel analysis from the phone.
  - A job service extracted from `api.py:512-621` returns `202` and a job ID.
  - It uses the Mac's saved scoring choice and AI: On / Off. The gate from
    plan 038 is rechecked when the run executes; pairing never grants AI
    Access.
  - The phone shows "rule-based" or the Provider name.
  - Until then, Phase 1 ships the "Analyze after upload" control disabled,
    with "start on the Mac".
- Light Timeline on the phone: reorder/remove Operations with revisions, and
  an NLE Export trigger.
- Web Push "Ready on Mac" for Home Screen installs, opt-in, with the UX spec's
  privacy sentence.
- A Lite 480p preview, only if H4 shows 720p stalls on a relayed path.
- Full-resolution Phone Exports.
- Retiring `PUT /projects/{id}/timeline` and the legacy upload Projects.

## Phase 1: Secure connection, verified upload, see what the Mac is doing

- [x] 1.1 Add `backend/src/durable_io.py` with `write_text_atomic(path, text)` and route every JSON write through it. Done when `backend/tests/test_durable_io.py` makes `os.fsync` and `os.replace` raise and shows the previous file byte-identical, no temp file left behind and the error raised, and `test_project_store.py` and `test_app_settings.py` pass.
  - The write goes to a sibling temp file, then write, flush, `os.fsync` (`fcntl.F_FULLFSYNC` on macOS when available), `os.replace`, and an fsync of the parent directory. Errors propagate (§6.2).
  - Callers: `project_store.py` `write_project_manifest` (:197), `write_analysis_results` (:256), `write_frame_scores` (:287), `write_review_session` (:314), `write_timeline_document` (:384), and `app_settings.py:88`.
- [x] 1.2 Commit before acknowledging. Done when `test_timeline_ops.py` and `test_timeline_service.py` show a raising writer leaves `document`, `revision`, the undo stack and the redo stack unchanged and publishes no event, and `test_api.py` shows `POST /timeline/op` returns 500 with "Couldn't save the Timeline" in that case.
  - `TimelineController` takes a `persist(document)` callable. `apply`, `apply_batch`, `undo` and `redo` (`timeline_ops.py:451-516`) call it inside the lock, before `self._document` is replaced. Only then do they publish.
  - `TimelineLifecycle._make_on_change` (`timeline_service.py:131`) becomes publish-only.
  - `_write_timeline_for_project` (`api.py:995`) and `persist_project_results` (`api.py:1804`) raise instead of logging. Every route that calls them maps the error to a 500 with a plain message.
- [x] 1.3 Migrate the Project manifest to the next free `PROJECT_SCHEMA_VERSION` (2, or 3 if plan 038 task 4.3 landed first). Done when `test_project_store.py` opens a saved v1 fixture and gets UUIDs that survive close and reopen, a manifest newer than supported is refused with "This Project was saved by a newer version of the app", and rescan keeps UUIDs and provenance for files still present.
  - Add `ProjectManifest.project_uuid`. `ProjectSourceVideo` gains `source_uuid`, `size_bytes`, `sha256: Optional[str]`, `fingerprint {size, mtime_ns, inode}` and `provenance: Optional[UploadProvenance]` (fields per §4.2).
  - Older versions load, get UUIDs, and are rewritten atomically when the folder is writable.
  - The desktop `file_id` stays the filename (`api.py:1680`). Remote routes expose only `source_uuid`.
- [x] 1.4 Add `backend/src/project_service.py`: one owner per canonical Project root. Done when tests show the same folder opened through a symlink returns the same `project_id`, a rescan and an ingest committing from two threads both survive in the manifest, and a second process holding the folder gets 409.
  - `create_project_from_folder` (`api.py:245`) returns the existing runtime `project_id` when `Path.resolve()` of the folder is already open, instead of minting a new one at `:270`.
  - A `threading.RLock` per Project serializes state transitions only, never network I/O or FFmpeg: rescan (`api.py:365`), consent/AI writes (`api.py:297`), selected harness (`api.py:324`), analysis result persistence, delete files (`api.py:392`), and later ingest and render snapshots.
  - An OS lock (`fcntl.flock(LOCK_EX | LOCK_NB)` on `clipassembler/.lock`, held while the Project is open) refuses a second backend: 409 "This Project is open in another copy of the app".
  - `open_for_remote(project_uuid, folder)` opens an exposed Project that is not open yet.
- [x] 1.5 Add `backend/src/remote/store.py` and `remote/auth.py`: owner policy, pairing tokens, pending approvals, Paired Devices, active sessions, CSRF tokens, rate limits and Project exposure. Done when `backend/tests/test_remote_auth.py` with a fake clock covers every lifetime row in §3.3, rotation on renewal, Disconnect, Revoke and Revoke all, and the rate limit, and asserts no raw token or cookie value appears in any file under the store directory.
  - Records live under `.ai-clip-assembler/remote/`. That path is relative to the backend cwd, which is Electron `userData` when packaged. Directory mode is 0700, file mode is 0600, and writes go through `write_text_atomic`.
  - Only SHA-256 hashes of tokens are stored. Active sessions live in memory only, so they end on disable or quit.
  - Lifetimes: pairing token single use for 5 min; active session 15 min idle; device credential 30 days unused or 90 days absolute, rotated on renewal.
  - Rate limits: 5 failed pairings per identity per 10 min, and 30 per 10 min globally.
  - Exposure: `{project_uuid: {folder_path, shown}}`, with `shown` false by default.
- [x] 1.6 Add `backend/src/remote/app.py`, a separate FastAPI app with an ordered gate, and the Phase 1 routes. Done when `backend/tests/test_remote_gate.py` shows the cases below.
  - Gate order:
    1. Lease active, else 503 `{"reason": "remote_off"}`.
    2. Path starts with the current ingress segment, else a bare 404.
    3. Exactly one well-formed `Tailscale-User-Login` equal to the owner (decode RFC 2047 if present), and no `Tailscale-Funnel-Request`.
    4. Session cookie `__Host-aca_session` or device cookie `__Host-aca_device`. Failures return 401 with `reason` ∈ `never_paired|disconnected|revoked|expired`.
    5. For mutations: `X-CSRF-Token` and exact `Origin == public_origin`.
    6. Project exposure.
    7. Resource ownership.
  - Routes, public prefix `/remote`:
    - `GET /api/health`: no auth, returns `{ok, instance}` and never the ingress.
    - Pairing and session: `POST /api/pair`, `GET /api/pair/{pendingId}`, `POST /api/session/renew`, `POST /api/disconnect`, `GET /api/me` (returns the CSRF token, device label, owner, Mac name and path).
    - Projects: `GET /api/projects` and `GET /api/projects/{id}`.
    - Events: `GET /api/projects/{id}/events` (1.10).
    - Uploads (1.8–1.9).
  - Static UI comes from `CLIP_ASSEMBLER_REMOTE_UI_DIR`, mounted after the API routes. An unknown `/api/*` path returns JSON 404, never the SPA HTML.
  - Headers: CSP `default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; frame-ancestors 'none'`, plus `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` on API and media, and no CORS middleware.
  - Redirects, tus `Location` and SSE URLs are built from `public_prefix="/remote"`, never from the ingress path.
  - DTOs go in `backend/src/models.py` so `npm run gen:types` emits them for the phone.
  - Test cases for the done criterion:
    - Missing, other, duplicate or Funnel-marked identity is refused.
    - A forged owner header without a session gets 401.
    - A stale ingress gets 404.
    - `/mcp`, `/projects/from-folder`, `/settings`, `/projects/{id}/files`, `/projects/{id}/timeline` and `/projects/{id}/analyze` get 404 on the remote app.
    - A mutation without CSRF, with `Origin: null` or with a wrong port gets 403.
    - An unexposed Project gets 404.
    - The headers above are present.
- [x] 1.7 Add `backend/src/remote/lifecycle.py` and the fd-3 control channel in `backend/packaging/entry.py`. Done when `backend/tests/test_remote_lifecycle.py` starts `packaging/entry.py` as a subprocess with `pass_fds` and shows the cases below.
  - When `CLIP_ASSEMBLER_CONTROL_FD` is set, a reader thread handles these messages:
    - `enable {owner_login, public_origin, mac_name}`: start a second `uvicorn.Server` for the remote app on `127.0.0.1:0` in the running event loop, mint a new ingress (32 random bytes, base64url), reply `{remote_port, ingress, instance}`.
    - `heartbeat` (every 5 s; the lease expires after 15 s).
    - `disable`.
    - `new_pairing_code`, which replies `{token, expires_at}`.
    - `approve` / `deny {pending_id}`.
    - `revoke {device_id}` / `revoke_all`.
    - `set_exposure {folder_path, shown}`: refused unless the folder has a manifest.
    - `get_state`.
  - Backend → main events: `pending_pairing`, `sessions_changed`, `state`.
  - Disable, lease expiry and EOF all do the same, in order: close the gate (every request gets 503 from then on), end SSE and media streams, stop transfers at chunk boundaries, drop sessions, stop the listener (§10).
  - Without the env var, `enable` is impossible.
  - Test cases for the done criterion:
    - Enable, then `/api/health` answers via the ingress.
    - `disable` makes the next request 503 at once and refuses the port within 1 s.
    - Closing the pipe and stopping heartbeats each disable within 16 s.
    - Re-enable mints a new ingress and the old one gets 404.
- [ ] 1.8 Add `backend/src/uploads/service.py` and `uploads/store.py` for tus transfers. Done when `backend/tests/test_uploads_tus.py` covers the cases below.
  - Supported: tus 1.0 core, `creation`, `checksum` (advertise `sha1,sha256`), `expiration` and `termination`, on the §5.2 wire contract.
  - Routes: `OPTIONS/POST /api/projects/{id}/uploads`, `HEAD/PATCH/DELETE /api/projects/{id}/uploads/{uploadId}` and `GET /api/projects/{id}/upload-status/{uploadId}`.
  - Staging is `clipassembler/cache/uploads/<id>/{record.json,data.part}`, refused if it resolves outside the Project through a symlink.
  - Metadata (filename, type, size, client `lastModified`) is validated once at creation and then frozen. Creation takes an idempotency key.
  - The PATCH steps in §5.3 apply, with 4 MiB chunks and an 8 MiB ceiling.
  - Limits from §6.4: 50 GiB per file; one active transfer per device and two per Mac; 10 unfinished uploads per device; free space of max(5 GiB, 10%) with a reservation ledger.
  - Failure codes: 507 on `ENOSPC` without advancing the offset, 409 offset mismatch, 460 checksum mismatch, 412/415, and 410 tombstones after 7 days. An upload belongs to its Paired Device.
  - Test cases for the done criterion:
    - Only acknowledged chunks survive an interrupted PATCH (crash injection after the write, fsync and checkpoint steps).
    - A lost creation response retried with the same key returns the same upload.
    - A checksum mismatch leaves the offset unchanged.
    - `ENOSPC` leaves a valid checkpoint.
    - Another Paired Device gets 404 for a known upload ID.
    - Expiry removes only app-owned paths and leaves a tombstone.
    - Revoke releases reservations.
- [ ] 1.9 Finalize, publish and deduplicate (after 1.8). Done when `backend/tests/test_uploads_finalize.py` covers the cases below.
  - `POST /api/projects/{id}/uploads/{uploadId}/finalize {sha256, idempotency_key}` runs the §6.1 transaction through the Project service:
    1. Reread the file from disk and hash it.
    2. Compare against `Upload-Length` and the phone's SHA-256.
    3. Run `probe_video`.
    4. Under the Project lock: deduplicate by size + SHA-256 (§6.3), reserve a collision-safe name (`IMG_1234-phone-<short-id>.mov`), and journal the intent.
    5. Publish to the Project root with no-replace semantics (`os.link`, then unlink the staging file).
    6. Flush the directory, commit the manifest, write the receipt to `clipassembler/ingest/receipts/`, refresh the runtime `videos` projection (`videos_from_manifest`, `api.py:1680`), and publish `sources-changed`.
  - On Project open, recovery finishes or rolls back journaled publications. Until then the upload reports `recovery_pending`.
  - Test cases for the done criterion:
    - Crash injection after each journal, publish, flush, manifest and receipt step recovers to exactly one Source Video.
    - A whole-file mismatch never publishes.
    - An existing same-name file is never overwritten.
    - Duplicate content returns the existing `source_uuid` with an extra receipt.
    - A lost finalize response replays the receipt.
    - A desktop rescan racing a publish keeps both.
    - Revoke during `publishing` does not interrupt the publication.
- [ ] 1.10 Add Project events and remote status (after 1.4). Done when `backend/tests/test_project_events.py` shows the cases below, and `e2e/import-workflow-redesign.spec.ts` (or a new stubbed spec) shows the source list refreshing on `sources-changed`.
  - Generalise `TimelineEventBroker` (`timeline_service.py:32`) into a Project event broker with thread-safe publish (`loop.call_soon_threadsafe`).
  - `set_analysis_progress` (`api.py:490`) publishes `analysis-progress`, throttled to 1 per second plus every phase change. Ingest publishes `sources-changed`. `timeline-changed` stays as is.
  - The desktop `/projects/{id}/events` (`api.py:1095`) carries all three. The renderer refreshes the source list on `sources-changed`.
  - The remote `GET /api/projects/{id}/events` sends these events as remote DTOs, `: ping` every 15 s, and a final `remote-off` or `revoked` event before closing. Each device has a bounded queue; a slow consumer is dropped and refetches.
  - Remote `GET /api/projects/{id}` returns the "Now on the Mac" summary: idle, analyzing with phase and percent, or failed with the Mac's message. It also returns source count, clip count and last-analyzed time.
  - Test cases for the done criterion:
    - An analysis thread's progress reaches a remote subscriber.
    - Revoke closes that device's stream with `revoked`.
- [ ] 1.11 Add `frontend/src/main/tailscaleCli.ts` and `frontend/src/main/remoteViewController.ts` for Serve ownership. Done when `frontend/tests/main/remoteViewController.test.ts` runs against a fake CLI and shows the cases below.
  - Locate the CLI in order: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, `/opt/homebrew/bin/tailscale`, `/usr/local/bin/tailscale`. Run it with `execFile`, fixed argv and a 10 s timeout.
  - From `status --json`: `BackendState === "Running"`, `Self.DNSName` without the trailing dot, and the owner login from `User[Self.UserID].LoginName`.
  - Preflight from `serve status --json`: refuse if `<host>:8448` has any handler except one matching the owner record, or `AllowFunnel["<host>:8448"]` is true. Use the 1.2 copy.
  - Add with `serve --bg --https=8448 --set-path=/remote http://127.0.0.1:<port>/<ingress>/`. Record `{host, port: 8448, mount: "/remote", target}` in `userData/remote-view/serve-owner.json`.
  - Re-read the config. If anything outside our handler changed, remove ours and report a conflict.
  - Remove with the same flags plus `off`, and only when the live handler equals the record.
  - Watch every 5 s while enabled. Funnel on, target changed, another handler on 8448, or a different owner login → disable (backend first) and report the conflict. Re-enabling is a deliberate user action.
  - The argv builder exports only `status`, `serve status`, `serve add` and `serve off`. The test asserts no path can produce `reset` or `funnel`.
  - The fake CLI is `tests/main/fixtures/fake-tailscale.mjs`: Serve state in a temp JSON file, with every argv logged.
  - Test cases for the done criterion:
    - Enable then disable leaves unrelated entries byte-identical.
    - 8448 held by another target → refused with the conflict copy.
    - Funnel on 8448 → refused.
    - Funnel turned on mid-session → disabled, and only our handler removed.
    - A replaced handler is not removed.
    - A stale owned handler from a crashed run is removed by the startup sweep.
    - The logged argv never contains `reset` or `funnel`.
- [ ] 1.12 Wire Electron main (after 1.7, 1.11). Done when `frontend/tests/main/remoteControlChannel.test.ts` shows the cases below, and `npm run dev:remote` serves `/api/health` on the loopback remote port.
  - In `startPackagedBackend` (`index.ts:320`), spawn with `stdio: ['pipe','pipe','pipe','pipe']`. Set `CLIP_ASSEMBLER_CONTROL_FD=3` and `CLIP_ASSEMBLER_REMOTE_UI_DIR` (`process.resourcesPath/remote-ui` when packaged, `frontend/out/remote` in dev).
  - Add `npm run dev:remote`, which sets `CLIP_ASSEMBLER_SPAWN_DEV_BACKEND=1`. Main then spawns `../backend/.venv/bin/python packaging/entry.py` with cwd `backend/` and `PYTHONPATH=.`, on a `findFreePort()` port, and passes the URL through `--clip-assembler-backend-url=` like the packaged path.
  - A control-channel client in main handles heartbeats and resolves requests.
  - The `before-quit` handler (`index.ts:492`) disables Remote View and removes the owned handler before `stopPackagedBackend`.
  - The startup sweep runs after `cleanupStaleBackend` (`backendLifecycle.ts:204`, called at `index.ts:338`).
  - IPC `remote-view:get-state|enable|disable|new-code|approve|deny|revoke|revoke-all|set-exposure|set-keep-awake` checks `assertApplicationSender` (`index.ts:126`). The preload bridge gets matching methods.
  - "Keep this Mac awake" is on by default, stored in `userData/remote-view/prefs.json`, and runs `powerSaveBlocker.start('prevent-app-suspension')` while enabled.
  - With no app-managed backend, the state is `unavailable: "backend-not-managed"`.
  - Test cases for the done criterion:
    - EOF from a fake backend marks Remote View off.
    - Heartbeats are sent every 5 s.
    - IPC from a non-app sender is rejected.
- [ ] 1.13 Add the Settings → Remote View panel and the header indicator (after 1.12). Done when the stubbed-bridge `e2e/settings-remote-view.spec.ts` shows the cases below.
  - `RemoteViewPanel.tsx` goes in the panel list of `SettingsModal.tsx`, following UX §9 and the mockup's Mac panel:
    - Toggle, off by default, with the UX copy.
    - Live URL with port.
    - Five-step readiness line: installed, signed in as …, certificate ready, port 8448 free and Funnel off, serving.
    - Certificate and serving are proven by main fetching `https://<host>:8448/remote/api/health` and matching `instance`, retrying for up to 2 min and showing "certificate provisioning…" while it retries.
    - Conflict state.
    - QR, only when serving is ready.
    - "works once · expires in m:ss" with **New code**.
    - Approve/Deny rows.
    - **Show on phone**: Recent Projects, unchecked by default, with missing folders disabled.
    - Paired devices: label, login, approved date, last seen, connected dot, path, **Revoke**, and **Revoke all** below.
    - **Keep this Mac awake**.
  - Main renders the QR with the `qrcode` npm package (`toString(url, {type: 'svg'})`), with no network access. The URL is `https://<host>:8448/remote/#pair=<token>`.
  - `layouts/ProjectHeader.tsx` shows "Remote · n" while n ≥ 1 sessions are live. Clicking it opens Settings → Remote View.
  - Test cases for the done criterion:
    - Off by default.
    - The "Install Tailscale and sign in" step copy.
    - The port-8448 and Funnel conflict copy.
    - QR and countdown.
    - Approve and Deny call the bridge.
    - Show on phone toggles persist.
    - Revoke.
    - The header indicator with one device.
- [ ] 1.14 Scaffold and package the phone entry `frontend/src/renderer/remote/`. Done when `npm run build` writes `out/remote/index.html` with assets under `/remote/`, `npm run lint` and `npm run typecheck` pass, and `test_remote_gate.py` fetches the built `index.html` through the gate.
  - Files: `index.html`, `main.tsx`, `App.tsx`, `api.ts` (relative `/remote/api`, CSRF header, typed from `types/generated.ts`), `styles.css` importing `../src/styles/tokens.css`, a web manifest and an apple-touch icon from `assets/`.
  - Add `frontend/vite.remote.config.ts` (root `src/renderer/remote`, `base: '/remote/'`, `outDir: 'out/remote'`, alias `@` as in `vite.renderer.config.ts`).
  - Scripts: `build:remote`, which `build` runs after `electron-vite build`, and `dev:remote-ui`.
  - electron-builder `extraResources`: `{from: "out/remote", to: "remote-ui"}`.
  - An ESLint `no-restricted-imports` rule for `src/renderer/remote/**` forbids `src/main`, `src/preload`, `@/api/client` and `window.clipAssembler`.
  - Shared components are only those with no desktop bridge use, e.g. `ScoreChip`.
- [ ] 1.15 Build the Pair flow, connection states and the Connection sheet (after 1.14). Done when 1.18's spec drives pairing, approval, every reason banner, Disconnect, and the off and unreachable states.
  - Follow UX §1, the connection-state table and §8.
  - Read `#pair=` and immediately call `history.replaceState`. Pair, then poll "Approve on your Mac".
  - Reason banners come from the 401 `reason`. `navigator.standalone` gives the Home Screen copy.
  - The status pill is on every screen. Connected = SSE open or a request succeeded within the last 5 s.
  - Back-off reconnect; re-sync on `visibilitychange` and `online`.
  - Connection sheet: Mac name, device label, since, path (Direct/Relayed from main's `tailscale status --json` peer data via `get_state`), "Your tailnet only, never public · signed in as …", one-tap **Disconnect this phone**, and the pending-decision count (Phase 2).
  - The Add to Home Screen card is offered once.
- [ ] 1.16 Build the Projects and Project screens with "Now on the Mac" and Footage (after 1.10, 1.14). Done when 1.18's spec shows an exposed Project listed, an unexposed one absent, the empty copy, and the card moving idle → analyzing n% → complete from shim-driven progress.
  - Follow UX §2–3 without the Clips section. That arrives in 2.7.
  - The card is `aria-live="polite"`. Mark a value "as of n s ago" when no update arrives for 5 s.
  - The Footage list shows name, duration, size and in-flight upload state.
  - "Analyze after upload" is shown disabled with "start on the Mac".
- [ ] 1.17 Build the Add footage client (after 1.8, 1.9). Done when `frontend/tests/main/remoteUploadMachine.test.ts` covers the cases below and 1.18's upload spec passes.
  - `remote/upload/` contains:
    - `uploadMachine.ts`, a pure state machine with the UX §7 states.
    - `tusClient.ts`, an in-repo tus client: POST, HEAD, PATCH with `Upload-Checksum: sha256 <base64>` from Web Crypto over each 4 MiB slice, and finalize.
    - `hashWorker.ts`, incremental SHA-256 in a Web Worker using `@noble/hashes/sha256`, fed each slice exactly once.
    - `resumeStore.ts`: IndexedDB records with IDs and metadata only, never file bytes.
  - One file at a time, with Wake Lock as best effort.
  - A paused upload shows "paused — return to resume".
  - Reselection: verify the prefix against the server's chunk receipts. On a mismatch, show "This isn't the same file as before" with **Send as new**.
  - Show **Imported and verified** only when the receipt's SHA-256 equals the phone's.
  - Test cases for the done criterion:
    - 409 → HEAD → resume at the server offset.
    - 460 → resend the chunk.
    - A lost finalize response → replay.
    - Reselect with a matching or a different prefix.
    - A receipt digest mismatch → failed and never "imported".
- [ ] 1.18 Add the Playwright phone harness. Done when `npx playwright test --project=remote-iphone e2e/remote-pair-upload.spec.ts` passes locally and in CI and shows the cases below.
  - `backend/tests/remote_serve_shim.py` mimics Serve:
    - It serves HTTPS on `localhost:18443` with a throwaway self-signed certificate made by `openssl req -x509` in a temp directory. It never uses 8448, so it cannot collide with a real Serve on a dev Mac.
    - It strips `/remote` and prepends the ingress, and injects `Tailscale-User-Login: owner@example.test`.
    - It runs the backend app plus the remote app with an in-process lease, and seeds a fixture folder Project, exposed, with synthetic `.mov` files made by `ffmpeg -f lavfi` at startup.
    - Shim-only test routes under `/__test/` (approve pending, revoke, disable, drop the next response after commit, push fake analysis progress) exist only in the shim process.
  - `playwright.config.ts`:
    - New project `remote-iphone`: `{...devices['iPhone 15'], baseURL: 'https://localhost:18443', ignoreHTTPSErrors: true}` with `testMatch: /remote-.*\.spec\.ts/`. The chromium project gets the matching `testIgnore`.
    - A third `webServer` runs `npm run build:remote && cd ../backend && PYTHONPATH=. .venv/bin/python -m tests.remote_serve_shim --port 18443`.
  - `.github/workflows/test.yml:93` installs `chromium webkit`. The `frontend/e2e/README.md` table gains the new specs.
  - Test cases for the done criterion:
    - Pair and approve.
    - Three uploads, with one dropped PATCH response and one mid-chunk abort, all reach "imported · verified", and the manifest lists each file once.
    - The fake analysis progress shows on the card.
    - Disconnect, revoke and disable each land on the right screen and banner.
- [ ] 1.19 Add phone screenshots with the iPhone profile: `e2e/remote-view-screens.spec.ts` in the `remote-iphone` project. Done when macOS baselines are committed locally, Linux baselines are produced by the workflow, and both runs pass.
  - Screens: Pair, Approve on your Mac, Projects (list and empty), Project idle and analyzing, Add footage with sending / paused / verifying / imported / failed rows, the Connection sheet, Remote View off, and Can't reach.
  - `toHaveScreenshot` with `colorScheme` light and dark.
  - `.github/workflows/update-linux-baselines.yml` installs webkit and runs this spec too. Phases 2 and 3 add their screens to the same spec.
- [ ] 1.20 Update docs and terms. Done when every new link resolves and `python3 scripts/plans.py check` passes.
  - `GLOSSARY.md`: add **Remote View**, **Paired Device** and **Mac Job**, defined as in the UX spec's Terms.
  - `docs/USER_GUIDE.md`: a "Remote View (iPhone)" section.
  - `docs/TROUBLESHOOTING.md`: no Tailscale, certificate provisioning, port 8448 conflict, Funnel conflict, paused uploads, and "Available when the app starts its own backend".
  - `docs/ARCHITECTURE.md`: the remote listener and control channel.
  - `SECURITY.md`: the Remote View boundary and the stated local-process limitation (§2.4).
  - ADR 0010 → Accepted, with its README entry updated.
  - `docs/PRD.md`: the local-first line becomes "no footage leaves the Editor's own devices", and the "mobile app" out-of-scope line is narrowed to native apps.

## Phase 2: Prepared previews and revision-safe review on the phone

- [ ] 2.1 Move range serving into `backend/src/media/serving.py`. Done when `backend/tests/test_media_serving.py` checks exact bytes and headers for an explicit range, an open range, a suffix range, 416, HEAD, If-Range match and mismatch, and If-None-Match, and the existing desktop media tests in `test_api.py` pass unchanged.
  - Move `ranged_video_response`, `iter_file_range` and `parse_byte_range` from `api.py:1724-1794`.
  - Add HEAD, strong ETags (from the content SHA-256 when known, else size + mtime_ns), `If-Range` and `If-None-Match`, keeping the existing 416 shape.
  - The desktop `/videos/{id}/media` route (`api.py:444`) uses the module. Remote media adds `Cache-Control: private, no-store` and authorization on every request, including Range requests.
- [ ] 2.2 Probe HDR and FFmpeg capabilities. Done when tests with fake runner output cover HLG, PQ and SDR iPhone streams and a build without `zscale`.
  - `video_probe.py` adds `color_transfer`, `color_primaries` and `is_hdr` (`arib-std-b67`, `smpte2084`) to `VideoMetadata` (`models.py:11`), then regenerates types.
  - Add `backend/src/media/capabilities.py`, modelled on `ffmpeg_supports_vidstab` (`motion_analysis.py:50`). It detects `zscale` + `tonemap`, `libx264` or else `h264_videotoolbox`, and `aac`.
  - An HDR source on a build without tone mapping fails with "This Mac's video tools can't convert HDR footage". It never falls back to raw footage.
- [ ] 2.3 Add `backend/src/jobs.py` as a single heavy-work queue and `backend/src/media/renditions.py` for lazy previews. Done when `backend/tests/test_renditions.py` (real FFmpeg on synthetic sources, skipped with a reason if `ffmpeg` is absent; CI has it) covers the cases below.
  - One heavy FFmpeg job runs at a time, de-duplicated by key and cancellable. Phase 3 adds durable job records.
  - Preview recipe per §8.1: H.264 `yuv420p` within 1280×720 or 720×1280, ≤30 fps, about 2.5 Mbps with a ceiling, AAC-LC, rotation baked in, SDR, `+faststart`. The clip is cut to the Candidate Clip's bounds.
  - Key = SHA-256(source SHA-256 + normalized recipe + renderer version).
  - Desktop sources without a hash are hashed in the queue, and the hash is stored through the Project service. A changed `fingerprint` forces a rehash.
  - Render to a temp file, check it with ffprobe, then publish atomically to `clipassembler/cache/proxy/<key>.mp4`.
  - Opportunistically prepare the next 3 visible clips after an explicit request.
  - Cache budget 10 GiB per Project, LRU, 30 days unused. Never evict active responses, queued jobs or upload staging.
  - Test cases for the done criterion:
    - A cache hit runs no FFmpeg.
    - Two concurrent prepares run one FFmpeg.
    - A changed source gets a new key.
    - Missing FFmpeg gives a `failed` state with a message, and no route returns source bytes.
    - The eviction order is correct.
- [ ] 2.4 Serve thumbnails at `GET /api/projects/{id}/clips/{clipId}/thumbnail`. Done when tests cover the reuse and generate paths and a path-traversal attempt via clip ID.
  - Reuse the nearest Frame Sample via `timestamped_frame_paths` (`api.py:1122`).
  - Otherwise generate a 360 px JPEG at `clipassembler/cache/thumbnails/<key>.jpg` through the queue.
  - Resolve only by ID, never by path.
- [ ] 2.5 Add the remote clip routes. Done when `backend/tests/test_remote_clips.py` covers the cases below.
  - `GET /api/projects/{id}/clips`: opaque clip ID, `source_uuid`, bounds, duration, Overall Score, score chips, Look Group, Clip Reason, decision, display aspect from `display_resolution`, and the document revision.
  - Preview: `POST …/clips/{clipId}/preview` returns 202 with a state. `GET …/clips/{clipId}/preview` returns a JSON state until ready, then the media through `media/serving`.
  - `POST …/clips/{clipId}/decision {decision: "accept"|"reject"|"reset", expected_revision}` maps to `include` / `exclude` / `reset_decision` through the shared controller. A missing revision gets 422. A stale one gets 409 with the authoritative snapshot (`_revision_conflict_detail`, `api.py:1030`).
  - Test cases for the done criterion:
    - Accept, reject and reset round-trip.
    - A stale revision gets 409 and leaves the document unchanged.
    - A failed persist gets 500 and publishes no event.
    - An unexposed Project gets 404.
    - The preview never answers with source bytes.
- [ ] 2.6 Make the desktop use revisions too. Done when `test_api.py` covers the cases below, and the updated e2e specs pass.
  - In `ReviewContext.tsx`, `include` / `exclude` / `resetDecision` (lines 480-509) go through a serialized op queue that sends `documentRef.current.revision`. On 409, reconcile and show "Changed on your phone — showing the latest."
  - `POST /timeline/op` requires `expected_revision` for `include`, `exclude` and `reset_decision` (422 otherwise).
  - Every document replacement must yield a revision strictly greater than the previous live one, so a stale phone revision can never match by accident. Replacements: `/draft` (`api.py:788`), `/clips/rederive` (`api.py:854`), analysis completion, and `PUT /timeline` (`api.py:760`).
  - Update the e2e fixtures that post Operations without a revision.
  - Test cases for the done criterion:
    - A missing revision gets 422.
    - A stale one gets 409.
    - The revision rises across draft, rederive and `PUT /timeline`.
- [ ] 2.7 Build the Clips grid and Clip player (after 2.5). Done when 2.9's spec covers the grid, the player and Accept.
  - Follow UX §3 (Clips section) and §4:
    - Tabs `Candidates · Accepted · All` and sort `Score · Time · Length`.
    - Cells take the source aspect, with skeletons and no reflow.
    - `<video playsinline>` loops within the clip bounds, with a timecode line.
    - Score chips through the shared `ScoreChip`, the Look Group hint and the Clip Reason.
    - "Preparing preview…" over the poster, then autoplay. On failure, show "Couldn't prepare a preview: <reason>" with **Try again**.
    - Swipe and ‹ › navigation.
    - Accept/Reject are optimistic. In Candidates the view advances to the next card. Undo stays for 5 s.
  - VoiceOver labels follow the UX accessibility section.
- [ ] 2.8 Add the offline decision queue. Done when `remoteDecisionQueue.test.ts` (test:main) covers the cases below.
  - At most 20 queued decisions are replayed in order with revisions. A conflict reverts with "Changed on the Mac — showing the latest."
  - The count shows in the Connection sheet. Accept/Reject are disabled when the queue is full.
  - Test cases for the done criterion:
    - Replay, conflict revert, and the cap.
- [ ] 2.9 Add Playwright coverage for review (after 2.7, 2.8). Done when `e2e/remote-review.spec.ts` (`remote-iphone`) passes and the Phase 2 screens are in `remote-view-screens.spec.ts` with baselines.
  - Spec cases:
    - The grid shows thumbnails.
    - A preview goes from preparing to playing (real FFmpeg on the shim's synthetic clip).
    - Accept on the phone shows up in the desktop `GET /timeline/document`.
    - A shim-made desktop change in between gives the conflict toast and the revert.
    - A forced FFmpeg failure shows Try again, and no request reaches source media.
  - A desktop spec (`chromium`) shows a decision posted through the API appearing on the Review Board without a reload.
  - Phase 2 screens: grid, player (preparing, playing, failed) and the conflict toast.

## Phase 3: Phone Export — rendered MP4s on the phone, including 9:16

- [ ] 3.1 Make Mac Jobs durable in `jobs.py`. Done when `backend/tests/test_jobs.py` covers the cases below.
  - Records live at `clipassembler/jobs/<id>.json`, written with `write_text_atomic`. They hold the requesting device, idempotency key, source identities, recipe, snapshot and revision, state, progress, timestamps, output size and hash, and a safe error (§9.3).
  - States: `queued → running → verifying → ready`, `cancelling → cancelled`, `failed`, `interrupted`.
  - One heavy job runs at a time, shared with previews and coordinated with analysis. A render waits as "queued — waiting for analysis" while analysis runs. Delivery requests get priority. The queue holds at most 20.
  - Progress comes from FFmpeg `-progress pipe:1`.
  - Cancel kills the tracked process, the way `_analysis_active_proc` does (`api.py:146`).
  - On restart, `running` becomes `interrupted` and published outputs are recovered.
  - Rendering shares the disk reservation ledger with uploads.
  - Test cases for the done criterion:
    - An idempotent create.
    - Cancel mid-run.
    - Restart recovery.
    - Analysis blocks a render.
    - A full queue gets 503.
- [ ] 3.2 Add the render recipes in `backend/src/media/rendering.py`. Done when `backend/tests/test_rendering.py` (real FFmpeg on synthetic fixtures) covers the cases below.
  - Targets: a Candidate Clip (bounds); a Timeline Item (bounds, Speed, Transform); the Edit (an ordered Timeline Document snapshot and revision). The snapshot is captured under the Project lock.
  - An Accepted Clip renders its first Timeline Item in Timeline order.
  - Frame:
    - Original fits within 1920×1080 or 1080×1920.
    - Vertical is 1080×1920: `crop` takes a centre crop, `fit` scales and pads with black.
    - fps is the source fps capped at 60.
  - Encode: H.264 High, `yuv420p`, about 10 Mbps with a ceiling, AAC-LC 48 kHz stereo, `+faststart`, rotation applied, HDR→SDR via 2.2.
  - Speed uses `setpts` plus chained `atempo`. Transform follows the `Transform` semantics the NLE exporters use (`export_engine.py`).
  - The Edit renders each item to a normalized segment in `clipassembler/cache/render/<job>/`, then joins them with the concat demuxer. Items without audio get a generated silent track. "Muted" outputs have no audio stream.
  - Verify with ffprobe (codec, size, duration within one frame per segment), then publish `exports/mp4/<id>.mp4` with a `<id>.json` holding the snapshot, hashes and recipe.
  - A failure stores the last 5 stderr lines with absolute paths reduced to file names.
  - Test cases for the done criterion:
    - A single clip in original framing.
    - A 16:9 source in vertical crop and fit, both 1080×1920.
    - A portrait passthrough.
    - Speed 2.0 halves the duration.
    - Transform scale is applied: a known colour quadrant fills the frame.
    - The Edit renders its captured revision despite a later Operation.
    - A mixed audio/no-audio Edit.
    - The safe failure summary.
- [ ] 3.3 Add the remote Phone Export routes. Done when `backend/tests/test_remote_phone_exports.py` covers the cases below.
  - `POST /api/projects/{id}/phone-exports {what: {clips: [clipId…]} | {edit: true}, frame: "original"|"crop"|"fit", audio: "source"|"muted", idempotency_key}` creates one Mac Job per clip, or one for the Edit.
  - `POST …/phone-exports/estimate` returns the size per option for the sheet.
  - List, status, cancel and delete: `GET …/phone-exports`, `GET …/phone-exports/{id}`, `POST …/{id}/cancel`, `DELETE …/{id}`. Delete removes the file from the Mac.
  - `GET …/phone-exports/{id}/file?disposition=attachment|inline` goes through `media/serving` with Range support.
  - Status events go over the Project SSE.
  - Test cases for the done criterion:
    - Create and list.
    - Idempotency.
    - Delivery of exact bytes with Range.
    - An attachment `Content-Disposition`.
    - Another Paired Device can read the export, because exports belong to the Project.
    - An unexposed Project gets 404.
    - Revoke closes an active download.
- [ ] 3.4 Build the Export sheet and the Phone Exports screen (after 3.3). Done when 3.6's spec passes.
  - Follow UX §5–6. The sheet asks What, Frame and Audio, with Instagram-ready defaults and size estimates. Its button reads **Render on Mac (n clips · ~N MB)**.
  - Row states: `queued` → `rendering n%` → `checking` → **Ready on Mac** → **Get video** (`getting n%`) → **Share video** / **Download** → "Shared · …" or "Downloaded · in Files".
  - **Share video** is a separate tap. It calls `navigator.share({files: [file]})` only after `navigator.canShare`, with no fetch in the same tap.
  - Files above 100 MiB show "Too large to share directly — Download, then share from Files."
  - Rows also offer Cancel, Try again and **Remove from Mac**, plus the Files → Photos how-to line.
  - No copy contains "Saved to Photos".
- [ ] 3.5 Show Phone Exports on the desktop. Done when a stubbed desktop e2e shows the list, Reveal and Remove, and the status-bar render fact.
  - Add `GET /projects/{id}/phone-exports` and `DELETE /projects/{id}/phone-exports/{renderId}` on the desktop API.
  - `routes/Export.tsx` gets a "Phone Exports" list with Reveal in Finder (existing `export:reveal-file`) and Remove.
  - `layouts/StatusBar.tsx` shows "Rendering for phone n%" while a render job runs.
- [ ] 3.6 Add Playwright coverage for Phone Exports (after 3.4). Done when `e2e/remote-phone-export.spec.ts` (`remote-iphone`) passes and the Phase 3 screens (sheet, rows in each state, too-large) are in `remote-view-screens.spec.ts` with baselines.
  - Select two clips, render one vertical crop and one original (real FFmpeg on the shim fixtures), and render the Edit.
  - Rows reach Ready, then Get video shows progress.
  - Share video with a stubbed `navigator.share` receives a `video/mp4` `File`.
  - The Download link carries `attachment`.
  - A shim-forced 150 MiB size shows the too-large copy.
  - The page text never contains "Saved to Photos".
- [ ] 3.7 Update terms and docs for Phone Export. Done when the links resolve and `plans.py check` passes.
  - `GLOSSARY.md` gets **Phone Export**, distinct from **Export**.
  - ADR 0004 is amended: Export stays the editable handoff, and Phone Export is the rendered artifact. Its README entry is updated.
  - `docs/USER_GUIDE.md`: "Get clips onto your phone", with the Files → Photos and Instagram steps.
  - `docs/TROUBLESHOOTING.md`: render failures, HDR on tool builds without tone mapping, and the too-large-to-share case.

## Human tasks

- [ ] H1 Phase 1 on a physical iPhone over the real tailnet. Record the results in `docs/reviews/`.
  - Toggle on and check that readiness shows 8448 free and Funnel off.
  - Scan the QR, then Approve on the Mac.
  - Send three 20–30 MB `.mov` files and one multi-GB file. Lock the screen, switch tabs, and make Safari reload so a file has to be reselected. Also switch Wi-Fi ↔ cellular.
  - Every file reaches **Imported and verified**, appears once in the Project root and in the desktop sidebar, and the SHA-256 values match.
  - Analysis started on the Mac shows on the phone.
  - Disconnect on the phone, Revoke on the Mac and toggle off each land on the right screen.
  - `tailscale serve status` shows the other entries unchanged.
  - `kill -9` Electron: the phone loses access at once, and the next start removes the stale handler.
  - Note the installed Tailscale version, and confirm that mount stripping and the identity and Funnel headers behave as 1.6 assumes.
- [ ] H2 Measure whole-file hashing on the owner's iPhone for the multi-GB file: throughput, memory, and battery over 10 minutes. Decide whether the 4 MiB chunk size stays.
- [ ] H3 Phase 2: browse and play previews on Wi-Fi and on cellular through a relayed path. Accept/Reject while the desktop edits the same Project, and confirm the conflict copy. Decide whether a Lite 480p preview is needed.
- [ ] H4 Phase 3 for Instagram.
  - Render a vertical crop of a 16:9 source, a portrait original, and the Edit.
  - Get video → Share video → Save Video, and Download → Files → Photos.
  - Confirm each opens in Instagram's reel editor at 1080×1920.
  - Validate the 100 MiB share budget on the device.
- [ ] H5 Compare the committed `remote-iphone` screenshots with the [mockup](../designs/remote-view/remote-view.html) and approve them or list the differences.
- [ ] H6 Revoke-during-use drill: Revoke all while one upload and one preview are active. Both stop, the phone lands on Pair with "This phone was removed", and the upload resumes only after a new pairing.
- [x] H7 Decide where Remote View sits in [ROADMAP](../ROADMAP.md). Owner, 2026-10-10: build it before v1.0.0 as an experiment to learn whether the phone workflow is worth investing in further.
