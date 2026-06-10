# Real-Footage QA Review — 2026-06-11

## Session

- Machine: Apple M5 Pro
- OS: macOS 26.5.1
- Harness: `pi_agent`
- Source footage: four HEVC videos, 1920x1080, 59.94 FPS
- Source duration: approximately 3 minutes 14 seconds
- Analysis duration: approximately 6–8 minutes
- Overall verdict: usable for a real editing workflow

The current analysis wait is acceptable. Analysis progress, clip splitting,
and Pi-agent scoring feedback were clear enough, though an estimated completion
time would improve the experience.

## What Worked

- No crashes occurred during the workflow.
- Candidate Clips persisted after reopening the project.
- Review Board playback, scrolling, and Include/Exclude interactions felt good.
- Timeline sequence playback worked.
- Export worked correctly.
- The operator would use the app for real editing work in its current state.

## Confirmed Defects

### P0 — Accepted Clips do not persist

Candidate Clips remain after reopening a project, but Include/Exclude decisions
and the resulting Accepted Clips are lost. There is no explicit save action, so
review decisions and Timeline edits must auto-save.

Re-analysis must preserve manual decisions. Replacing an existing draft should
require an explicit **Regenerate Draft** action with confirmation.

### P1 — Clip-card scores contradict their details

Clip-card pills show red `0.0` values for sharpness, exposure, and contrast,
while the detailed text below reports non-zero values. Cards should show a
clearly labeled combined score with expandable local-technical and Pi-agent
details.

### P1 — Timeline playhead cannot be dragged

Click-to-seek works, but the playhead cannot be dragged. The Timeline needs
continuous playhead scrubbing.

### P2 — macOS title bar is duplicated and misleading

The custom title bar duplicates native macOS close, minimize, and fullscreen
controls and displays the placeholder project title `sunset-drone-footage`.
Keep the native macOS title bar, remove custom traffic-light controls, and show
the actual open project name.

## Analysis Quality Finding

One confirmed false positive contained a sudden drone rotation, including a
roughly 180-degree turn, but was selected as a good smooth clip.

This single case is not enough to measure overall analyzer quality. A deeper
ground-truth review was not performed. Improved motion analysis should:

- Reject abrupt rotations or split them away from stable footage.
- Allow turns only when they are slow, intentional, and visually smooth.
- Prefer output quality over filling a requested duration.

## Recommended Assembly Workflow

Analyze footage once, identify usable ranges, then automatically recommend an
assembly profile based on extracted clip quality and duration:

- **Short Social** — mostly 2–6 second clips.
- **Cinematic Highlight** — mostly 5–15 second clips.
- **Long Scenic** — mostly 10–30 second clips.
- **Custom** — operator-defined target and clip-duration preferences.

Clip durations should adapt to the stable footage available rather than being
forced into fixed ranges. Target video duration is best-effort and must not be
reached by padding with lower-quality footage.

The recommended profile and target-duration controls should live on the Review
Board after analysis. The app should automatically create a draft Timeline in
chronological flight order, using AI to remove repetition and select the
strongest nearby clips.

## Timeline Direction

The Timeline needs a customization-ready panel layout. Initial priorities:

1. Draggable playhead scrubbing.
2. Snapping enabled by default.
3. Scroll or pinch-to-zoom centered around the pointer or playhead.
4. Draggable resizing between the preview and Timeline, persisted across app
   sessions.
5. Improved Timeline track controls and better use of available space.

Speed adjustments and color-grading presets for DaVinci export are useful
future features, but are not immediate priorities.

## Export Opportunity

Export worked correctly. A future **Open in DaVinci Resolve** action could
create or open a Resolve project, import the exported Timeline, and configure
the real-footage folder as the source-media location.

## Recommended Execution Order

1. Fix Accepted Clip and Timeline-decision persistence.
2. Fix contradictory Review Board score presentation.
3. Improve motion analysis for abrupt-turn rejection and validate against
   labeled real footage.
4. Add adaptive assembly profiles, recommendation, and automatic draft
   generation.
5. Improve Timeline scrubbing, snapping, zoom, resizing, and layout.
6. Fix native macOS title/project-name presentation.
7. Add DaVinci launch/import workflow.
8. Revisit speed adjustments and color grading later.

## Unmeasured Acceptance Criteria

- Analyzer recall and precision against manual ground truth were not measured.
- The proportion of useful Candidate Clips was not measured.
- Performance was observed only for this approximately 3-minute 1080p set.
- DaVinci relink behavior was not explicitly measured, though export worked.
