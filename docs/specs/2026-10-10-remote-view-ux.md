# Remote View — UX spec (the Editor on the phone)

**Date:** 2026-10-10
**Status:** Decision-ready. Companion to [plan 041](../plans/041-remote-view.md),
[ADR 0010](../adr/0010-remote-view-over-tailnet.md) and the
[architecture doc](../specs/2026-10-10-remote-view-architecture.md). Mockup:
[docs/designs/remote-view/remote-view.html](../designs/remote-view/remote-view.html).
**Scope:** what the Editor sees and does. This spec is authoritative for UX;
the architecture doc is authoritative for internals (listener, pairing and
session lifetimes, upload protocol, integrity, previews, rendering) and this
spec references it only where the UX depends on it.

## Who and why

The **Editor** shoots on an iPhone, has the Mac at home running AI Clip
Assembler, and wants to (a) get the footage into a **Project** without cables,
(b) know what the Mac is doing, (c) look through **Candidate Clips** and
**Accepted Clips** on the phone, and (d) get finished clips back onto the phone
as MP4s (original or 9:16) to build a reel in Instagram's editor. Everything
happens over the Editor's own Tailscale tailnet; nothing is public. Security
and privacy of that link are the top priority and must be *visible*, not just
true.

## Terms

These terms join `GLOSSARY.md` as their phase lands ([plan 041](../plans/041-remote-view.md) tasks 1.20 and 3.7); summarized:

| Term | Meaning here |
| --- | --- |
| **Remote View** | The phone UI the Mac serves over the Editor's tailnet, gated by the owner's Tailscale identity and an approved pairing. |
| **Paired Device** | One browser approved on the Mac (Safari and a Home Screen install count separately). Remembered until disconnected, revoked, or unused for 30 days (90 days at most). |
| **Mac Job** | An analysis run or Phone Export render on the Mac that the phone watches; it keeps going when the phone locks. |
| **Phone Export** | A rendered MP4 made on the Mac for the phone. Not an **Export** (FCPXML/EDL/Resolve XML). |

## Principles

1. **The Mac is the truth; the phone is a view of it.** Every screen shows
   what the Mac has, not what the phone wishes. The phone holds only the
   in-flight upload queue, its pairing and queued decisions.
2. **Connection state is always on screen.** One status element, same place on
   every screen; tapping it is the way to see who is connected and to
   disconnect.
3. **Say exactly what is true.** "Sent" is not "imported"; "Ready on the Mac"
   is not "on this phone"; "Shared" is not "saved to Photos". Each state names
   the step that actually completed.
4. **Jobs are the Mac's, so leaving is safe.** Analysis and renders keep going
   on the Mac when the phone locks. Sending bytes is the one thing that needs
   Safari in front; the UI says so and resumes from the last confirmed chunk.
5. **Mobile-first, same design system.** Tokens from `tokens.css` (neutral
   scale, rose accent, mono labels), system font, follows the OS light/dark
   setting. Single column, thumb-reachable actions at the bottom, sheets
   instead of modals, no hover-only affordances.
6. **Simple and classy.** Few words, tabular numbers, one accent. Nothing
   bounces.

## Information architecture

```text
Pair ─▶ (Approve on the Mac) ─▶ Projects ─▶ Project
                      ├─ Now on the Mac (analysis / render / idle)  ← job (b)
                      ├─ Clips (grid)  ─▶ Clip (player)             ← job (c)
                      │       └─ Select ─▶ Export to phone (sheet) ─▶ Phone Exports  ← job (d)
                      ├─ Footage (sources list) ─▶ Add footage (uploads)      ← job (a)
                      └─ status pill ─▶ Connection sheet (disconnect)
Mac: Settings ─▶ Remote View (toggle, QR, approve, Projects on phone, paired devices, revoke)
```

Phase order: Phase 1 = Pair + approval, Projects, Footage/uploads, Now on the
Mac. Phase 2 = Clips grid, Clip player, accept/reject. Phase 3 = Export to
phone. Later = start/cancel analysis from the phone, light Timeline.

The URL is `https://<mac>.<tailnet>.ts.net:8443/remote/` — a dedicated port, so
the bookmark never collides with other apps the Editor serves from the Mac.

## Screens

### 1. Pair (unpaired)

