# Landing Page Polish and Launch Backlog

Status: ACTIVE — the editorial visual refresh is being delivered now; the
remaining items are intentionally deferred launch work.

## Delivered in the editorial refresh

- Align the landing page with the cover artwork's paper, graphite, navy, and
  signal-red visual system.
- Replace the dark hero treatment with a copy-first editorial hero and a
  decorative connected-node motif.
- Increase workflow screenshot prominence on desktop and mobile.
- Correct public copy so optional AI does not read as mandatory cloud AI.

## Next tasks, in recommended order

1. **Ship a direct, version-aligned DMG download link.** Ensure the landing
   page points to the current macOS artifact and that the release tag, file
   name, and in-app version agree. This removes a trust break at the exact
   moment someone decides to install.
2. **Add a short proof-of-work demo.** Record a 30–60 second raw-folder to
   editable-Resolve/FCPXML handoff. Put it below the hero and keep a static
   poster fallback for fast loading.
3. **Offer an optional early-tester signup.** Add a minimal privacy-respecting
   email capture path for people who are interested but not ready to install.
   State what emails will be used for and do not couple it to footage data.
4. **Create a new-user installation path.** Verify a non-developer Mac can
   install, open, and analyse footage. Resolve FFmpeg/vidstab availability,
   Gatekeeper signing/notarization, and first-run diagnostics before broader
   promotion.
5. **Publish one audience-specific launch loop.** Start with Mac-based drone
   and travel creators who export to DaVinci Resolve. Prepare one sample
   project, one demo video, and one feedback prompt before expanding the
   audience or feature surface.
6. **Capture theme-matched product screenshots.** Capture Import, Review,
   Timeline, and Export in both light and dark app themes at identical viewport
   sizes. Store the dark assets next to the current screenshots (for example,
   `site/img/import-dark.png`) and update the landing page to use a `<picture>`
   source with `media="(prefers-color-scheme: dark)"`, so each screenshot
   switches with the landing page automatically. Keep the light screenshot as
   the fallback and confirm that both variants show the same meaningful state.
7. **Create a landing-page workflow demo.** Record one concise 30–60 second
   screen video that follows a real project from importing footage through
   Candidate Clip review, an optional AI-proposed montage Version, Timeline
   refinement, and editable export. Produce a silent muted-loop video for the
   landing page and an animated GIF or static poster fallback; optimise every
   asset for fast loading and keep the full narrated walkthrough on GitHub or
   YouTube rather than blocking the page with it.

## Exit signal for this backlog

At least five target users can download the current build, create an editable
export from their own footage, and describe the value without product support.
