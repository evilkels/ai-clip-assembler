# Demo Recording Guide

Maintainer runbook for the truthful 45–60s proof-of-work demo in
[`landing-page-polish-and-launch.md`](plans/landing-page-polish-and-launch.md).
The maintainer owns footage, distributable-build proof, capture, and approval;
an agent may compress/embed approved assets but must not invent shots or states.

## 1. Prerequisites

- Install the released DMG normally—not a dev checkout—and prepare 8–15
  rights-cleared drone/action/travel clips on a clean macOS account with Focus on.
- Choose Screen Studio, OBS, macOS recording, or Cap; use Resolve/FCP to prove
  handoff. The reference commands require `ffmpeg`/`ffprobe` on `PATH`.

## 2. Rights and privacy checklist (all required)

- [ ] Own or have publishable permission for every clip; retain license terms.
- [ ] Obtain consent for identifiable people or crop/blur them.
- [ ] Remove private names, addresses, dates, codenames from visible filenames.
- [ ] Strip unwanted GPS/location metadata before import.
- [ ] Show no keys, tokens, emails, usernames, browser/terminal secrets.
- [ ] If provider-backed AI appears, enable consent and disclose the provider;
  never label that optional segment local-only/no-upload.
- [ ] Disable notifications/AirDrop popups; clean desktop, menu bar, bookmarks.
- [ ] Record public commercial-adjacent licenses for music/fonts/graphics.

## 3. Dry run first

On the distributable build: open a folder project; Analyze; include and exclude
Candidate Clips; visibly reorder/trim/adopt a Version; export FCPXML, EDL, or
Resolve XML; open it in the target NLE. Stop before capture if any normal-user
step fails, needs a workaround, or depends on an absent shipped feature.

## 4. Shot and narration table

| Time | Show | Narration / proof |
|---|---|---|
| 0–5s | Finder: unsorted folder | “This is what a raw drone folder looks like before AI Clip Assembler touches it.” |
| 5–14s | Import: Create/Open Folder Project; metadata table | “Point it at the folder. Default analysis reads every clip locally—no upload.” |
| 14–26s | Analyze progress → ranked Review Board | “Analyze finds smooth, sharp, well-exposed moments and makes Candidate Clips.” |
| 26–38s | Smoothness; Include/Exclude; optional Focus/Apply Version | “I keep what I want, drop the rest, and can compare an AI-proposed cut first.” |
| 38–48s | Timeline reorder, trim, scrub | “It is a real editable timeline—reorder it, trim it; it is still clips.” |
| 48–56s | Export → import in Resolve/FCP | “Export to Resolve, Final Cut, or an EDL editor and keep working.” |
| 56–60s | Product, macOS, free/open source, URL | “AI Clip Assembler. Free, local-first, macOS. Link below.” |

Use one continuous purposeful take at 2560×1440 or 1920×1080, 30fps. Cuts may
remove waiting, never imply behavior. Record app window only, smooth/highlight
the cursor if available, and capture narration separately or silent. Captions
match the seven cues 1:1; a silent cut still needs honest on-screen captions.

## 5. Naming and required deliverables

Prefix one session `YYYY-MM-DD`; suffix extra takes before the file-type segment.

```text
YYYY-MM-DD-demo-master.<capture-ext>
YYYY-MM-DD-demo-full.mp4
YYYY-MM-DD-demo-full.en.vtt
YYYY-MM-DD-demo-full.en.srt        # optional
YYYY-MM-DD-demo-loop.mp4
YYYY-MM-DD-demo-poster.webp        # JPEG fallback allowed
YYYY-MM-DD-demo-transcript.md
YYYY-MM-DD-demo-usage-notes.md
```

- [ ] Highest-quality capture/project archive.
- [ ] 45–60s H.264 MP4 plus VTT or SRT captions.
- [ ] 15–25s muted loop; embedding later adds controls and reduced-motion poster.
- [ ] 16:9 WebP/JPEG poster; transcript; rights notes for all source material.
- [ ] Optional vertical/social cut only after canonical demo approval.

Tell the agent which dated take is canonical; do not commit large masters.
Prefer MP4 plus poster over GIF.

## 6. Stop conditions

Stop, file a GitHub bug using [`QA.md`](QA.md), fix/wait, and repeat the dry run if:

- any shot-table step contradicts `USER_GUIDE.md`/`MANUAL_QA_GUIDE.md`;
- analysis crashes or needs downloader-unavailable setup/workarounds;
- the NLE rejects/relinks the documented folder-project export;
- an error, spinner, or glitch would have to be hidden with a misleading cut;
- a required control (including Apply to working timeline) is absent/broken.

## 7. FFmpeg reference

```bash
ffmpeg -i YYYY-MM-DD-demo-master.mov \
  -vf "scale=1920:-2,format=yuv420p" -c:v libx264 -preset slow -crf 20 \
  -c:a aac -b:a 160k -movflags +faststart YYYY-MM-DD-demo-full.mp4

ffmpeg -ss 00:00:30 -i YYYY-MM-DD-demo-full.mp4 -frames:v 1 -q:v 2 \
  YYYY-MM-DD-demo-poster.jpg
ffmpeg -i YYYY-MM-DD-demo-poster.jpg YYYY-MM-DD-demo-poster.webp

ffmpeg -i YYYY-MM-DD-demo-full.mp4 -ss 00:00:05 -to 00:00:25 -an \
  -vf "fade=t=in:st=0:d=0.3,fade=t=out:st=19.5:d=0.5" \
  -c:v libx264 -preset slow -crf 21 -movflags +faststart YYYY-MM-DD-demo-loop.mp4

ffmpeg -i YYYY-MM-DD-demo-full.mp4 -i YYYY-MM-DD-demo-full.en.vtt \
  -c copy -c:s mov_text YYYY-MM-DD-demo-full-captioned.mp4

ffmpeg -i YYYY-MM-DD-demo-full.mp4 \
  -vf "fps=1/6,scale=320:-1,tile=6x2" contact-sheet.jpg
```

Use the VTT sidecar with the web `<track>` element. Compare compression against
the original; labels, score chips, and timecodes blur first.

## 8. Agent handoff checklist

- [ ] Canonical dated files, DMG version/build, and all rights/licensing notes.
- [ ] Confirmation every stop condition stayed clear—nothing hidden or bypassed.
- [ ] Every shot-table deviation and whether a vertical cut is requested now.

Agent scope: compress/generate missing derivatives and embed a lightweight,
non-render-blocking video with poster, controls, captions, muted loop, and
reduced-motion fallback. Related truth sources: `USER_GUIDE.md`,
`MANUAL_QA_GUIDE.md`, `TROUBLESHOOTING.md`, and `UBIQUITOUS_LANGUAGE.md`.