- Opened from the QR (Camera app → Safari). The pairing token is in the URL
  fragment; the page removes it from the address bar immediately. Title "Pair
  with your Mac", one sentence, one primary button **Pair**. There is no typed
  code: pairing is QR-only (the token is 32 random bytes).
- After **Pair**, the screen becomes **Approve on your Mac**: "macbook-pro is
  asking you to approve this phone. Settings → Remote View → Approve." It shows
  what the Mac will see ("iPhone · Safari · elvijs@…") and a **Cancel**. When
  the Editor approves, it goes straight to Projects; if denied: "The Mac
  declined this phone." The QR is single-use and expires after 5 minutes:
  "Code expired — show a new one on the Mac."
- Footer line states the host with port and "your tailnet only, never public".
- Reasons for landing here are shown as a quiet banner above the title:
  - "You disconnected this phone." (Disconnect on the phone)
  - "This phone was removed from macbook-pro." (Revoke / Revoke all)
  - "It's been a while — scan a new code on your Mac." (device approval
    expired: 30 days unused or 90 days since approval)
  - "This is the Home Screen app — it pairs separately. Scan the code on your
    Mac." (first launch of an installed copy)
- After a successful pair, a one-time card offers **Add to Home Screen** with
  the two-step Safari instruction (Share → Add to Home Screen) and says the
  installed app pairs once more. Dismissable; the offer returns from the
  Connection sheet.

### 2. Projects

- Projects the Editor has marked **Show on phone** in Settings → Remote View
  (folder Projects from the Mac's Recent Projects; off by default per Project), each with name, source count and a
  one-word state (`not analyzed`, `analyzing 62%`, `31 clips`).
- Empty: "No Projects shared with this phone. On the Mac: Settings → Remote
  View → Show on phone." No create/delete from the phone.
- Status pill in the header (see Connection).

### 3. Project

- Header: back, Project name, status pill.
- **Now on the Mac** card, always present:
  - Idle: "Idle · 14 sources · 31 clips · last analyzed 2 h ago".
  - Analyzing: phase, percent, elapsed/remaining, a thin progress bar; tapping
    opens the Analysis screen (phase list; start/cancel is "later").
  - Rendering a Phone Export: "Rendering 2 of 3 clips · 1080p" with a bar;
    tapping opens Phone Exports.
  - Failed or interrupted: the Mac's error text, one line, and "Details".
- **Clips** section: segmented control `Candidates · Accepted · All`, sort
  `Score · Time · Length`, grid (two columns; cells take the source aspect,
  so phone footage is portrait and drone footage landscape). Each cell:
  thumbnail, duration badge, Overall Score chip, a check mark when accepted.
  Tapping opens the Clip player; **Select** in the section header enters
  multi-select.
- **Footage** row: "14 Source Videos" → list with name, duration, size and the
  upload state from §7 for anything still in flight (`sending 63%`,
  `verifying`, `imported`).
- Bottom action bar (safe-area aware): **Add footage** (primary when there are
  no clips; secondary otherwise) and **Export to phone (n)** when a selection
  exists.
- Empty clips: "No clips yet. Analyze on the Mac — or start it from here (coming
  later)."

### 4. Clip (player)

- Full-width `<video playsinline>` of the prepared 720p preview, bounds locked
  to the Candidate Clip (loops within bounds), scrubber, timecode `00:42.3 →
  00:48.9 · 6.6 s`, rank and Overall Score.
- Score chips (Smoothness, Sharpness, Exposure; Visual Interest when present),
  Look Group hint, Clip Reason.
- Actions: **Reject** / **Accept** (optimistic, instant; the card advances when
  in Candidates; a toast with Undo for 5 s). If the Mac changed the clip in the
  meantime, the decision is refused and reverted: "Changed on the Mac — showing
  the latest." **Export to phone** as a secondary button. Swipe left/right (or
  ‹ ›) for previous/next in the current list.
- Preview states: "720p preview" label when playing. Before the preview exists:
  poster frame and "Preparing preview…", then auto-play. If preparation fails:
  "Couldn't prepare a preview: `<reason>`" and **Try again**. The phone never
  falls back to streaming the original footage.
- A **Lite (480p)** switch appears on a relayed path only if the relayed-path
  test shows 720p stalls (open question 6).

### 5. Export to phone (sheet)

Opened from a Clip or from a selection. A bottom sheet with three decisions,
each defaulting to the Instagram-ready choice:

