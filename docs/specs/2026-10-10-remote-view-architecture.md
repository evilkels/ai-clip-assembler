# Remote View — storage, integrity, serving and security architecture

**Status:** Recommended architecture, researched against the repository and primary documentation on 2026-10-10. No files changed.

**Attached to:** [plan 041](../plans/041-remote-view.md) · [UX spec](../specs/2026-10-10-remote-view-ux.md) · [ADR 0010](../adr/0010-remote-view-over-tailnet.md). The "Changes applied" list at the end was applied to the plan and ADR on 2026-10-10. Code references were re-verified against `main` at `e147618` on 2026-10-10.

**Terminology used across the Remote View docs:** this document's "Rendered MP4" is the glossary's **Phone Export**; a "device pairing" / "browser pairing" is a **Paired Device**; a render or analysis job the phone observes is a **Mac Job**; the "Edit" render target is the Timeline Document snapshot.

Remote View should use a **separate, authenticated remote listener**, exposed only through Tailscale Serve, with project-local resumable uploads, verified publication of Source Videos, lazy preview renditions, and durable MP4 rendering jobs.

The governing rule is: **receiving bytes, importing a Source Video, rendering a preview, and delivering an MP4 are separate states with separate completion guarantees.** The phone must never interpret “all bytes sent” as “safely imported,” or “share sheet opened” as “saved to Photos.”

## 1. Decisions and invariants

Adopt these decisions:

| Area | Recommendation |
| --- | --- |
| Exposure | Tailscale Serve only; dedicated HTTPS port and `/remote` handler; never Funnel or `serve reset`. |
| Backend boundary | Separate remote ASGI application and loopback listener in the existing backend process. Share application services, not unrestricted HTTP routing. |
| Authentication | Exact owner Tailscale identity **and** independently established application pairing/session. |
| Upload protocol | tus 1.0, with bounded chunks and checksum, creation, expiration and termination extensions. Application finalization remains separate. |
| Upload destination | Project root, consistent with the current non-recursive scanner. |
| Integrity | SHA-256 for each phone chunk; whole-file SHA-256 on phone and Mac; final disk reread before publication. |
| Persistence | JSON records, durable staging and recovery journal; atomic writes and publication without overwriting existing footage. |
| Concurrency | One project owner in the backend; serialized commits and revision checks across desktop, phone and agents. |
| Preview | Lazy, cached H.264/AAC MP4 renditions; no automatic raw-source fallback. |
| Phone delivery | Rendered MP4 for one Candidate Clip, one Timeline Item or a Timeline Document snapshot; original aspect and optional 9:16 output. |
| Disconnect | Stop accepting requests immediately, close active streams, pause uploads, and preserve explicitly defined resumable state. |

