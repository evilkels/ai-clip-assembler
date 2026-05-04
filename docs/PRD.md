# Product Requirement Document: AI Clip Assembler

## Overview

AI Clip Assembler is a local-first desktop video editor that uses AI to automatically identify, extract, and assemble the best segments from raw MP4 footage into polished 1-3 minute videos. Users maintain full control through an intuitive GUI with adjustable cuts and direct export to professional editing software.

## Problem Statement

Content creators capture hours of raw footage but struggle to:
- Identify smooth, stable segments among shaky footage
- Manually scrub through 10-30 minute clips to find good moments
- Assemble clips into coherent sequences efficiently
- Do all of this without uploading private footage to cloud services

## Solution

A desktop Electron app that:
1. Ingests multiple MP4 files locally (no cloud upload)
2. Analyzes footage for motion stability, visual interest, and technical quality
3. Suggests optimal clip segments with AI-generated scores
4. Presents clips in an interactive timeline for review and adjustment
5. Exports assembled timelines to Final Cut Pro (FCPXML) or DaVinci Resolve (EDL)

## Target Users

- Travel vloggers with hours of raw footage
- Drone operators learning cinematography
- Event videographers needing quick assembly
- Action camera users (GoPro, Insta360) with shaky footage

## Core Features

### MVP (Phase 1)

#### 1. Video Ingestion
- **Drop zone**: Drag-and-drop multiple MP4 files
- **Metadata extraction**: Duration, resolution, FPS, codec via FFmpeg
- **Frame extraction**: Sample frames every 1-2 seconds for analysis
- **Progress tracking**: Show analysis progress per video

#### 2. Motion & Quality Analysis
- **Stability scoring**: FFmpeg vidstabdetect for motion analysis
- **Blur detection**: OpenCV Laplacian variance for sharpness
- **Brightness/contrast**: Technical quality metrics
- **Scene detection**: PySceneDetect for shot boundaries

#### 3. AI Clip Suggestion (Local Harness - Default)
- **Vision model**: Qwen2.5-VL via Ollama/MLX
- **Frame scoring**: Smoothness (0-10), visual interest (0-10)
- **Clip extraction**: Identify continuous high-scoring segments
- **Reasoning**: AI explains why each clip was selected

#### 4. Timeline GUI
- **Clip cards**: Visual thumbnails with AI scores overlaid
- **Drag-and-drop**: Reorder clips in sequence
- **Trim handles**: Adjust start/end points with precision
- **Preview**: Play individual clips or full sequence
- **Score filtering**: Hide clips below threshold

#### 5. Export
- **FCPXML**: Final Cut Pro timeline import
- **EDL**: Universal edit decision list
- **Clip-only**: Export individual clips without assembly

### Phase 2 (Post-MVP)

#### Modular AI Harnesses
- Claude Code harness for complex editorial decisions
- Codex harness for structured output
- Pi Agent harness for conversational explanations
- Manual/rule-based harness (no AI)

#### Advanced Features
- Speed ramping (auto-slowmo for key moments)
- Music beat sync
- Transition suggestions
- Multi-track timeline (B-roll support)
- Project save/load

## User Stories

### Story 1: Quick Assembly
> As a travel vlogger, I want to drop my 5 hours of raw footage into the app and get a 2-minute highlight reel suggestion that I can fine-tune and export to Final Cut Pro.

**Acceptance Criteria:**
- App processes 10+ MP4 files simultaneously
- Analysis completes in under 10 minutes for 1 hour of footage
- Suggested clips total 2-3 minutes
- User can adjust cuts and reorder in timeline
- Export produces valid FCPXML

### Story 2: Shaky Footage Filtering
> As a drone beginner, I want the AI to automatically exclude shaky segments so I only see smooth, professional-looking clips.

**Acceptance Criteria:**
- Stability score visible on every clip
- Filter to show only clips with smoothness > 7/10
- Shaky segments highlighted in red
- Option to auto-exclude clips below threshold

### Story 3: Manual Override
> As a professional editor, I want to see AI suggestions but have full manual control over final cut points and sequence.

**Acceptance Criteria:**
- All AI suggestions are editable
- Keyboard shortcuts for trimming (J/K/L, arrow keys)
- Manual clip creation from raw footage
- AI can be disabled entirely

## Technical Requirements

### Performance
- Process 1 hour of 4K/60fps footage in < 10 minutes (M3 Mac)
- Timeline UI remains responsive during background analysis
- Frame extraction: 2-4 frames per second of video

### Compatibility
- **macOS**: Primary target (Apple Silicon optimized)
- **Windows**: Secondary (future release)
- **Linux**: Community support
- **Input formats**: MP4 (H.264/H.265), MOV
- **Output formats**: FCPXML, EDL

### Local-First Requirements
- No footage uploaded to any server
- AI inference runs on-device (Ollama/MLX)
- Optional cloud AI with explicit user consent
- All project data stored locally

## UI/UX Requirements

### Layout
```
┌─────────────────────────────────────────────┐
│  Toolbar (Import | Harness | Export | Settings)
├──────────┬──────────────────────────────────┤
│          │                                  │
│  Video   │      Timeline                    │
│  List    │      (clip cards with scores)    │
│          │                                  │
├──────────┤                                  │
│  Clip    ├──────────────────────────────────┤
│  Details │      Preview Player              │
│  (scores,│      (with trim handles)         │
│  reason) │                                  │
└──────────┴──────────────────────────────────┘
```

### Interaction Design
- **Dark mode default** (video editing standard)
- **Thumbnail scrubbing**: Hover over clip to scrub through frames
- **Score visualization**: Color-coded chips (green = good, red = shaky)
- **Keyboard shortcuts**: J/K/L playback, I/O in/out points, arrow nudge
- **Zoom**: Timeline zoom for precise trimming

## Success Metrics

### User Adoption
- Time to first export: < 15 minutes for new user
- User retention: 3+ exports in first week
- NPS score: > 50

### Technical
- Analysis accuracy: > 80% of user-kept clips had AI score > 7/10
- Export success rate: > 95% valid FCPXML/EDL
- Crash rate: < 1% of sessions

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Timeline UI complexity | High | Start with simple linear timeline, no multi-track |
| Local AI too slow | High | Use frame sampling (not every frame), allow cloud fallback |
| FCPXML format changes | Medium | Target FCPXML v1.10 (stable), validate with tests |
| User expects full editor | Medium | Clear positioning: assembly tool, not replacement for FCP/Resolve |

## Out of Scope (for MVP)

- Multi-track timeline
- Color grading
- Audio mixing
- Effects/transitions
- Cloud collaboration
- Mobile app
- Video stabilization (detection only, not correction)

## Open Questions

1. Should we include audio transcription for spoken-content filtering?
2. What's the minimum viable timeline component — can we use an existing library?
3. Should clips be rendered as proxy files for timeline preview?
4. How do we handle different frame rates in the same project?