| Choice | Options (default first) | Notes |
| --- | --- | --- |
| What | **Each clip as its own file (n)** · The Edit (one video) | Each clip renders the Candidate Clip's bounds, or for an Accepted Clip its Timeline Item (trim, Speed, Transform). The Edit is the Timeline in its current order, captured when Render is tapped; later edits don't change it. |
| Frame | **Original (9:16 portrait)** when the source is portrait; otherwise **Vertical 9:16 · centre crop** · Vertical 9:16 · fit · Original 16:9 | Crop and fit show a 9:16 preview frame over the poster. Manual reframing is the desktop Transform; no automatic subject tracking. |
| Audio | **Source audio** · Muted | Only when the source has audio. |

Output is fixed at Instagram-ready 1080p (1080×1920 for 9:16), H.264 + AAC,
with the estimated size per option, e.g. "~14 MB". Primary button **Render on
Mac (3 clips · ~42 MB)**. The sheet closes into Phone Exports. No render happens
on the phone.

### 6. Phone Exports

- One row per Phone Export: thumbnail, name (`IMG_4513 · clip 7 · 9:16`) and
  state. On the Mac: `queued` → `rendering 48%` → `checking` → **Ready on
  Mac**. Then on this phone: **Get video** → `getting 63%` → **Share video** /
  **Download** → `Shared · 2 min ago` or `Downloaded · in Files`.
- **Share video** opens the iOS share sheet with the MP4 (Save Video puts it in
  Photos; Instagram may appear as a target). The row says "Shared", never
  "Saved to Photos" — the phone can't confirm where it went.
