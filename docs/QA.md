# QA Plan

## Scope

This QA plan covers the drone-first MVP: importing local drone footage, scoring smooth and sharp candidate clips, reviewing suggestions, ordering accepted clips, and exporting a timeline to a professional editor format.

## Primary Persona

The primary tester is a **Drone User** with MP4 or MOV footage who wants to quickly remove shaky spans and keep smooth usable shots. Testing should favor real drone footage over synthetic media whenever possible.

## Test Assets

Maintain a small local-only test set:

| Asset | Purpose | Expected signal |
| --- | --- | --- |
| Smooth drone pan, 10-30s | Happy path smooth footage | High **Smoothness Score**, likely accepted |
| Shaky drone movement, 10-30s | Filtering bad footage | Low **Smoothness Score**, hidden by 7+ filter |
| Blurry motion segment | Sharpness penalty | Low **Sharpness Score** |
| Overexposed sky/water segment | Exposure penalty | Low **Exposure Score** |
| Mixed source video, 1-3 min | End-to-end candidate extraction | Multiple ranked **Candidate Clips** |
| H.264 MP4 and H.265 MOV | Codec coverage | Metadata and frame extraction succeed |

Do not commit private footage to the repository. Store sample assets outside git and document only their names, duration, codec, and expected behavior.

## MVP Acceptance Tests

### 1. Project And Import

1. Start the backend and frontend in development mode.
2. Create a new project.
3. Import one H.264 MP4 source video.
4. Confirm metadata is visible or available through the API: duration, FPS, resolution, codec.
5. Repeat with one H.265 MOV source video.

Pass criteria:
- The app does not upload footage to a remote service.
- Import failure messages are actionable when `ffmpeg` or `ffprobe` is missing.
- Metadata matches the source video within normal probe tolerance.

### 2. Frame Sampling And Technical Scores

1. Analyze a smooth drone source video.
2. Analyze a shaky drone source video.
3. Compare generated scores.

Pass criteria:
- Smooth footage ranks above shaky footage by **Smoothness Score**.
- Blurry footage receives a lower **Sharpness Score** than sharp footage.
- Overexposed or underexposed footage receives a lower **Exposure Score**.
- Scores are on a stable 0-10 scale and are understandable on the **Review Board**.

### 3. Candidate Clip Assembly

1. Analyze a mixed source video with both smooth and shaky spans.
2. Use the default smoothness threshold of 7+.
3. Inspect generated **Candidate Clips**.

Pass criteria:
- Candidate clips are usually 3-15 seconds unless preferences are changed.
- Shaky spans are excluded or ranked low.
- **Clip Reason** explains the technical basis, such as stable, sharp, or exposure quality.
- The total suggested duration is near the requested target duration when enough good footage exists.

### 4. Review Board

1. Open the **Review Board**.
2. Change the **Smoothness Score** threshold.
3. Accept, reject, and reorder candidate clips.

Pass criteria:
- The default filter is 7+ smoothness.
- Accepted and rejected states are visually distinct.
- Reordering accepted clips changes the export order.
- The UI avoids AI-only language for rule-based scores.

### 5. Export

1. Accept at least three candidate clips from two source videos.
2. Export FCPXML.
3. Import the FCPXML into Final Cut Pro.
4. Export EDL and inspect it in a text editor or compatible tool.

Pass criteria:
- Export contains the accepted clips in order.
- Source references point to the original local media.
- Final Cut Pro imports FCPXML without errors.
- EDL edit events have plausible source and timeline timecodes.

## Regression Checks

Run these after the backend and frontend MVP branches are present locally:

```bash
cd backend
python -m pytest
```

```bash
cd frontend
npm install
npm run typecheck
npm run build
```

If `npm run typecheck` is unavailable, the frontend MVP branch has not been merged or checked out yet.

Add a real-video smoke test whenever `ffmpeg` and `ffprobe` are installed:

1. Import a short drone MP4.
2. Run manual analysis.
3. Confirm at least one **Candidate Clip** is produced for smooth footage.
4. Confirm the **Review Board** can display the result.

## Known QA Risks

- Real drone footage can vary widely by gimbal behavior, lighting, codec, and frame rate.
- Synthetic tests can prove scoring mechanics but not editorial usefulness.
- The first MVP may not distinguish smooth but boring footage from smooth and visually strong footage until **Local AI Harness** work starts.
- Export validation requires the actual target editor, especially Final Cut Pro for FCPXML.

## Bug Filing Template

Use this template for QA findings:

```md
## What happened

[Actual user-visible behavior]

## What I expected

[Expected behavior using project domain terms]

## Steps to reproduce

1. [Source video type, duration, codec]
2. [Import/analyze/review/export action]
3. [Observed result]

## Additional context

[Scores, threshold, export format, whether footage is smooth/shaky/blurry/overexposed]
```
