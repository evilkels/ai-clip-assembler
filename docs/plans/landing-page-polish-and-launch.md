# Landing Page Polish and Launch Backlog

Status: ACTIVE — the editorial visual refresh shipped in v0.1.3; the
remaining work is split between coding-agent tasks and maintainer-owned proof,
distribution, and account work.

## Delivered in the editorial refresh

- Aligned the landing page with the cover artwork's paper, graphite, navy, and
  signal-red visual system.
- Replaced the dark hero with a copy-first editorial hero and connected-node
  motif.
- Increased workflow screenshot prominence on desktop and mobile.
- Corrected public copy so optional AI does not read as mandatory cloud AI.

## Recommended launch sequence

1. Ship a direct, version-aligned DMG download link.
2. Pass a clean-machine installation and first-run workflow.
3. Record one real proof-of-work demo and publish a lightweight landing-page
   cut.
4. Complete the technical SEO foundation and Search Console setup.
5. Publish the gated culling-guide pilot.
6. Run one audience-specific launch loop, then measure activation and search
   queries before expanding either content or promotion.

## Maintainer tasks — assign these to Elvijs

- [ ] **Choose the demo project.** Supply 8–15 representative action-sports,
  drone, or travel clips that you own or have permission to publish. Remove
  private filenames, locations, faces, notifications, API keys, and project
  history before recording.
- [ ] **Prove the real workflow.** On the distributable build, import the clips,
  analyse them, review Candidate Clips, make one visible edit, export an
  editable timeline, and open that export in the target NLE. Do not record a
  path the released app cannot reproduce.
- [ ] **Record the clean app capture.** Follow the shot list below. Record
  voice-over separately, if desired; a silent capture is easier to repair and
  becomes the landing-page loop.
- [ ] **Provide editorial expertise for the first SEO article.** Write rough
  notes about how you actually cull footage, three mistakes you have seen, one
  concrete example, and any screenshots you can publish. The coding agent can
  shape and implement this material but must not invent the experience.
- [ ] **Verify Search Console.** Use your Google account to verify the GitHub
  Pages property, inspect the canonical URL, submit `sitemap.xml`, and record a
  baseline after the technical SEO PR is deployed.
- [ ] **Test the DMG on a clean Mac account or machine.** Cover Gatekeeper,
  first launch, FFmpeg/tool availability, analysis, restart, export, and NLE
  import. File issues for every manual workaround.
- [ ] **Approve public claims and release artifacts.** Confirm the version,
  download URL, privacy wording, supported exports, screenshots, demo, and
  article all match the shipped build.
- [ ] **Run the human launch loop.** Publish the demo where the chosen audience
  already participates, state your relationship to the project, answer replies,
  and collect the exact words users use for their problem. Do not automate
  community posts or manufacture engagement.

## Coding-agent tasks

- [ ] Implement Tasks 1–4 in `docs/plans/seo-plan.md`.
- [ ] Prepare the demo shot list, privacy checklist, captions, title cards,
  poster, and compressed web assets after the maintainer supplies the capture.
- [ ] Embed the lightweight demo with a poster and accessible controls/fallback;
  do not autoplay audio or make the full video render-blocking.
- [ ] Implement `docs/plans/seo-content-pilot.md` only after its human evidence
  gate passes.
- [ ] Add the version-aligned DMG URL and verify it against the release artifact.
- [ ] Turn clean-machine failures and 28-day search findings into scoped GitHub
  issues; do not silently broaden the launch PR.

## Demo video brief

Create a 45–60 second proof of work, not a feature montage:

| Time | Show | Proof conveyed |
|---|---|---|
| 0–5 s | A real folder of unsorted clips and the final target | The problem and promised outcome. |
| 5–14 s | Create/open project and import footage | The app accepts a normal creator workflow. |
| 14–26 s | Run analysis; show progress and resulting Candidate Clips | The app does useful culling work. |
| 26–38 s | Review clips, include/exclude one, optionally compare an AI-proposed Version | The user stays in control; AI is optional. |
| 38–48 s | Refine the Working Timeline | The output is editable, not a black-box render. |
| 48–56 s | Export, then open the file in Resolve or Final Cut Pro | The handoff really works. |
| 56–60 s | Product name, platform, URL/download call to action | The next step is unambiguous. |

Capture at 2560×1440 or 1920×1080. Keep the app legible at the final embed
size, use a clean desktop, disable notifications, and avoid synthetic mouse
thrashing. Prefer one continuous workflow; cuts may remove waiting but must not
imply capabilities that were not demonstrated.

### Recording and editing tools

- **Polished Mac workflow:** Screen Studio for capture and automatic cursor
  treatment, then DaVinci Resolve for the final edit.
- **Free workflow:** OBS Studio for capture and DaVinci Resolve for editing.
- **No-install capture:** macOS Screenshot/QuickTime, followed by Resolve.
- **Open-source capture alternative:** Cap, especially if its Studio Mode fits
  the desired cursor/zoom treatment.
- **Optional code-driven graphics:** Remotion for reusable title cards,
  diagrams, or release-version variants. It is not a substitute for recording
  the real app workflow.

### Required deliverables

- `demo-master` project/archive with the highest-quality capture.
- 45–60 second H.264 MP4 with captions (`.vtt` or `.srt`).
- 15–25 second muted landing-page cut that works as a loop but still has
  controls and a reduced-motion/static fallback.
- 16:9 poster image in WebP or JPEG.
- Transcript and source/usage notes for every footage clip, music track, font,
  and graphic.
- Optional vertical/social cut only after the canonical demo is approved.

Avoid GIF as the primary fallback; it is usually heavier and less accessible
than MP4 plus a static poster. The coding agent may use the repo's FFmpeg tool
chain to compress supplied masters, but compression must be compared visually
against text and timeline details before publishing.

## Exit signal

At least five target users can download the current build, create an editable
export from their own footage, and describe the product's value without live
support. Search/content expansion waits for the first 28-day measurement review
or a meaningful impression sample, whichever comes later.