- **Download** is always offered and needed for large files (above ~100 MB,
  Share is replaced by "Too large to share directly — Download, then share
  from Files"). It lands in Files → Downloads, not Photos; the row links a
  one-line how-to: "In Files, tap the video → Share → Save Video." Recommend
  "On My iPhone" so it isn't uploaded to iCloud Drive.
- **Cancel** on queued/rendering rows; failed or interrupted rows show the
  Mac's error in one line and **Try again**.
- A one-line tip under the list: "Save Video from the share sheet, then in
  Instagram: New reel → pick from Photos."
- Phone Exports stay on the Mac (in the Project's `exports/mp4/`) until the
  Editor removes them, so any Paired Device can get them again; **Remove from
  Mac** per row. Getting or sharing never deletes the Mac's copy.
- The phone may lock or leave; rendering continues on the Mac and the row
  catches up on return. Getting the file to the phone needs Safari in front.

### 7. Add footage (uploads)

- Picker (Photos/Files, multi-select, `video/*`); one file sends at a time,
  the rest wait. Per-file row with progress bar, size, speed and a state:

  | State | Row says | Meaning |
  | --- | --- | --- |
  | queued | `waiting` | Not started. |
  | sending | `63%` + bar | Bytes going to the Mac in checked chunks. |
  | paused | `paused — return to resume` | Safari went to the background or the screen locked. Resumes from the last chunk the Mac confirmed. |
  | retrying | `retrying` · "resumed at 12.3 MB" | Network blip; automatic. **Retry now** available. |
  | verifying | `verifying on Mac` | All bytes received; the Mac is rereading the file and comparing its fingerprint with the phone's. |
  | imported | `imported · verified` | The file is in the Project folder and matches byte for byte. Only now is it a Source Video. |
  | already there | `already in Project` | Same content was already imported; nothing duplicated. |
  | recovery | `finishing import…` | The Mac restarted mid-import and is completing it. |
  | failed | one-line reason + **Retry** | See errors below. |

- Under the list: "Keep Safari open on this screen while sending. If the phone
  locks, sending pauses and picks up where it stopped." The screen is kept
  awake while sending, but that is a convenience, not a promise.
- If Safari reloaded and lost the files: "Pick IMG_4514.MOV again to continue."
  The Mac checks the bytes it already has; if the file differs it starts over.
- The Project's source count on the Mac updates when a row reaches
  `imported`.
- Analyze after upload: a toggle on this screen, off by default in Phase 1
  (the control says "start on the Mac" until remote start ships).

### 8. Connection sheet

Tapping the status pill on any screen opens a bottom sheet:

- "Connected to **macbook-pro** · as iPhone · Safari · since 09:38"
- Path: **Direct (Wi-Fi)** or **Relayed** (with the hint "previews may be
  slower"). Taken from the tailnet status the Mac reports.
- Mac state: "App open · Remote View on · 1 device connected".
- Link: "Your tailnet only, never public · signed in as elvijs@…".
- **Disconnect this phone** — one tap, no confirmation; the Mac forgets this
  phone's approval and the phone returns to Pair with "You disconnected this
  phone." Reconnecting needs a new scan and approval on the Mac.
- **Add to Home Screen** (if not installed) and **Show this phone's name on
  the Mac** (read-only).

### 9. Mac — Settings → Remote View

- Toggle **Remote View** (off by default). Copy: "Serves this app to your own
  devices over your Tailscale tailnet. Never public. Turning it off or quitting
  ends every session; approved devices reconnect when you turn it back on."
  Below it the live URL with port, and a readiness line that walks the
  prerequisites:
  `Tailscale installed ✓ · signed in as elvijs@… ✓ · certificate ready ✓ · port 8443 free, Funnel off ✓ · serving ✓`.
  Each unmet step has one sentence and, where useful, the manual command.
- **Conflict state** (port 8443 used by another app, Funnel turned on, or our
  handler changed): Remote View switches itself off, sessions end, and the
  panel says what it found and that it changed nothing else. Turning it back on
  is deliberate.
- **Pair a device**: QR, "works once · expires in 4:40", **New code**. Shown
  only when serving is ready.
- **Waiting for approval**: when a phone has scanned, a row "iPhone · Safari ·
  elvijs@… wants to connect" with **Approve** / **Deny**. Unanswered requests
  lapse with the code.
- **Show on phone**: the Mac's Recent Projects (folder Projects), each with a
  checkbox, unchecked by default. Only checked Projects are visible to Paired
  Devices; a checked Project that is not open on the Mac is opened by the Mac
  in the background when the phone asks for it.
- **Paired devices**: label, the tailnet login it paired with, when approved,
  last seen, a green dot and "connected now" when a session is live, and
  **Revoke** per row; **Revoke all** underneath ("Revoking ends that device's
  session at once; it must scan and be approved again").
- **Keep this Mac awake while Remote View is on** (default on). Without it the
  phone sees "Can't reach macbook-pro" after the Mac sleeps.
- When any device is connected the app header shows a small "Remote · 1"
  indicator so the Editor at the desk always knows.

## Connection states (phone)

The pill colours are backed by text; never colour alone.

| State | Pill | What the phone does | How it knows |
| --- | --- | --- | --- |
| Connected | green dot · "macbook-pro" | Normal. Live updates. | Event stream open or a request succeeded <5 s ago. |
| Reconnecting | amber dot · "Reconnecting…" | Screens stay usable with the last data, marked "as of 12 s ago". Accept/Reject still allowed, queued, replayed on reconnect (max 20; after that disabled). Uploads pause and resume. | Event stream dropped; retrying with back-off. Also shown briefly while an idle session is renewed. |
| Can't reach | grey dot · "Can't reach macbook-pro" | Full-width card: "Is the Mac awake, Tailscale on, and Remote View on? Tap to retry." Cached screens remain readable. | Requests time out or fail at the network level. |
| App not running | grey dot · "App isn't open on the Mac" | Card: "Open AI Clip Assembler on macbook-pro." | Tailscale answers but nothing is behind it (502), e.g. after a crash. |
| Remote View off | grey dot · "Remote View is off" | Card: "Turned off on the Mac. This phone stays approved and reconnects when it's back on." | The Mac said so before closing (final event or 503 from the remote app). If the phone was not open at the time, it shows "Can't reach" instead. |
| Not paired | no pill | Pair screen with the reason banner. | 401 with a reason: disconnected, revoked, approval expired, or never paired. |

Session lifetimes, as the Editor experiences them:

| Event | What the Editor sees |
| --- | --- |
| Phone idle >15 min, Remote View still on | Nothing to do: the next request renews the session (a brief "Reconnecting…" at most). |
| Toggle off or quit on the Mac | "Remote View is off" / "Can't reach"; on re-enable the phone reconnects without scanning. |
| Revoke / Revoke all on the Mac | Pair: "This phone was removed from macbook-pro." New scan + approval. |
| Disconnect on the phone | Pair: "You disconnected this phone." New scan + approval. |
| 30 days unused, or 90 days since approval | Pair: "It's been a while — scan a new code on your Mac." |
| Mac signed into a different Tailscale account | Mac shows the change and keeps Remote View off until the Editor re-enables it for the new account; phones see "Remote View is off". |

Rules:

- On `visibilitychange` → visible and on `online`, re-sync immediately (do not
  wait for back-off).
- Any screen can be rendered from cached data with a "stale" marker; nothing
  blocks on the network except actions. (Cached in memory/IndexedDB metadata
  only; no service-worker caching of API data or media.)
- Pending optimistic actions are listed in the Connection sheet ("2 decisions
  waiting to sync") so the Editor is never surprised.

## Latency and optimistic UI

| Interaction | Behaviour |
| --- | --- |
| Accept / Reject | Optimistic. Card updates and advances immediately; Undo toast 5 s; a conflict or server rejection reverts with a toast. Desktop reflects it live (SSE). |
| Start/cancel analysis (later) | Button shows a spinner until the Mac acknowledges; the card then follows the Mac's status and says whether the run is rule-based or uses the Editor's Provider ("with Claude" / "with ChatGPT"), per the Mac's AI settings for this Project. |
| Progress (analysis, render, upload verify) | Pushed by the Mac about once a second. If no update for 5 s the number is marked "as of n s ago". |
| Thumbnails | Small JPEGs; skeleton cells until loaded. The grid never reflows after load (aspect known up front). |
| Playback | Prepared 720p preview served with range requests, made on first request; poster + "Preparing preview…" until ready; explicit error otherwise. |
| Pairing | Direct feedback on Pair tap, then "Approve on your Mac"; errors are "Code expired — show a new one on the Mac", "Already used — show a new one on the Mac", "The Mac declined this phone", "Too many tries — wait a few minutes". |

## Notifications

- **Page open:** inline. The Now-on-the-Mac card changes state; a Ready row
  appears under Phone Exports; a subtle toast "Ready on Mac" if the Editor is
  on another screen.
- **Page backgrounded:** iOS suspends the page; nothing can fire. On return the
  phone re-syncs and shows a "While you were away" line on the Project screen
  ("Analysis finished · 3 ready on Mac").
- **Web Push:** available on iOS 16.4+ **only for home-screen web apps**, after
  a permission prompt from a user gesture. The payload is end-to-end encrypted
  by the Web Push standard but is routed through Apple's push service, so the
  Mac needs internet access and a few encrypted bytes leave the tailnet.
  Recommendation: ship Phase 3 without it; offer it later as an opt-in with
  that sentence in the UI, payload limited to "Ready on Mac" / "Analysis
  finished". The Badging API has the same constraints and is bundled with it.

## Pairing, disconnecting, revoking

- **Pair:** Mac shows QR → Camera → Safari → Pair → Approve on the Mac →
  Projects. Under a minute.
- **Add to Home Screen:** offered once after pairing; home-screen web apps on
  iOS have their own storage, so the installed app pairs separately (a second
  scan and approval, listed as its own device). The installed app opens on Pair
  with "This is the Home Screen app — it pairs separately"; the Mac's **New
  code** is one click.
- **Disconnect (phone):** Connection sheet → Disconnect this phone. One tap.
- **Revoke (Mac):** Settings → Remote View → device row → Revoke. Active
  uploads and playback stop; the phone lands on Pair with "This phone was
  removed".
- **Toggle off (Mac):** every session ends; phones show "Remote View is off"
  and stay approved.
- **Quit the app:** same as toggle off. After a crash, phones see "App isn't
  open on the Mac" until it restarts.

## Empty and error states

| Situation | Copy (one line) | Action |
| --- | --- | --- |
| No Projects shown on phone | No Projects shared with this phone. On the Mac: Settings → Remote View → Show on phone. | — |
| Project not analyzed | No clips yet. Analyze on the Mac. | Add footage |
| Analysis failed | Analysis stopped: `<error>` | Details · (retry later) |
| Upload: wrong type | Only .mp4 and .mov can be sent. | — |
| Upload: Mac disk nearly full | The Mac is low on space for this file. | Retry |
| Upload: verification failed | The file on the Mac didn't match this phone's copy. Nothing was imported. | Retry (starts over) |
| Upload: reselected file differs | This isn't the same file as before. | Send as new |
| Upload: expired | Paused too long (7 days); the partial file was removed. | Send again |
| Preview preparing | Preparing preview… | plays when ready |
| Preview failed | Couldn't prepare a preview: `<reason>` | Try again |
| Render failed | Couldn't render: `<ffmpeg summary>` | Try again · Remove |
| Too large to share directly | Too large to share directly — Download, then share from Files. | Download |
| Share not supported (old iOS) | Download instead — it lands in Files; share it to Photos from there. | Download |
| Code expired / used | Code expired — show a new one on the Mac. | — |
| Mac declined | The Mac declined this phone. | — |
| Tailscale missing on Mac | Install Tailscale and sign in, then turn Remote View on. | Open tailscale.com |
| Port or Funnel conflict (Mac) | Remote View is off: port 8443 is in use by another app / has Funnel on. Nothing else was changed. | Details |

## Accessibility

- Tap targets ≥ 44×44 pt; primary actions 50 pt tall; grid cells ≥ 150 pt.
- Type in `rem`; `font: -apple-system-body` so iOS Dynamic Type scales the
  base; layouts hold at 150 %. Numbers tabular.
- `prefers-reduced-motion`: no card advance animation, no shimmer; fades only.
- VoiceOver: status pill is a button with the state as its label; progress
  bars have `aria-valuenow`; the Now-on-the-Mac card is `aria-live="polite"`;
  grid cells are buttons labelled "Clip 7, 6.6 seconds, score 8.4, accepted".
- Colour is never the only carrier: states have words and icons.
- Safe areas (`viewport-fit=cover`), no hover-only affordances, `touch-action:
  manipulation`, 16 px minimum input text so Safari doesn't zoom.

## Security and privacy in the UX

- The host with port and "your tailnet only, never public" appear on Pair and
  in the Connection sheet; the Mac's toggle copy says the same.
- A phone gets in only if it is signed into the Editor's own Tailscale account
  **and** the Editor approves it on the Mac. The Mac shows both.
- Who is connected is visible on both ends: the phone shows its own label and
  the login as the Mac sees them; the Mac lists devices with last seen and a
  live dot, and the app header shows "Remote · n" while anyone is connected.
- One-tap disconnect on the phone; per-device Revoke and Revoke all on the Mac;
  toggle off and quit end every session.
- Only Projects marked "Show on phone" are visible. No credentials, settings,
  AI Access or AI: On / Off, chat or MCP are reachable from the phone; the UI has no entry
  points for them.
- Downloads go to Files; Photos and Files may sync to iCloud according to the
  phone's own settings, which Remote View cannot control. The Download how-to
  suggests "On My iPhone".
- Internals: [architecture §3](../specs/2026-10-10-remote-view-architecture.md#3-pairing-sessions-and-authorization)
  (pairing and sessions), [§5–6](../specs/2026-10-10-remote-view-architecture.md#5-resumable-uploads-and-integrity)
  (uploads and integrity), [§9](../specs/2026-10-10-remote-view-architecture.md#9-mp4-delivery-to-the-phone)
  (rendering and delivery).

## Resolved UX questions (owner defaults, 2026-10-10)

Resolved by the architecture doc: the Home Screen app pairs separately with its
own scan (one QR redeems once); large files use Download, with a ~100 MB share
budget to validate on device; previews never fall back to raw footage.

1. **Stitching an arbitrary selection.** Resolved: only the Edit (Timeline
   order) is stitched. Phase 3 offers "each clip" or "the Edit"; stitching an
   arbitrary selection is not planned.
2. **9:16 for landscape sources.** Centre crop is the default with fit as the
   alternative, both with a preview frame; reframing stays on the desktop
   (Transform). Smart crop (follow subject) is out of scope.
3. **Full-resolution Phone Exports.** Resolved: 1080p only. A "Full" quality
   is listed under Later in plan 041.
4. **Push notifications.** Deferred (Later in plan 041); opt-in, with the
   privacy sentence above.
5. **Remote start/cancel of analysis.** Resolved: after Phase 3 (Later in
   plan 041). Phase 1 ships the control disabled with "start on the Mac"; when
   it ships it uses the Mac's saved scoring choice and AI settings only.
6. **Lite 480p preview.** Only if the relayed-path test (plan 041 H3) shows
   720p stalls; otherwise one preview size.
7. **Port 8443 already in use.** Resolved: Remote View refuses to turn on and
   says so; it never picks another port.
8. **"Show on phone" default.** Resolved: off for every Project until the
   Editor checks it.
