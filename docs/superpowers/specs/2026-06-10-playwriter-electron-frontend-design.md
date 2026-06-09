# Playwriter Electron Frontend Design

## Goal

Enable Playwriter-driven QA for the Electron frontend by adding a browser-accessible `/playwriter` route to the same React renderer app and by adding real video previews to the Review and Timeline workflows.

The route must let Chrome-based Playwriter verify the current end-to-end workflow:

- analysis can complete for an opened project
- Review shows playable previews for candidate clips
- Timeline shows a playable preview for the current or selected segment

## Context

Playwriter controls Chrome, not the Electron application window. The Electron renderer is already a Vite React app, so the most direct integration is a browser-safe route served by the existing renderer dev server at `http://localhost:5173/playwriter`.

The existing renderer falls back to `http://127.0.0.1:8000` when the Electron preload bridge is unavailable. That makes the same API client usable in Chrome without adding Electron-specific automation hooks.

The backend currently exposes project, analysis, clip, timeline, and export endpoints, but it does not expose source video media for preview playback. Review cards currently render text thumbnails, and Timeline has transport/scrub state but no video element tied to the current segment.

## Chosen Approach

Add a dev/test route inside the renderer instead of trying to automate Electron directly.

This approach is preferred because it:

- matches Playwriter's Chrome control model
- keeps the tested UI close to the Electron renderer code
- avoids adding remote debugging or test-only Electron main-process behavior
- allows Playwriter to inspect normal DOM elements, routes, status text, and media elements

The route is not linked from the production sidebar. It is reachable by direct URL during development and QA.

## Backend Media API

Add a safe media endpoint for project source videos:

`GET /projects/{project_id}/videos/{file_id}/media`

Behavior:

- returns the source video for the matching project and file ID
- supports folder-backed projects where `file_id` is the filename
- supports legacy upload projects where `file_id` is the generated UUID
- rejects unknown projects or files with `404`
- returns a video media response suitable for browser `<video>` playback

The endpoint must only resolve videos already registered inside the in-memory project state. It must not accept arbitrary filesystem paths from the request.

## Frontend Data Flow

Extend the typed API client with a helper that builds media URLs from `projectId` and `fileId`.

Map each `ClipCandidate` to:

- `mediaUrl`
- `start_sec`
- `end_sec`
- `file_name`

No raw local file path is exposed to the renderer. The browser and Electron renderer both load media through the backend.

## Review Preview

Update Review clip cards so each candidate has a preview area with a `<video>` element when a project-backed media URL exists.

Expected behavior:

- video source points to the backend media endpoint
- initial playback position seeks to `clip.start_sec`
- playback pauses or loops within the clip range
- the existing rank, scores, reason, Include, and Exclude controls remain visible
- cards still render a non-media placeholder when no project is open or media is unavailable

Playwriter verification must use stable DOM attributes. Review preview videos use `data-testid="clip-preview-video"`.

## Timeline Preview

Update Timeline so the current or selected segment drives a preview player.

Expected behavior:

- the preview uses the segment's source media URL
- the preview seeks to the segment trim start
- playhead movement updates the preview time relative to the segment's source in-point
- selecting a timeline clip updates the preview
- transport controls remain usable for timeline scrubbing

Playwriter verification must use stable DOM attributes. The Timeline preview video uses `data-testid="timeline-preview-video"`, and the current clip label uses `data-testid="timeline-preview-current-clip"`.

## `/playwriter` Route

Add `/playwriter` as a browser QA surface inside the existing React router.

The route uses the normal app shell and same state provider so it exercises the same frontend code paths. It includes a compact QA status panel with machine-readable statuses for Playwriter:

- backend online/offline
- current project ID
- source video count
- analysis phase
- candidate clip count
- accepted clip count
- Review preview availability
- Timeline preview availability

The route must not introduce a separate mock workflow. Its value is that Playwriter can drive the real Import, Review, and Timeline UI in Chrome.

## Test Strategy

Backend tests:

- registered project video media endpoint returns source bytes for upload projects
- registered folder project video media endpoint returns source bytes
- unknown project returns `404`
- unknown file ID returns `404`

Frontend verification:

- `npm run typecheck`
- `npm run build`
- manual browser verification at `http://localhost:5173/playwriter`
- Playwriter verification of the three acceptance points

## Risks

- Browser video playback depends on codecs supported by Chromium; MP4/H.264 is expected to work, but unusual codecs may not preview.
- Analysis remains a blocking backend operation, so Playwriter checks must wait for completion status instead of assuming fixed timing.
- Backend project state is still in memory; `/playwriter` QA is for the active dev session, not persistence across backend restarts.

## Non-Goals

- no direct Electron-window automation
- no production sidebar entry for `/playwriter`
- no remote upload or cloud video access
- no frame-accurate editing engine
- no persistent project database
