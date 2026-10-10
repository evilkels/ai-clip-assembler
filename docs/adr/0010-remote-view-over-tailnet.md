# 0010: Remote View over the Editor's tailnet stays Local-First

## Status

Proposed (2026-10-10). Becomes Accepted when Phase 1 of
[plan 041](../plans/041-remote-view.md) lands. Technical detail:
[docs/specs/2026-10-10-remote-view-architecture.md](../specs/2026-10-10-remote-view-architecture.md).

## Context

The PRD states the Local-First hard constraint as "no footage uploaded to any
server" and lists "mobile app" and "cloud collaboration" as out of scope. The
Connect-your-AI plan and MCP spec went further and committed to "no new network
surface": the backend binds `127.0.0.1` only, has no authentication on any
route, and relies on that bind as its sole access control.

The Editor now wants to add phone footage to a Project, review Candidate Clips
and get rendered MP4s back onto an iPhone. A native companion app was declined
on 2026-09-03. The viable alternative is a browser UI served by the Mac itself
and reached over the Editor's own Tailscale tailnet, a private WireGuard
network of devices the Editor enrolled and administers. That is not a server in
the PRD's sense, but it is a new network surface, and the current backend is
not safe to put on one.

Two facts shape the boundary. Tailscale Funnel exposure applies to a whole
listening port, so sharing a port with other Serve apps couples their exposure.
And a loopback proxy target cannot authenticate which local process is calling
it: Tailscale identity headers can be forged by any process on the Mac that
reaches the port directly.

## Decision

A **Remote View** may be exposed, opt-in, under these conditions, and only
then is it considered Local-First:

1. **Own devices only.** "Tailnet" here means the Editor's own devices.
   Exposure is via `tailscale serve` on a dedicated HTTPS port (8448) and a
   `/remote` handler. `tailscale funnel`, public URLs, third-party relay or
   media-storage services, and binding any backend listener to a non-loopback
   interface are prohibited. Footage travels phone → Mac encrypted by
   WireGuard, directly or through Tailscale's DERP relay (which forwards
   encrypted packets and stores nothing), and lands in the Project folder. A
   tailnet shared with other people, or devices shared into it, is outside this
   decision's Local-First claim; sharing is a future ADR, not a default.
2. **The app owns only its own Serve handler.** Before adding or removing it,
   the app checks `tailscale serve status`, refuses a port used by another app
   or enabled for Funnel, and verifies other entries are unchanged afterwards.
   While enabled it watches for Funnel or a foreign handler on its port and
   fails closed if one appears. `tailscale serve reset` is never invoked.
3. **Separate remote listener.** The Remote View is a separate application on
   its own loopback port, reached through a per-enable ingress path, with an
   explicit capability allow-list (pairing, Project summaries for Projects the
   Editor marks "Show on phone", verified uploads, analysis status, previews
   and review decisions, Phone Export rendering and delivery; analysis
   start/cancel later). It calls application services directly and never
   forwards to the desktop API. The desktop API and MCP endpoint keep their
   loopback bind and are never proxied; Project creation/deletion,
   arbitrary-path routes, settings, AI Access and AI: On / Off changes, and
   Provider sign-in are unreachable remotely.
4. **Two independent gates.** Every request must carry exactly the owner's
   Tailscale login (captured on enable; missing, other, tagged-device and
   Funnel-marked requests are refused) **and** a valid application pairing:
   a single-use QR token approved on the Mac, then a remembered device
   credential and a short active session that exist only while the desktop app
   is running with Remote View on. Identity headers alone never grant access.
5. **Opt-in and reversible.** Off by default. Turned on from the desktop app;
   toggle-off, quit and Revoke end sessions immediately. If Electron dies, the
   backend loses its lease and refuses remote requests; a leftover Serve handler
   is removed at next start. The guarantee is "no functioning application access
   while the app is not running with Remote View on", not "no Tailscale
   listener ever exists".
6. **Same persistence rules.** Uploads finish as ordinary Source Video files in
   the Project folder root (ADR 0003), published only after whole-file
   verification and without overwriting existing footage; the Remote View does
   not get a parallel store. Authentication records live in the app's local
   user data, never in a Project folder.

## Consequences

- The backend gains its first authentication layer, on the remote listener
  only. Code reachable from it must be written as if callers are remote.
- **Stated limitation:** the design does not protect against malicious code
  already running as the Editor's macOS user, which can reach loopback ports and
  read the app's files. Forged identity headers from such a process are stopped
  by the pairing/session requirement and the ingress path, not by the identity
  check; we do not claim the proxy hop is authenticated.
- The earlier "no new network surface" statements in the MCP plan/spec are
  narrowed, not reversed: the MCP endpoint remains loopback-only and is not on
  the remote listener.
- The app takes a soft dependency on the Tailscale CLI and on port 8448 for this
  feature only; everything else works without it.
- The PRD's "no footage uploaded to any server" is clarified to "no footage
  leaves the Editor's own devices"; the PRD should be amended when this ADR is
  accepted.
- Remote decisions and desktop edits touch the same Timeline Document. The
  desktop Review Board already decides through the shared Operations service;
  before phone review ships, decision Operations from both clients carry a
  required expected revision, every document replacement advances the
  revision, and a change is persisted before it is acknowledged or published.
  The legacy whole-document `PUT /timeline` is never on the remote listener.
- Phone Exports (rendered MP4s) are a new artifact distinct from Export; ADR
  0004 is amended when Phase 3 lands.
- Remote analysis start (later) does not bypass
  [ADR 0007](0007-ai-access-is-granted-when-connecting.md): pairing never grants
  AI Access, and AI Access plus the Project's AI: On / Off are rechecked when
  the run executes.

## References

- [Plan 041](../plans/041-remote-view.md),
  [docs/specs/2026-10-10-remote-view-architecture.md](../specs/2026-10-10-remote-view-architecture.md),
  [UX spec](../specs/2026-10-10-remote-view-ux.md)
- [ADR 0001](0001-local-first-and-cloud-consent.md), [ADR 0007](0007-ai-access-is-granted-when-connecting.md), [ADR 0003](0003-project-folder-persistence.md),
  [ADR 0004](0004-editable-export-and-edl-degradation.md)
- `docs/PRD.md` — Local-first hard constraint; Out of Scope
- `docs/plans/done/connect-your-ai-mcp.md`, `docs/specs/2026-06-28-byo-subscription-mcp-connect-design.md` — "no new network surface"
- `backend/packaging/entry.py:26`, `backend/src/api.py:98-114` — loopback bind and CORS
- Tailscale [Serve](https://tailscale.com/docs/features/tailscale-serve) and
  [Funnel](https://tailscale.com/docs/features/tailscale-funnel) documentation