ADR 0003 makes the selected folder the Project, requires relative Source Video filenames, and explicitly rejects silently treating failed writes as durable saves. Keep that model. See [ADR 0003:17](../../docs/adr/0003-project-folder-persistence.md#L17).

The AI Access rules continue to apply when analysis is started remotely: [ADR 0007](../../docs/adr/0007-ai-access-is-granted-when-connecting.md) (which superseded the per-project opt-in of [ADR 0001](../../docs/adr/0001-local-first-and-cloud-consent.md)) plus the Project's AI: On / Off switch. Pairing a phone never grants AI Access, and the phone cannot change either setting.

## 2. Exposure and security boundary

### 2.1 Recommended topology

```text
iPhone Safari
  https://<mac>.<tailnet>.ts.net:8443/remote/
         |
         | Tailscale Serve: tailnet only, /remote only
         v
127.0.0.1:<remotePort>/<per-enable-ingress-capability>/...
  remote ASGI application
  - owner identity check
  - pairing/session/CSRF
  - explicit capability routes
  - authorized media serving
         |
         | direct application-service calls
         v
Project / upload / analysis / timeline / render services
         ^
         |
127.0.0.1:<desktopPort>
  existing desktop API and MCP
```

Reserve HTTPS port **8443** for Remote View, subject to a preflight conflict check. Its separate browser origin avoids sharing an origin with the Mac’s existing Serve applications. Do not automatically select a changing public port; the bookmark should remain stable.

The existing backend’s random loopback port remains unchanged. Electron currently allocates and launches it in [index.ts:347-350](../../frontend/src/main/index.ts#L347) (`startPackagedBackend`, packaged builds only; dev runs the backend separately on port 8000), using the lifecycle helpers in [backendLifecycle.ts:253](../../frontend/src/main/backendLifecycle.ts#L253).

A separate remote listener makes the allow-list structural: it has no project-creation, settings, arbitrary-file, MCP or Review model authentication routes. It must not forward arbitrary requests to the desktop API.

This is stronger than the draft’s proposal to expose a path on the unrestricted application and recognize remote requests by headers.

### 2.2 Serve ownership and commands

Illustrative command shape:

```sh
tailscale serve --bg --https=8443 --set-path=/remote \
  http://127.0.0.1:<remotePort>/<ingress-capability>/

tailscale serve --bg --https=8443 --set-path=/remote off
```

Execute with `execFile` and fixed argument construction, never a shell string. Record the exact host, public port, mount and target owned by the app.

Before adding or removing a handler:

1. Inspect `tailscale serve status --json`.
2. Refuse to overwrite another application’s handler.
3. Refuse a public port already occupied by another application or enabled for Funnel.
4. Add/remove only the recorded app handler.
5. Compare configuration afterward and verify unrelated entries are unchanged.

Tailscale documents path mounts, background operation, status inspection and removal using the original configuration flags. **Never invoke `tailscale serve reset`.** [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

Serve strips the external mount prefix before proxying; the target URL’s path is then prepended. Implement that mapping explicitly, including redirects, static asset URLs, tus `Location` responses and SSE URLs. The ingress capability must never appear in public responses. Verify behavior against the supported installed version, since this detail comes from the [official Serve implementation](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go).

### 2.3 Funnel and sibling applications

Funnel exposure applies to the **whole listening port**, not one path. Configuring Funnel on the app’s port could make every handler there public; configuring Serve on another app’s Funnel port could change that app’s exposure. This is why Remote View should reserve its own port. [Tailscale Funnel documentation](https://tailscale.com/docs/features/tailscale-funnel).

Monitor the app’s handler and the port’s Funnel state while enabled. If the target changes, another handler appears on the reserved origin, or Funnel becomes enabled:

- Disable remote authorization and close the remote listener immediately.
- Remove only a handler still demonstrably owned by the app.
- Show the configuration conflict on the Mac.
- Require deliberate re-enabling after the conflict is resolved.

Monitoring has a detection interval; it is not an absolute defense against a malicious tailnet administrator. Application authentication remains required.

### 2.4 Threat model and local header spoofing

Protect against:

- Other users and devices in the tailnet, including visitors granted device shares.
- A stolen QR code, stolen phone, expired session or revoked device.
- Cross-site requests, hostile upload metadata and malformed media.
- Disk exhaustion, resource exhaustion and path traversal.
- Accidental Serve/Funnel configuration changes.
- Desktop/phone write races and interrupted saves.

The Mac’s application account, root, Electron main and Tailscale installation are trusted. Malicious code already running as the application’s user can read or manipulate its files and credentials; this feature cannot establish a security boundary against that code.

Serve removes incoming Tailscale identity headers and supplies its own. However, tagged source devices lack user identity headers, and external users granted a device share can receive them. Require the configured owner login, not merely a header’s presence. [Tailscale Serve identity documentation](https://tailscale.com/docs/features/tailscale-serve).

**Loopback does not authenticate the sender process.** Tailscale explicitly acknowledges that other local services can forge identity headers when calling the backend directly. Therefore:

- Identity headers alone never grant access.
- Require pairing/session credentials independently.
- Require the per-enable ingress capability before routing.
- Treat that capability as additional protection against direct calls and stale targets, not cryptographic proof of a Tailscale process.
- Do not claim that `Origin`, forwarded headers or a loopback address prevent local-process spoofing.

A strict requirement to authenticate the proxy process would need privileged OS isolation or authenticated IPC. Do not quietly claim the proposed loopback design provides that guarantee. Unix-socket Serve targets are not a simple unprivileged substitute: Tailscale’s TS-2026-005 fix restricts them to root. [Tailscale security bulletin](https://tailscale.com/security-bulletins#ts-2026-005).

## 3. Pairing, sessions and authorization

### 3.1 Owner identity

On enable, Electron establishes the allowed owner login from the authenticated local Tailscale state and shows it on the Mac. Persist the chosen identity locally; do not silently switch ownership after a Tailscale account change.

For remote requests:

- Require a single, well-formed `Tailscale-User-Login` matching that owner.
- Reject missing identity, other logins and Funnel-marked requests.
- Bind device credentials and sessions to that owner.
- Treat names, user-agent strings and device labels as presentation metadata.

The resulting “device” is an **application browser pairing**, not proof of a uniquely identified physical iPhone. Two devices can belong to the same Tailscale user; Safari and a Home Screen installation can also require separate pairings.

### 3.2 Pairing flow

1. Desktop creates a random 32-byte, single-use pairing token, valid for five minutes.
2. QR encodes the public URL with the token in a fragment.
3. Remote UI reads the fragment and immediately removes it with `history.replaceState`.
4. UI posts the token to the pairing endpoint.
5. Backend checks enable state, allowed identity, expiry, rate limits and token.
6. Desktop shows a pending pairing with identity and requested device label.
7. Owner approves it on the Mac.
8. Backend consumes the token and issues device/session cookies.

The desktop approval is part of the product’s pairing mechanism. It protects against someone photographing the QR and winning the exchange race.

Do not log pairing request bodies or include tokens in query strings, analytics, error reports or SSE events.

### 3.3 Device approval versus active session

Use two distinct lifetimes:

| Record | Lifetime and behavior |
| --- | --- |
| Pairing token | Single use; five minutes. |
| Active session | Fifteen-minute idle timeout, renewed while actively used. |
| Remembered device credential | Thirty-day inactivity expiry; ninety-day absolute expiry. Rotated on renewal. |
| Remote enable lease | Valid only while Electron main remains alive and Remote View is enabled. |

Use opaque random credentials, with only their hashes stored. Device credentials and active sessions use host-only `HttpOnly; Secure; SameSite=Strict` cookies. On the dedicated origin, use `__Host-` cookies with `Path=/` and no `Domain`.

Store authentication records under Electron `userData`, with restrictive permissions and atomic writes, **outside portable Project folders**. Moving or sharing a Project must not transfer remote access.

Behavior must be explicit:

- **Quit/toggle off:** invalidate active sessions and close connections; remembered device approvals are suspended.
- **Re-enable:** remembered devices may establish a fresh active session after identity and CSRF checks.
- **Disconnect on phone:** revoke that browser pairing, clear cookies and local resume records.
- **Revoke on Mac:** immediately revoke that pairing, terminate its requests and release its upload reservations.
- **Revoke all:** invalidate every device credential and active session, and discard pending pairing tokens.

This gives useful reconnect behavior without perpetual sessions.

### 3.4 Project scope and API allow-list

Only Projects deliberately enabled for Remote View on the Mac are visible. Being present in the backend’s `projects` dictionary is not itself permission to expose a Project.

Every resource lookup checks:

1. Active enable lease.
2. Allowed identity.
3. Valid pairing/session.
4. Project exposure permission.
5. Resource ownership and permitted operation.

Uploads additionally belong to their initiating device pairing. Another pairing cannot guess an upload ID and take over its bytes.

Expose explicit routes for:

- Pairing, session renewal and self-disconnect.
- Project summaries.
- Upload creation, transfer, status, finalization and cancellation.
- Analysis status; later, analysis start/cancel.
- Candidate Clip summaries, decisions and previews.
- Timeline snapshots and explicitly permitted Operations.
- Render job creation, progress, cancellation and delivery.

Do not expose filesystem paths, arbitrary FFmpeg arguments, settings, AI Access or AI: On / Off changes, MCP, chat, project creation/deletion or arbitrary desktop endpoint forwarding.

### 3.5 Browser and request defenses

Require a session-bound CSRF token on every mutation, including tus writes, job creation, pairing approval exchange and session renewal.

For mutations:

- Require the exact configured HTTPS `Origin`, including port.
- Reject `Origin: null`, missing origins and cross-origin requests.
- Check the configured public authority against the expected forwarded host.
- Reject duplicate identity/authority headers and malformed requests.
- Apply authorization to the effective method, including tus method override.

Media GET/HEAD requests may legitimately omit `Origin`; authenticate them by session and resource authorization. They must never schedule a render or mutate state.

Serve the remote app with its own middleware policy:

- No permissive CORS.
- CSP using bundled assets, with `connect-src 'self'`, `frame-ancestors 'none'` and no external scripts.
- `Referrer-Policy: no-referrer`.
- `X-Content-Type-Options: nosniff`.
- No caching of API data or authenticated media in a service worker.
- Escaped filenames and device labels; never interpolate them into HTML.

The desktop API’s existing CORS configuration is not authentication or CSRF protection. See [api.py:98](../../backend/src/api.py#L98).

## 4. Project storage and identity

### 4.1 Layout

```text
<Project>/
  IMG_1234.mov                           finalized Source Video
  IMG_1234-phone-<short-id>.mov           collision-safe alternative

  clipassembler/
    project.json                        canonical Project manifest
    ingest/
      receipts/<upload-id>.json         durable publication/provenance receipt
    jobs/
      <job-id>.json                     durable job state and render snapshot
    samples/                            existing analysis Frame Samples
    analysis/
      results.json
      timeline.json
    cache/
      uploads/<upload-id>/
        record.json                     durable upload checkpoint/journal
        data.part                       incomplete bytes
      proxy/<rendition-key>.mp4
      thumbnails/<thumbnail-key>.jpg
      render/<job-id>/output.part.mp4

  exports/
    mp4/<render-id>.mp4                  completed phone-delivery render
    mp4/<render-id>.json                 snapshot, hashes and rendition metadata
    fcp/
    edl/
    davinci/
```

Upload staging belongs on the same filesystem as the Project root. Refuse configurations where `clipassembler/cache/uploads` resolves elsewhere through a symlink.

**Active and resumable uploads are not disposable cache.** General cache eviction must exclude them; only the upload service may cancel or expire them.

Final footage stays at the Project root. The current manifest enforces top-level relative filenames, and the scanner is non-recursive: [project_store.py:61](../../backend/src/project_store.py#L61), [project_store.py:204](../../backend/src/project_store.py#L204).

### 4.2 Durable identifiers and manifest evolution

Add a durable Project UUID and stable Source Video UUIDs. Preserve the existing filename-based backend `file_id` contract initially; expose opaque source IDs remotely through a mapping.

This distinction matters because opening a folder currently allocates a fresh runtime Project ID, while Source Video IDs are filenames: [api.py:270](../../backend/src/api.py#L270), [api.py:1680](../../backend/src/api.py#L1680).

Extend each Source Video record with:

- Stable source UUID.
- Relative filename.
- Size and SHA-256.
- Server import time.
- Optional upload provenance.
- A filesystem fingerprint used to detect subsequent modification.

Provenance contains:

- Upload ID and device-pairing ID.
- Device label captured at upload time.
- Owner login.
- Original selected filename.
- Server creation, completion and verification timestamps.
- Optional client `lastModified` and capture metadata, marked as untrusted.
- Verification method and resulting digest.

The manifest currently contains only `filename` and `imported_at`, and accepts only schema version 1. Add an explicit migration and retain readable older Projects; do not just start writing a rejected schema. See [project_store.py:61](../../backend/src/project_store.py#L61), [project_store.py:75](../../backend/src/project_store.py#L75). Plan 038 also bumps the schema version (for `ai_enabled`); the Remote View migration takes the next free version.

Receipts preserve import history when footage is renamed or removed. They contain no authentication secrets.

### 4.3 Naming and collision handling

Validate metadata once at upload creation and freeze it:

- Permit `.mp4` and `.mov` remotely initially.
- Require a valid media container/video stream during finalization.
- Normalize Unicode; remove controls and separators.
- Bound UTF-8 filename length.
- Reject empty names, dot names and reserved application-directory names.
- Keep the extension while shortening the stem.

Try the sanitized original name. On collision, append `-phone-<upload-id-prefix>`.

**Never overwrite footage.** Publish with an atomic no-replace filesystem operation. On macOS, use a tested platform adapter; fail safely on unsupported filesystem behavior. A prior `exists()` check followed by ordinary rename is insufficient because Finder or another process can create the destination between those calls.

No client field specifies a directory, final path or internal source ID.

## 5. Resumable uploads and integrity

### 5.1 Adopt tus 1.0

Use tus rather than carrying forward the custom query-string PUT protocol. The reference uploader proves the bounded-transfer approach works for this owner; tus supplies standardized recovery and interoperability.

Implement core tus plus `creation`, `checksum`, `expiration` and `termination`. Omit deferred length, concatenation, creation-with-upload and checksum trailers initially. Advertise `sha1,sha256` because the checksum extension requires SHA-1 support; our UI always selects SHA-256. [tus protocol](https://tus.io/protocols/resumable-upload).

The reference is useful but incomplete:

- Offset comes from part-file length.
- Each request can change declared total/name.
- It has no checksums or durable completion receipt.
- After rename, HEAD reports offset zero and `done: false`.
- Its collision check does not protect against outside writers.

See the reference uploader used on 2026-10-10 (`~/.local/share/clip-upload-server/server.py`, outside the repo; lines 127, 143, 185).

### 5.2 Wire contract

Public prefix below is `/remote/api/projects/{projectId}`. Authentication and CSRF remain application requirements around tus.

| Request | Contract |
| --- | --- |
| `OPTIONS /uploads` | `204`; supported tus version/extensions/algorithms and maximum size. |
| `POST /uploads` | Fixed `Upload-Length`, bounded `Upload-Metadata`; `201` with `Location`. |
| `HEAD /uploads/{id}` | `200`; durable `Upload-Offset`, length, expiry; `no-store`. |
| `PATCH /uploads/{id}` | Offset, tus version, `application/offset+octet-stream`, chunk checksum; `204` with committed offset. |
| Offset mismatch | `409`; unchanged upload; client reconciles with HEAD. |
| Checksum mismatch | `460`; discard request bytes; unchanged offset. |
| Unsupported version/type | `412` / `415`. |
| `DELETE /uploads/{id}` | `204`; terminate transfer resource, never delete imported footage. |
| Expired resource | `410` while tombstone retained. |

These wire semantics follow the [tus specification](https://tus.io/protocols/resumable-upload).

Application endpoints, separate from tus:

| Request | Behavior |
| --- | --- |
| `GET /upload-status/{id}` | Upload/import state, receipt, committed chunk checkpoints and final digest. |
| `POST /uploads/{id}/finalize` | Submit expected whole-file SHA-256; idempotently start verification/import; `202` or completed receipt. |

Use an idempotency key for creation and finalization. Retain the completed resource/receipt so a lost success response cannot cause a second import.

### 5.3 Chunk policy and durable offsets

Start with one active file per phone, sequential **4 MiB** chunks, and an **8 MiB** request ceiling. Reduce chunk size on slow links. Bound actual streamed bytes, independently of declared length.

For each PATCH:

1. Acquire the upload lock.
2. Validate session, declared offset and resource state.
3. Stream to `data.part`, keeping the prior committed offset.
4. Compute the request SHA-256.
5. On interruption or mismatch, truncate to the prior offset and flush.
6. On success, fsync the file.
7. Atomically persist the new offset and chunk receipt.
8. Only then return success.

The durable offset comes from the checkpoint, **not** whatever length happens to be on disk.

Recovery truncates bytes beyond the checkpoint. If the file is shorter than its committed offset, mark the upload damaged and require restart. Never tell the phone that uncommitted bytes were accepted.

### 5.4 Phone hashing

Do not call `file.arrayBuffer()` for a multi-GB file. Web Crypto `digest()` consumes a complete buffer and provides no incremental state. Use it for bounded chunk checksums. [Web Cryptography specification](https://www.w3.org/TR/webcrypto-2/#SubtleCrypto-method-digest).

For the whole-file hash, bundle a vetted incremental SHA-256 implementation in a Web Worker. Feed it the same bounded slices used for uploading. This is feasible with bounded memory, but throughput, battery use and eviction behavior must be measured on the owner’s iPhone.

The worker must hash each source slice exactly once despite network retries. If its state is lost, reread and hash the source prefix before continuing.

Persist only upload identifiers and resume metadata in IndexedDB. Do not copy whole selected videos into browser storage.

After Safari eviction or reload, ask the Editor to reselect the file:

- Filename, size and `lastModified` help find the pending transfer.
- Verify the already-uploaded prefix against stored chunk receipts before appending.
- A mismatch requires a new upload.
- Whole-file comparison remains mandatory before import.

Photos may provide a different representation on reselection; metadata matches are not sufficient evidence that the bytes match.

### 5.5 Whole-file verification

Maintain incremental SHA-256 on the Mac while accepted bytes arrive. Hash state is disposable; after a restart, reconstruct it from the committed prefix instead of serializing implementation-specific hash internals.

Finalization performs a bounded-memory disk reread and verifies:

- Actual size equals immutable `Upload-Length`.
- Disk SHA-256 equals the phone’s whole-file SHA-256.
- Required chunk receipts are present.
- FFprobe recognizes an allowed container and usable video stream.

The final disk reread verifies the file being published and provides the canonical deduplication digest. Matching length or successful FFprobe alone does not establish byte integrity.

Return an import receipt containing source ID, relative filename, size, SHA-256 and server verification time. The phone compares that digest with its own and only then displays **Imported and verified**.

Hashes establish equality of the selected phone file and stored Mac file. They do not prove authenticity of the camera recording or absence of malicious media.

## 6. Finalization, crash safety and deduplication

### 6.1 Recoverable publication transaction

Use explicit states:

```text
receiving → received → verifying → publishing → imported
                   ↘ failed
receiving → cancelled / expired
```

Finalization:

1. Stop further writes and verify the complete staging file.
2. Acquire the Project commit lock.
3. Load the latest manifest.
4. Resolve deduplication and reserve a collision-safe destination.
5. Durably record publication intent: destination, size, digest and provenance.
6. Publish without replacing any existing file.
7. Flush affected directory metadata.
8. Atomically commit the merged manifest.
9. Persist the completed receipt.
10. Update the backend projection and publish a source-added event.

The journal makes recovery deterministic if the process crashes between file publication and manifest publication. Recovery verifies the destination’s size/hash, repairs the missing manifest/receipt steps, and does not rename or import again.

A verified file already published but not yet registered must remain visible as **Import recovery pending**, not disappear or be reported as successful.

### 6.2 Atomic JSON writes and errors

Use one shared persistence primitive:

- Temporary sibling file.
- Complete JSON write and flush.
- File fsync.
- Atomic replacement.
- Parent-directory flush where supported.
- Explicit error propagation.

For macOS power-loss durability, implement and test the appropriate platform flush behavior. Validate the supported local filesystem assumptions; do not promise the same guarantees for arbitrary network-mounted or removable filesystems.

Current manifest, results and Timeline Document writes use direct `write_text`, and some API wrappers swallow persistence errors. These are prerequisites to fix:

- [project_store.py:198](../../backend/src/project_store.py#L198) (manifest), [:256](../../backend/src/project_store.py#L256) (results), [:287](../../backend/src/project_store.py#L287) (frame scores), [:314](../../backend/src/project_store.py#L314) (review session), [:384](../../backend/src/project_store.py#L384) (Timeline Document)
- [api.py:995](../../backend/src/api.py#L995) (`_write_timeline_for_project` logs and swallows `OSError`)
- [api.py:1804](../../backend/src/api.py#L1804) (`persist_project_results` logs and swallows `OSError`)

Commit durable state before acknowledging a mutation or publishing its event. If persistence fails, preserve the previous authoritative state.

The current controller mutates memory before its persistence notification. Change that ordering or provide rollback; merely letting the writer raise is insufficient. See [timeline_ops.py:436](../../backend/src/timeline_ops.py#L436) (`_commit`).

### 6.3 Deduplication

Use **size plus complete SHA-256** for content deduplication within a Project.

Filename, size and mtime are resume-search hints and change-detection fingerprints, never authoritative deduplication keys.

On a verified match:

- Confirm the existing file still matches its recorded identity.
- Return its source ID.
- Record the additional upload provenance in a receipt.
- Delete the redundant staged bytes.
- Do not create another Source Video or analyze it twice.

For existing desktop footage without a digest, hash plausible same-size candidates asynchronously. Concurrent finalizations resolve deduplication under the Project lock.

Do not deduplicate across Projects or move footage into a central content store.

### 6.4 Disk limits and cleanup

Recommended initial policy:

- Maximum Source Video upload: **50 GiB**.
- One active transfer per device, two per Mac.
- At most ten unfinished uploads per device.
- Preserve at least **5 GiB or 10% of volume capacity**, whichever is larger.
- Reserve outstanding declared upload bytes and estimated render output in the app’s capacity ledger.

Check free space at creation, before accepting chunks and before rendering. Reservations prevent the app overcommitting itself; outside applications can still consume disk, so handle `ENOSPC` and return `507` without advancing the committed offset.

Expire uploads after seven days without successful progress. Cleanup runs on Project open and periodically while open, takes the upload lock, excludes verifying/publishing uploads, removes only app-owned paths and leaves expiry tombstones.

Explicit cancellation/revocation schedules prompt part cleanup. Ordinary quit preserves resumable uploads until expiry.

## 7. Rescan, analysis and concurrent editing

Finalization should call a shared **verified ingest service**, not simply rename and invoke the existing route.

The existing rescan merges Source Videos by filename, writes the manifest, reprobes the folder and preserves clips/timeline. Reuse those semantics while adding locking, provenance preservation and pending-import recovery. See [project_store.py:150](../../backend/src/project_store.py#L150), [api.py:365](../../backend/src/api.py#L365).

Coordinate these operations through one Project service:

- Upload publication and desktop rescan.
- Consent/settings manifest writes.
- Analysis completion.
- Review decisions and Timeline Operations.
- Project closure/deletion.
- Render snapshot capture.

Canonicalize the Project root and share a single backend Project owner when the same folder is opened twice. Use an OS project lock to reject another writable backend instance. External filesystem changes still require detection.

Keep long uploads, hashing and rendering outside the Project commit lock. Acquire it only for state transitions; define one lock ordering and never hold it while receiving network bytes.

### Concurrent edits

Require expected revisions for phone and desktop review/timeline mutations. Return `409` with the authoritative snapshot on conflict. SSE tells clients to reconcile; it does not prevent lost writes.

The Operations API already supports revision conflicts, and the desktop Review Board already decides through it (`include` / `exclude` / `reset_decision` from `ReviewContext.tsx`, live-synced over SSE). But revisions are optional, so desktop decisions send none. Document replacements (draft, re-derive, analysis completion and the legacy timeline endpoint, which the renderer no longer calls) rebuild the controller. Before phone review ships, require revisions on decision Operations from both clients, and make every replacement advance the revision:

- [api.py:760](../../backend/src/api.py#L760) (legacy `PUT /timeline`)
- [api.py:1046](../../backend/src/api.py#L1046) (`POST /timeline/op`)
- [timeline_ops.py:432](../../backend/src/timeline_ops.py#L432) (optional revision check)

Candidate Clip decisions should become revisioned, durable Operations with Undo History. Repeated Candidate Clips remain distinct Timeline Items; removing an item is not necessarily rejecting its Candidate Clip.

### Analysis

Add phone start/cancel after upload and connection behavior is reliable:

- Start returns `202` with a job ID.
- Use the Mac's saved scoring choice and project preferences.
- Recheck the AI gate (AI Access, Active Provider, the Project's AI: On / Off) on execution.
- Show whether the run is rule-based or uses the named Provider (Claude or ChatGPT). Never say "harness" or "consent" to the Editor.
- Freeze the source set for that run; new imports are for the next run.
- Cancel is idempotent and terminates tracked subprocesses.
- Commit analysis results only if the expected source/review state still permits it.

The current analysis endpoint waits for a blocking pipeline and its start guard is not a serialized job reservation. Extract its existing validation and cancellation behavior into the job service rather than forwarding that HTTP call. See [api.py:512](../../backend/src/api.py#L512), [api.py:607](../../backend/src/api.py#L607).

## 8. Preview serving

### 8.1 Renditions

Generate previews lazily when the phone requests preparation. Opportunistically prepare the next few visible Candidate Clips after the first request.

Recommended preview preset:

- MP4, H.264, `yuv420p`.
- Aspect-preserving landscape up to 1280×720; portrait up to 720×1280.
- Maximum 30 fps.
- Approximately 2–3 Mbps target, with a bitrate ceiling.
- AAC-LC when audio exists.
- Square pixels, rotation baked into pixels.
- Explicit SDR tone mapping for supported HDR sources.
- `+faststart`.

Apple recommends H.264 MP4 for static Safari video; byte-range serving is required for media random access. [Current Safari video guidance](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari), [Safari media server documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html).

Use the original Source Video for export rendering, not this preview.

If preparation fails, show the error and retry action. Do not automatically expose raw 4K/HEVC footage because FFmpeg is unavailable or the proxy is pending.

### 8.2 Cache keys and publication

Rendition key:

```text
SHA256(source-content-hash + normalized-recipe + renderer-version)
```

Include orientation, color conversion and encoder settings in the recipe. A filename/mtime-only key is insufficient.

For unhashed desktop sources, first compute content identity. Detect changes using the filesystem fingerprint; rehash before reusing an output when it changes.

Render to a temporary file, verify it, then atomically publish the immutable rendition. Never serve an incomplete MP4.

Source hashes must be invalidated when footage changes. Exports and previews must not silently keep using cached content from a replaced file.

### 8.3 HTTP contract

Authenticated media routes support:

- GET and HEAD.
- `200` for complete responses.
- Single byte ranges, including suffix and open-ended ranges.
- `206`, exact `Content-Range` and `Content-Length`.
- `416` with `Content-Range: bytes */<size>`.
- Strong ETags and correct `If-Range` behavior.
- `video/mp4` and inline disposition for previews.
- Bounded-memory streaming.

Reuse the current range parser and iterator, then add HEAD/conditional behavior and tests. See [api.py:1724-1794](../../backend/src/api.py#L1724).

Keep authorization in front of every response, including Range and conditional requests. Use `Cache-Control: private, no-store` initially so revocation is not undermined by reusable browser caches.

### 8.4 Thumbnails and cache lifecycle

Serve thumbnails through source/candidate IDs, never supplied filesystem paths. Reuse suitable existing Frame Samples; generate small JPEGs only when needed, keyed by source digest, timestamp and recipe.

Existing Frame Samples are found through `samples_dir` and filename-based subdirectories, and are already looked up by timestamp for desktop posters. See [api.py:1122](../../backend/src/api.py#L1122) (`timestamped_frame_paths`), [api.py:470](../../backend/src/api.py#L470) (poster route), [api.py:1830](../../backend/src/api.py#L1830) (`samples_dir`).

Use a configurable preview-cache budget, initially 10 GiB per Project, with LRU eviction and a thirty-day unused expiry. Never evict active responses, active jobs or upload staging.

## 9. MP4 delivery to the phone

### 9.1 A new rendered artifact

The existing export endpoint generates FCPXML, EDL or Resolve XML. It does not render a playable video. See [api.py:1408](../../backend/src/api.py#L1408).

Add **Rendered MP4** as a distinct domain concept. ADR 0004 currently defines Export as an editable professional-app handoff; extend the terminology and decision explicitly rather than silently redefining it. See [ADR 0004:9](../../docs/adr/0004-editable-export-and-edl-degradation.md#L9).

Render targets:

| Target | Snapshot |
| --- | --- |
| Candidate Clip | Source and Candidate Clip bounds. |
| Timeline Item | Its bounds, Speed and Transform. |
| Edit | Ordered Timeline Document snapshot and revision. |

Capture snapshots under the Project lock. Later edits do not change an in-progress render.

For edits, honor trims, ordering, Speed, Transform and effective duration. Normalize dimensions/frame rate/audio for concatenation, and define missing-audio behavior. Unsupported source formats or transformations fail explicitly.

### 9.2 Output presets

Provide:

- **Original aspect:** bounded 1080p output.
- **Vertical 9:16:** 1080×1920, with explicit fit or center-crop choice and preview.

Use H.264, `yuv420p`, AAC-LC, faststart and bounded bitrate. Apply orientation and supported HDR-to-SDR conversion consistently.

Vertical output is now part of the requested scope. It need not introduce phone-side freeform Transform editing; the output framing choice can be a render preset. Do not imply automatic subject-aware reframing.

Instagram delivery means a compatible local MP4 the owner can import. Do not promise a specific Instagram share target or direct publishing behavior.

### 9.3 Durable job queue

Persist jobs as JSON with:

- Job ID, requesting device and idempotency key.
- Source identities and immutable render recipe.
- Timeline revision/snapshot where applicable.
- State, phase, progress and timestamps.
- Output size/hash and relative path.
- Safe error details.

States:

```text
queued → running → verifying → ready
              ↘ cancelling → cancelled
              ↘ failed / interrupted
```

Use one heavy render/transcode at a time initially, with bounded queue length and priority for explicit delivery requests. Coordinate with analysis rather than creating another uncontrolled subprocess pool.

Use FFmpeg progress output for render progress. Keep encoding, output verification and phone download progress separate; percentages must not imply the file is already saved.

The job remains attached to the Mac, not the HTTP connection. Phone backgrounding does not cancel it. On backend restart, recover published results and mark unfinished processes interrupted.

Write outputs through temporary files and verify before publication. FFmpeg documents faststart as a final container-layout operation, reinforcing that an unfinished output is not ready for serving. [FFmpeg format documentation](https://ffmpeg.org/ffmpeg-formats.html).

Completed user-requested MP4s live in `exports/mp4/` and remain until explicit deletion. Temporary renders expire after failure/cancellation. Downloading or invoking Share never automatically deletes the Mac’s copy.

### 9.4 Share sheet and download behavior

Safari supports Web Share Level 2 file sharing. [WebKit Safari 15 announcement](https://webkit.org/blog/11989/new-webkit-features-in-safari-15/).

Implement two paths:

**Share prepared MP4**

1. Render completes.
2. Phone downloads the MP4 with progress.
3. Construct a `File` with `video/mp4`.
4. Evaluate `navigator.canShare({ files: [file] })`.
5. Enable a separate **Share video** button.
6. Its click immediately invokes `navigator.share`.

Do not perform a long fetch and then call Share from the same click: transient user activation may expire during the fetch. WebKit documents this failure directly. [WebKit User Activation API](https://webkit.org/blog/13862/the-user-activation-api/).

Use a conservative application memory budget, initially 100 MiB, for browser-prepared sharing. This is an application limit to validate, not an asserted Safari platform maximum.

**Download MP4**

Always offer an authenticated same-origin link with attachment disposition. This avoids loading a large export into JavaScript memory.

Safari downloads appear in Files/Downloads, not automatically in Photos. [Apple download guidance](https://support.apple.com/en-ng/102440).

Provide tested instructions for moving the downloaded video into Photos and importing it in Instagram. Share availability, target apps and file acceptance must be validated on the owner’s actual iPhone.

The Web Share API does not prove that Photos saved the file or Instagram imported it. Display **Share sheet opened** or **Handed to share sheet**, not **Saved to Photos**. [Web Share specification](https://www.w3.org/TR/web-share/).

For privacy, explain that Files may use iCloud Drive and Photos may sync according to the owner’s OS settings. Recommend **On My iPhone** for a device-local download. Remote View cannot control subsequent OS or Instagram uploads.

## 10. Lifecycle, resource protection and audit

### App quit, crash and stale Serve handlers

Extend the existing startup sweep and shutdown lifecycle:

- Startup sweep: [backendLifecycle.ts:204](../../frontend/src/main/backendLifecycle.ts#L204).
- Quit hook: [index.ts:492](../../frontend/src/main/index.ts#L492).

On orderly disable/quit:

1. Close the authorization gate.
2. Revoke active sessions.
3. Terminate SSE and media streams.
4. Stop transfers at durable chunk boundaries.
5. Cancel/stop owned subprocesses and persist job states.
6. Close the remote listener.
7. Remove only the owned Serve handler.

Give the backend an inherited authenticated control channel to Electron main. EOF disables Remote View even if the backend survives an Electron crash. Use a heartbeat lease as a second safeguard.

`--bg` can leave a Serve handler after a crash. The truthful guarantee is **no functioning application access after lease loss**, followed by owned-handler cleanup on restart. Do not claim the Tailscale listener necessarily disappears immediately.

Allocate a new ingress capability on each enable. A stale handler must not accidentally route into a later unrelated process that reuses the port.

### Rate and resource limits

Apply bounded limits before reading bodies or starting work:

- Pairing: five failed attempts per identity per ten minutes, plus a global ceiling.
- Small metadata bodies and bounded tus metadata.
- Upload length, chunk size, unfinished count and disk reservations.
- Bounded requests per device and total concurrent streams.
- One heavy processing job initially and a bounded queued-job count.
- Bounded SSE queues; slow consumers reconnect and fetch snapshots.

Return `429` with retry information for rate limits and `503` for unavailable processing capacity.

### Path and media safety

Resolve public IDs through authorized records. Open only registered regular files beneath the canonical Project root. Reject symlinks escaping it and encoded separator/traversal tricks. Use no-follow/descriptor-based operations where practical to reduce check/open races.

FFmpeg and FFprobe run with fixed argument arrays, local-input protocol restrictions, time/resource limits and no caller-supplied URLs or filter expressions. Uploaded media is untrusted parser input.

Maintain supported, patched Tailscale and media tooling. Tailscale has disclosed Serve request-handling vulnerabilities; a private tailnet does not make parser robustness irrelevant. [Tailscale security bulletins](https://tailscale.com/security-bulletins).

### Audit

Keep bounded JSONL audit logs under local `userData`:

- Enable/disable and Serve conflicts.
- Pairing approval, failure, renewal and revocation.
- Upload creation, integrity failure, expiration and publication.
- Analysis start/cancel.
- Review mutations and render requests.
- Authenticated delivery requests.

Record server time, correlation ID, device-pairing ID, owner login, resource ID and outcome. Do not log cookies, QR tokens, ingress capabilities, request bodies, absolute Project paths or media content.

The audit log is operational evidence, not tamper-proof evidence against the trusted Mac account.

## 11. Module boundaries

Keep modules organized around lifecycle ownership:

| Module | Responsibility |
| --- | --- |
| `backend/src/remote/app.py` | Separate ASGI app, explicit routes, static UI and remote-only middleware. |
| `backend/src/remote/auth.py` | Pairing, owner policy, cookies, CSRF, device revocation. |
| `backend/src/remote/lifecycle.py` | Enable lease, listener state and connection shutdown. |
| `backend/src/uploads/service.py` | tus semantics, checkpoint state, chunk integrity and expiration. |
| `backend/src/uploads/store.py` | Project-local staging, receipts and publication recovery. |
| `backend/src/project_service.py` | Canonical Project ownership, ingest/rescan and serialized commits. |
| `backend/src/project_store.py` | Manifest migrations and durable JSON persistence. |
| `backend/src/media/renditions.py` | Preview recipes, cache keys and thumbnail preparation. |
| `backend/src/media/serving.py` | Authorized GET/HEAD/Range responses. |
| `backend/src/media/rendering.py` | Validated MP4 rendering from immutable snapshots. |
| `backend/src/jobs.py` | Queue admission, progress, cancellation and recovery. |
| `frontend/src/main/remoteViewController.ts` | Tailscale discovery, owned-handler orchestration, pairing approval and enable control. |
| `frontend/src/renderer/remote/` | Separate mobile entry and same-origin API client. |

These are proposed boundaries, not instructions to create every file before it has an owner.

Reuse the existing analysis pipeline, cancellation runner, Operations core, Timeline lifecycle, Frame Samples and range utilities through service interfaces. Do not call route functions directly or make internal HTTP requests through the desktop API.

The mobile entry shares design tokens, suitable components and generated DTOs. It has no Electron preload dependency and uses explicit relative `/remote/api` URLs. Keep API routes ahead of static fallback, and never return the SPA HTML for an unknown API path.

## 12. Test strategy and delivery gates

### Backend

Test properties that matter to users:

- Interrupted transfer preserves only acknowledged chunks.
- Lost creation/PATCH/finalization responses do not duplicate imports.
- Changed reselected files cannot append to a pending upload.
- Per-chunk and whole-file mismatches never publish.
- Duplicate content resolves to one Source Video with retained provenance.
- Name collisions never overwrite footage.
- Disk exhaustion preserves a valid checkpoint.
- Expiration/revocation cannot race active publication.
- Crash injection after each fsync, publication and manifest step recovers deterministically.
- Manifest failure never yields a success response/event.
- Desktop rescan, phone import and manifest changes preserve each other.
- Stale review revisions conflict; failed persistence leaves state unchanged.
- Renders use their captured revision and preserve trim/Speed/Transform.
- Range/HEAD/conditional responses deliver exact bytes and lengths.
- Revocation closes active streams and blocks future delivery.

### Electron and Tailscale integration

Verify:

- Only the app’s handler is added/removed.
- Other Serve entries remain unchanged.
- Existing Funnel or origin conflicts prevent enablement.
- Handler replacement prevents blind removal.
- Mount stripping and target-prefix mapping work on supported Tailscale builds.
- Desktop/MCP/settings routes cannot be reached through the remote listener.
- Forged identity headers without pairing fail.
- Parent-channel loss disables a surviving backend.
- Stale targets cannot access the next runtime.

Test behavior, not just argv strings.

### Browser automation

Exercise pairing, resume, progress, review conflicts, render readiness and share/download controls in WebKit. Inject dropped responses and network interruptions.

An emulated iPhone viewport is useful UI coverage, but cannot prove iOS process suspension, native Photos selection or share-sheet behavior.

### Physical iPhone acceptance

Required before release:

- Several MOV/MP4 files, including multi-GB footage.
- Screen lock, tab switch, Safari termination and file reselection.
- Wi-Fi/cellular transition and temporary network loss.
- Bounded hashing memory and usable foreground throughput.
- Preview seeking and playback over a slower relayed connection.
- Original-aspect and 9:16 MP4 delivery.
- Share-to-Photos where offered; Files fallback and Instagram import.
- Mac revoke while playback/upload is active.
- Electron/backend crash and quit.
- Confirmation that unrelated Serve applications still work.

Wake Lock is best-effort foreground convenience. Safari supports it, but visibility loss can release it; it is not a background-upload execution guarantee. Show **Paused—return to resume** when necessary. [Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes), [Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/).

Deliver in gates:

1. **Secure connection and durable verified upload.**
2. **Lazy previews and revision-safe Review Board.**
3. **Rendered MP4 delivery, including 9:16 and the real iPhone workflow.**

Add analysis start/cancel iteratively after the connection/upload foundation; preserve the owner’s explicit requirement.

## Changes applied to the plan

The draft plan these items corrected was replaced by [plan 041](../plans/041-remote-view.md); its line references no longer exist.

1. **Replace the unrestricted-backend proxy with a separate remote listener.** The draft topology and header guard do not make proxy provenance trustworthy.

2. **Reserve a dedicated HTTPS origin and check Funnel state.** Replace the unconditional port-443 command. Require ownership checks, preservation of other entries and tested prefix mapping. Retain the absolute prohibition on `serve reset`.

3. **Make identity and pairing independent gates.** Replace the “identity hint” policy. State local spoofing limits, deny other/missing identities, and distinguish browser pairings from physical devices.

4. **Specify connection lifetimes and revocation.** Replace indefinite sessions and the conflicting restart/off claims with remembered device approval, short active sessions and an enable lease. Add CSRF, exact-origin checks and desktop pairing approval.

5. **Adopt tus and durable receipts.** Replace the custom protocol task. Include immutable metadata, acknowledged offsets, checksums, whole-file comparison, reselection verification, idempotency and expiration.

6. **Add persistence prerequisites.** Atomic JSON writes, failure propagation, recoverable publication, no-overwrite finalization, schema migration, stable IDs and provenance are required before declaring imports durable.

7. **Replace name/mtime integrity assumptions.** Content SHA-256 controls deduplication and rendition identity. Metadata fingerprints only detect likely changes or locate resumable transfers.

8. **Fix both desktop and phone mutation paths.** The single-decision route proposed cannot prevent legacy desktop replacement from losing edits. Require shared Operations, revisions and durable-before-event semantics.

9. **Remove automatic raw-preview fallback.** Replace the proxy behavior with asynchronous preparation, explicit failures, content-keyed caches and authenticated Range serving.

10. **Rewrite Phase 3 around rendered MP4 delivery.** The current XML/EDL trigger cannot meet the Instagram import requirement. Add snapshot-based rendering, progress, cancellation, Share preparation and Files download.

11. **Move vertical output into scope.** Replace the deferred section and out-of-scope entry. Include a 9:16 render preset without requiring a full phone editor.

12. **Correct lifecycle and Safari guarantees.** Replace “nothing listens” after crash with fail-closed application access plus stale-handler cleanup. Replace uninterrupted-lock-upload expectations with verified resumption, and add multi-GB, native share/download and crash-recovery acceptance tests.

13. **Update ADR/glossary commitments.** Amend draft ADR 0010 for the separate listener, real threat boundary, shared-tailnet identity risks and encrypted Tailscale relay transport. Its prohibition on “relay services” should distinguish third-party media storage from Tailscale’s encrypted transport fallback. Extend ADR 0004 and the glossary with Rendered MP4 while retaining existing editable Export semantics.