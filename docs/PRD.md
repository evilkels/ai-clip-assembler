# Product Requirement Document: AI Clip Assembler

## Overview

AI Clip Assembler is a local-first desktop video editor that uses AI to
automatically identify, extract, and assemble the best segments from raw MP4
footage into polished 1-3 minute videos. Users keep full control through a
GUI with adjustable cuts and export to professional editing software.

## Problem Statement

Content creators capture hours of raw footage but struggle to identify
smooth, stable segments among shaky footage; manually scrub long clips for
good moments; and assemble clips into coherent sequences efficiently — all
without uploading private footage to cloud services.

## Solution

A desktop Electron app that: ingests multiple MP4 files locally (no cloud
upload); analyzes footage for motion stability, visual interest, and
technical quality; suggests optimal clip segments with AI-generated scores;
presents clips in an interactive timeline for review and adjustment; and
exports assembled timelines to Final Cut Pro (FCPXML) or DaVinci Resolve
(EDL).

## Target Users

Travel vloggers, drone operators, event videographers, and action-camera
(GoPro/Insta360) users with hours of raw or shaky footage.

## Core Features

### MVP (Phase 1)

1. **Video Ingestion** — drag-and-drop multiple MP4s; metadata (duration,
   resolution, FPS, codec) via FFmpeg; frame sampling every 1-2s; per-video
   analysis progress.
2. **Motion & Quality Analysis** — FFmpeg vidstabdetect for stability,
   OpenCV Laplacian variance for blur, brightness/contrast metrics,
   PySceneDetect for shot boundaries.
3. **Clip Suggestion** — the default local rule-based harness scores
   smoothness and technical quality, identifies continuous high-scoring
   segments, and explains each selection; opt-in AI adds visual-interest scoring.
4. **Timeline GUI** — clip cards with AI scores, drag-and-drop reordering,
   trim handles, clip/sequence preview, score-threshold filtering.
5. **Export** — FCPXML, EDL, or individual clips without assembly.

### Phase 2 (Post-MVP)

Modular AI harnesses (Claude Code, Codex, Pi Agent, manual/rule-based); speed
ramping, music beat sync, transition suggestions, multi-track timeline
(B-roll), project save/load.

## User Stories

**Quick Assembly** — drop 5 hours of footage, get a 2-3 minute highlight
suggestion, fine-tune, export to FCPXML. Acceptance: handles 10+ files at
once, analyzes 1hr of footage in <10 min, produces valid FCPXML.

**Shaky Footage Filtering** — AI excludes shaky segments automatically.
Acceptance: stability score on every clip, filter by smoothness > 7/10,
shaky segments flagged, optional auto-exclude.

**Manual Override** — professional editor sees AI suggestions but keeps full
manual control. Acceptance: all suggestions editable, J/K/L + arrow-key
shortcuts, manual clip creation, AI can be disabled entirely.

## Technical Requirements

- **Performance**: process 1hr of 4K/60fps footage in <10 min (M3 Mac);
  timeline UI stays responsive during background analysis.
- **Compatibility**: macOS primary (Apple Silicon), Windows/Linux
  secondary/community; MP4 (H.264/H.265) and MOV input; FCPXML/EDL output.
- **Local-first (hard constraint)**: no footage uploaded to any server; AI
  inference runs on-device (Ollama/MLX) by default; any cloud AI is optional
  and requires explicit user consent; all project data stored locally.

## UI/UX Requirements

Four-pane layout: toolbar (Import | Harness | Export | Settings), video
list, timeline (clip cards with scores), and preview player with trim
handles. Dark mode default; thumbnail scrubbing on hover; color-coded score
chips; J/K/L + I/O keyboard shortcuts; timeline zoom.

## Success Metrics

- Time to first export < 15 min for a new user; 3+ exports in first week;
  NPS > 50.
- AI accuracy: > 80% of user-kept clips scored > 7/10; export success rate
  > 95%; crash rate < 1% of sessions.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Timeline UI complexity | High | Start with simple linear timeline, no multi-track |
| Local AI too slow | High | Frame sampling (not every frame), allow cloud fallback |
| FCPXML format changes | Medium | Target FCPXML v1.10 (stable), validate with tests |
| User expects full editor | Medium | Clear positioning: assembly tool, not a replacement for FCP/Resolve |

## Out of Scope (for MVP)

Multi-track timeline, color grading, audio mixing, effects/transitions,
cloud collaboration, mobile app, and video stabilization correction
(detection only).

## Open Questions

1. Should we include audio transcription for spoken-content filtering?
2. What's the minimum viable timeline component — existing library or custom?
3. Should clips be rendered as proxy files for timeline preview?
4. How do we handle different frame rates in the same project?
