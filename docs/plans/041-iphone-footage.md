# 041: iPhone footage end to end

A folder of iPhone clips goes from Import to an export that opens at the
footage's real frame rate, in shooting order, upright, with every preview sized
for vertical video.

## Context

Found by running the owner's real iPhone 15 Pro footage through v0.4.0 on
2026-10-10:
[`2026-10-10-iphone-footage-test.md`](../reviews/2026-10-10-iphone-footage-test.md).
The four clips are H.264 .mov, 1920×1080 with a −90° display matrix, and nominal
59.94 fps with variable frame rate (`avg_frame_rate` 59.93–59.96). Audio is
stream 0. Rotation already worked (#19).

Decisions so far:

- **Frame rate.** Exports snap every rate to the nearest standard rate within
  0.5 % (ties go to NTSC). The sequence rate is the majority over the Timeline's
  sources. The probe stores `r_frame_rate` when it is within 1 % of
  `avg_frame_rate`.
- **Capture time.** Capture time is `com.apple.quicktime.creationdate`, then
  `creation_time`, then the stream tag, then mtime. It is stored as UTC with
  microseconds, so the lexical capture-order sort stays valid.
- **Sequence shape.** The sequence takes the first Timeline Item's Source Video
  shape. Previews use the same rule.
- **Export title.** Exports are named after the Project folder. File names stay
  `timeline.*`, behind the existing overwrite confirmation.

## Phase 1: Exports and probe

- [x] 1.1 Snap VFR rates in every export, pick the sequence rate by majority over Timeline sources, size the sequence from the first Timeline source, count EDL frames at the exact NTSC rate. Done when the `iphone-vfr-1080p5994-vertical` golden is `1001/60000s` and Resolve `60/TRUE` (PR #100)
- [x] 1.2 Read the iPhone capture time and the nominal frame rate in the probe, and refresh stored clips' capture time on open. Done when the four test clips probe as 59.94 in shooting order (PR #102)

## Phase 2: Editor UI

- [ ] 2.1 Keep the Timeline transport clock updating after playback. Done when a play → Stop → retime test sees the new total.
- [ ] 2.2 Mark each Source Video Analyzed as soon as its run step finishes, including files with zero Candidate Clips, cancelled runs and late requests. Done when the Import specs for batch progress, cancel and same-name files pass.
- [ ] 2.3 Make Thumbs and Compact span the Source Videos browser, show poster frames and the real file extension. Done when the width and poster-recovery specs pass.
- [ ] 2.4 Fix the Import copy: "upload video files", "Scoring clips", "1 source loaded". Done when the visual baselines show the new copy.

## Phase 3: Vertical previews

- [ ] 3.1 Size the Suggested-cut player and the Timeline preview to the source's display aspect, and move the preview info bar off the picture. Done when the portrait spec measures a player with width / height < 0.7 and a preview within 3 % of 9/16.
- [ ] 3.2 Make track durations and candidate badges legible in light theme, and keep the All items rail free of horizontal overflow. Done when the rail spec finds ✕ inside the rail and `scrollWidth <= clientWidth`.

## Phase 4: Export handoff

- [ ] 4.1 Name the EDL title, the FCPXML event and project, and the Resolve sequence after the Project folder. Done when the API test with `Bike Ride — 2026-10-10` passes and the FCPXML passes the DTD.
- [ ] 4.2 Preselect FCPXML on Export and label the raw duration "Source media used". Done when the export specs and `export-receipt` baselines pass.

## Phase 5: Verify

- [ ] 5.1 Re-run the real-footage test on `main` after Phases 2–4 merge. Done when an addendum to the review records each bug fixed or still open, with screenshots.

## Phase 6: Later polish

- [ ] 6.1 Add thumbnails and audio waveforms to Timeline track blocks. Done when a Timeline Item block shows its poster and waveform at 40 px/s.
- [ ] 6.2 Enter Trim bounds as timecode or frames and snap them to source frames. Done when a 10.4 s bound at 59.94 is stored as a whole frame.
- [ ] 6.3 Use one sound default: the source preview plays with sound, so Review previews should too, or both should start muted. Done when both use the same default.

## Human tasks

- [ ] H1 Import this footage's FCPXML into Final Cut Pro and its Resolve XML into DaVinci Resolve. This is the same check as [032](032-valid-fcpxml-and-nle-verification.md) H2–H4, on vertical 59.94 footage.
- [ ] H2 Record a few clips with the iPhone camera set to High Efficiency (HEVC, HDR) and run them through, so real HDR posters and frame samples are checked.
