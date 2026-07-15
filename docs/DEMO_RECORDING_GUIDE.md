# Demo Recording Guide

A maintainer-owned, immediately usable guide for recording the 45–60 second
proof-of-work demo called for in
[`docs/plans/landing-page-polish-and-launch.md`](plans/landing-page-polish-and-launch.md#demo-video-brief).
That plan defines *why* the demo exists and the launch sequence around it;
this guide defines exactly *how* to shoot it, script it, name the files, and
hand them to a coding agent for compression and embedding.

This is a recording and file-handling guide, not a video-editing tutorial. It
does not pick an NLE for you or teach editing technique.

## Who does what

You (the maintainer) own capture end-to-end: choosing footage, proving the
workflow on the real distributable build, recording, and approving the result.
A coding agent only compresses, generates the poster/captions/loop, and embeds
the approved deliverables on the landing page — it does not invent shots,
narration, or UI states that the released app cannot reproduce.

## 1. Prerequisites

- The **released DMG build** installed the normal way (drag to Applications,
  first launch through Gatekeeper) — not a dev checkout run via
  `npm run dev:with-backend`. The plan's brief is explicit: "Do not record a
  path the released app cannot reproduce."
- 8–15 representative source clips (drone, action-camera, or travel footage)
  that you own or have explicit permission to publish. See the checklist in
  §2 before anything is imported.
- A clean macOS user account or machine: no personal desktop clutter, no
  unrelated open apps, Do Not Disturb / Focus mode on so no notification
  banners can appear mid-recording.
- A capture tool of your choice. None of these are repo dependencies —
  pick whichever fits your workflow:
  - **Screen Studio** (paid, polished cursor/zoom treatment) — Mac App Store
    or [screen.studio](https://screen.studio).
  - **OBS Studio** (free) — [obsproject.com](https://obsproject.com).
  - **macOS built-in** — `Cmd+Shift+5` (Screenshot app) or QuickTime Player's
    "New Screen Recording," no install required.
  - **Cap** (open source alternative, Studio Mode) —
    [cap.so](https://cap.so).
- An NLE to finish the edit and to prove the export handoff at the end of the
  shot list (DaVinci Resolve or Final Cut Pro — whichever the app version you
  demo actually targets).
- `ffmpeg`/`ffprobe` on `PATH` for the compression and asset-generation
  commands in §10 (the same toolchain the app itself depends on — see the
  root [`README.md`](../README.md#getting-started) — but here you are invoking
  it directly, not through the app).

## 2. Real-footage rights and privacy checklist

Work through this **before** you open the Import tab. Nothing below is
optional — the demo is published publicly.

- [ ] You own every source clip, or have explicit written/recorded permission
  to publish it (this includes stock/licensed footage — keep the license
  terms alongside the usage notes in §8).
- [ ] Any bystander who is identifiable on camera has consented to appear in
  published material, or their face is cropped/blurred out before recording.
- [ ] Clip filenames shown in the Import tab's source-video table contain no
  private information (home addresses, real names, dates that reveal a
  routine, internal project codenames). Rename files beforehand if needed —
  don't rely on cropping the table column.
- [ ] GPS/location metadata that would reveal a home address or other private
  location is stripped from clips you don't want geotagged publicly (`exiftool
  -gps:all= -location:all=` or your camera app's export-without-metadata
  option). This is separate from the video content itself.
- [ ] No API keys, auth tokens, personal emails, or account usernames are
  visible anywhere in the Finder, terminal, browser, or app chrome that will
  be on screen.
- [ ] If the take shows a provider-backed harness or connected external AI,
  you have chosen the provider intentionally, enabled any required project
  consent, and will disclose that provider interaction. Do not describe that
  optional segment as local-only or “no upload.”
- [ ] macOS notifications are off (Control Center → Focus → Do Not Disturb)
  and Bluetooth/AirDrop popups won't interrupt the take.
- [ ] The desktop background, menu bar clock/battery, and any visible browser
  bookmarks bar are clean enough to publish, or will be cropped in the final
  frame.
- [ ] If you add music or a font in the edit (not required — see §6), you have
  a license that permits public, commercial-adjacent use, and you've recorded
  the license terms in the usage notes (§8).

## 3. Dry run — prove the real workflow first

Do this once, off camera, before you record. It is the maintainer task the
launch plan calls "Prove the real workflow":

1. On the distributable build, create/open a folder project from your chosen
   footage folder.
2. Run **Analyze** and let it finish.
3. Review Candidate Clips: include at least one, exclude at least one.
4. Make one visible edit on the Timeline tab (reorder, trim, or adopt a
   Version).
5. Export (FCPXML, EDL, or Resolve XML) and actually open that file in the
   target NLE (Final Cut Pro or DaVinci Resolve).

If any step above fails, produces a workaround a normal user wouldn't have, or
requires functionality the shipped app doesn't have — **stop**. See §9 (Stop
conditions) before you touch a capture tool. Recording over a workflow that
doesn't actually work turns the demo into a false claim.

## 4. Shot table (45–60 seconds)

Tied to the actual tab names and control labels in the current UI (see
[`USER_GUIDE.md`](USER_GUIDE.md) and [`UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md)
for the underlying terms). Treat the timings as a budget, not a stopwatch —
what matters is the order and that every second shown is real.

| Time | Tab / screen | Exact UI to show | Proof it conveys |
|---|---|---|---|
| 0:00–0:05 | Finder | A folder of unsorted raw clips (and, optionally, a still of the target cut) | The problem and the promised outcome |
| 0:05–0:14 | **Import** tab | Click **Create / Open Folder Project**, choose the footage folder, the source-videos table populates with duration/FPS/codec | The app accepts a normal creator folder, no special prep |
| 0:14–0:26 | Import → **Review** tab | Click **Analyze**, show the progress state, land on the Review Board with Candidate Clips ranked and scored | The app does real local analysis, not a canned demo |
| 0:26–0:38 | **Review** tab | Drag the **Smoothness ≥** slider, click **Include** on one clip and **Exclude** on another; optionally open the Version gallery, **Focus** a Version, click **Apply to working timeline** | The editor stays in control; AI-proposed Versions are optional, not automatic |
| 0:38–0:48 | **Timeline** tab | Drag a clip block to reorder, drag a trim handle on another, scrub the ruler/playhead | The output is an editable timeline, not a locked render |
| 0:48–0:56 | **Export** tab → NLE | Click **Export for DaVinci Resolve** (or **Export FCPXML**), click **Copy** on the resulting path, then switch to Resolve/FCP and import that file | The handoff to a professional editor really works |
| 0:56–1:00 | Title card | Product name, "macOS · free & open source," download URL/CTA | The next step is unambiguous |

Capture at 2560×1440 or 1920×1080 so the app stays legible at the landing-page
embed size. Prefer one continuous take; cuts may trim waiting time (analysis
progress, export writing) but must not imply a capability you didn't actually
demonstrate. Avoid synthetic mouse thrashing — move with purpose, pause
briefly on each result so a viewer can read it.

## 5. Capture setup

These are recording-time settings, not app settings. Pick one tool from §1 and
apply the same idea in whichever UI it exposes:

- **Resolution/frame rate:** record at 2560×1440 or 1920×1080, 30 fps (60 fps
  only if your cursor-zoom tool benefits from it — it does not change the
  timeline math above).
- **Cursor:** enable smooth-cursor/click-highlight treatment if your tool
  offers it (Screen Studio and Cap's Studio Mode do this automatically); with
  OBS or macOS's built-in recorder, just move deliberately since there's no
  automatic cursor polish.
- **Window:** record the app window only (not the full desktop) if your tool
  supports window capture, so no other desktop content risks leaking into
  frame.
- **Audio:** if you're recording voiceover live, capture it in the same
  session on a separate track your tool supports; otherwise record a silent
  capture and add voiceover in the edit (see §6 — a silent capture is easier
  to repair and doubles as the landing-page loop source).
- **Before hitting record:** re-check the §2 checklist one more time — it's
  much cheaper to fix now than to re-shoot after publishing.

## 6. Voiceover and caption script

Keep this separate from the shot table above — the shot table is what's on
screen, this is what's heard/read. Record voiceover in its own pass if you
want one; a silent capture is also fine and becomes the muted landing-page
loop by construction.

| Cue | Timecode | Line |
|---|---|---|
| 1 | 0:00–0:05 | "This is what a raw drone folder looks like before AI Clip Assembler touches it." |
| 2 | 0:05–0:14 | "Point it at the folder. The default analysis reads every clip locally — no upload." |
| 3 | 0:14–0:26 | "Analyze finds the smooth, sharp, well-exposed moments and turns them into candidate clips." |
| 4 | 0:26–0:38 | "I review the suggestions, keep the ones I want, drop the rest — and I can compare an AI-proposed cut before I touch anything." |
| 5 | 0:38–0:48 | "The result is a real, editable timeline — reorder it, trim it, it's still just clips." |
| 6 | 0:48–0:56 | "Export straight into DaVinci Resolve — or Final Cut, or any EDL editor — and keep working." |
| 7 | 0:56–1:00 | "AI Clip Assembler. Free, local-first, macOS. Link below." |

Caption cues should match these timecodes 1:1 (one WebVTT/SRT cue per line
above); don't add filler captions that aren't spoken, and don't caption "AI
Clip Assembler" any differently from how it's said. If you skip voiceover
entirely, still ship captions — reuse the same lines as on-screen text cards
or omit narration cues and caption only what's shown (e.g. "Import →
Analyze").

## 7. File and asset naming contract

Use this naming pattern for every take so a coding agent (or future you) can
tell what's approved without opening each file. Prefix every filename for one
recording session with the capture date, `YYYY-MM-DD`:

```
2026-07-20-demo-master.<capture-ext>       # Highest-quality capture/project archive (ProRes, .cap, Screen Studio project, etc.)
2026-07-20-demo-full.mp4                   # 45-60s H.264 master export, actual runtime in the transcript, not the filename
2026-07-20-demo-full.en.vtt                # WebVTT captions for demo-full
2026-07-20-demo-full.en.srt                # Optional SRT alternative, same cues
2026-07-20-demo-loop.mp4                   # 15-25s muted landing-page loop cut
2026-07-20-demo-poster.webp                # 16:9 poster frame (WebP preferred)
2026-07-20-demo-poster.jpg                 # 16:9 poster frame (JPEG fallback)
2026-07-20-demo-transcript.md              # Verbatim on-screen/spoken text, timecoded
2026-07-20-demo-usage-notes.md             # Footage/music/font/graphic source + license notes
```

If you record more than one take on the same date, suffix with `-take2`,
`-take3`, etc. before the file-type segment (e.g.
`2026-07-20-demo-master-take2.mov`). Once you approve a take, tell the coding
agent which dated prefix is canonical — don't rename files to strip the date,
since the date is what disambiguates re-shoots.

This guide does not choose the final path inside `site/` — that's decided
when the coding-agent task "Embed the lightweight demo with a poster and
accessible controls/fallback" (see the launch plan) is implemented. Hand off
the dated files above from wherever you staged them; don't commit large master
captures into the repo yourself.

## 8. Required deliverables

Match the launch plan's brief exactly:

- [ ] `demo-master` — the highest-quality capture/project archive.
- [ ] 45–60 second H.264 MP4 with captions (`.vtt` or `.srt`).
- [ ] 15–25 second muted landing-page loop cut — still needs visible controls
  and a reduced-motion/static-poster fallback once embedded (the coding
  agent's job, not yours).
- [ ] 16:9 poster image in WebP or JPEG.
- [ ] Transcript and source/usage notes for every footage clip, music track,
  font, and graphic used.
- [ ] Optional vertical/social cut — only after the canonical demo above is
  approved.

Avoid GIF as a fallback; it's heavier and less accessible than MP4 plus a
static poster.

## 9. Stop conditions

Stop recording — don't work around it, don't cut away and pretend it didn't
happen — if any of these show up on the released build:

- A step in the shot table (§4) doesn't work the way it's described in
  [`USER_GUIDE.md`](USER_GUIDE.md) or [`MANUAL_QA_GUIDE.md`](MANUAL_QA_GUIDE.md)
  on the distributable DMG.
- Analysis fails, crashes, or needs a manual workaround (e.g. missing
  `vidstabdetect` — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)) that a
  normal downloader wouldn't be able to fix themselves.
- Export produces a file that DaVinci Resolve or Final Cut Pro can't import
  cleanly, or that needs relinking despite following the documented folder-
  project flow.
- Any error dialog, indefinite spinner, or visible glitch would require
  hiding it with a cut that misrepresents how the app behaves.
- A feature the shot table depends on (e.g. the Version gallery's **Apply to
  working timeline**) is absent, disabled, or broken in the shipped build
  even though it's documented.

When you hit a stop condition: file a GitHub issue describing exactly what
broke (see [`docs/agents/issue-tracker.md`](agents/issue-tracker.md) and the
bug template in [`QA.md`](QA.md)), fix or wait for a fix, then re-run the dry
run in §3 before recording again. Do not publish a demo that shows a workflow
the current release can't actually reproduce.

## 10. FFmpeg reference commands

Placeholders (`INPUT`, timestamps, filenames) — replace with your actual dated
files from §7 before running. These operate on your own captured files, not
through the app's bundled FFmpeg runtime.

**Compress the master to a web-ready MP4:**

```bash
ffmpeg -i 2026-07-20-demo-master.mov \
  -vf "scale=1920:-2,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 \
  -c:a aac -b:a 160k \
  -movflags +faststart \
  2026-07-20-demo-full.mp4
```

**Pull a poster frame at a chosen timestamp (pick a frame that reads well as a
static image, e.g. mid-Review):**

```bash
ffmpeg -ss 00:00:30 -i 2026-07-20-demo-full.mp4 \
  -frames:v 1 -q:v 2 \
  2026-07-20-demo-poster.jpg

# WebP version (requires the `cwebp` tool from libwebp, or use ffmpeg directly):
ffmpeg -i 2026-07-20-demo-poster.jpg 2026-07-20-demo-poster.webp
```

**Cut the muted 15–25s landing-page loop with a short fade in/out:**

```bash
ffmpeg -i 2026-07-20-demo-full.mp4 \
  -ss 00:00:05 -to 00:00:25 \
  -an -vf "fade=t=in:st=0:d=0.3,fade=t=out:st=19.5:d=0.5" \
  -c:v libx264 -preset slow -crf 21 -movflags +faststart \
  2026-07-20-demo-loop.mp4
```

**Mux the WebVTT captions as a soft-subtitle track on an archival copy (the
landing page itself should use a `<track>` element pointing at the sidecar
`.vtt`, not a burned-in caption):**

```bash
ffmpeg -i 2026-07-20-demo-full.mp4 -i 2026-07-20-demo-full.en.vtt \
  -c copy -c:s mov_text \
  2026-07-20-demo-full-captioned.mp4
```

**Generate a quick contact sheet to visually compare compression settings
before picking one (not a deliverable, just a review aid):**

```bash
ffmpeg -i 2026-07-20-demo-full.mp4 \
  -vf "fps=1/6,scale=320:-1,tile=6x2" \
  contact-sheet.jpg
```

Compare compressed output against the original visually — text and timeline
details (clip labels, score chips, timecodes) are the first thing to blur out
at aggressive CRF values.

## 11. Agent handoff checklist

Hand the coding agent everything below in one pass so it doesn't have to
guess at intent or fabricate what it wasn't given:

- [ ] The approved dated file set from §7 (master, full MP4, captions, loop,
  poster, transcript, usage notes) and which take is canonical if you
  recorded more than one.
- [ ] Confirmation the workflow shown matches the exact released version you
  recorded on (DMG version/build).
- [ ] The usage-notes file covering every footage clip's rights, plus any
  music/font/graphic licensing (§2, §8).
- [ ] Explicit sign-off that every stop condition in §9 was clear during
  recording — i.e. nothing was worked around or cut away to hide.
- [ ] Any deviation from the shot table in §4 (skipped a beat, reordered
  steps, different export format) so the agent doesn't assume the table is
  literal ground truth.
- [ ] Whether you want the optional vertical/social cut in this pass or a
  later one.

The agent's job from here is scoped by the launch plan: compress, generate
the poster/captions/loop if not already produced, and embed the lightweight
cut with a poster and accessible controls/fallback — muted, not autoplaying
audio, not render-blocking. It must not invent shots, dialogue, or UI states
you didn't actually capture.

## Related docs

- [`docs/plans/landing-page-polish-and-launch.md`](plans/landing-page-polish-and-launch.md) — why this demo exists and what happens after it's embedded.
- [`USER_GUIDE.md`](USER_GUIDE.md) — the end-user workflow and screen names this guide draws its shot list from.
- [`MANUAL_QA_GUIDE.md`](MANUAL_QA_GUIDE.md) — the fuller QA pass to run if a stop condition (§9) surfaces a bug worth triaging before you re-shoot.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — common setup/runtime failures, useful for diagnosing a stop condition.
- [`../UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md) — the term definitions behind the shot table's UI names.
- [`agents/issue-tracker.md`](agents/issue-tracker.md) and [`QA.md`](QA.md) — how to file a bug if recording surfaces one.
