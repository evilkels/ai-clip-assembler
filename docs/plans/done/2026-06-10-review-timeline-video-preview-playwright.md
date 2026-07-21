# Review Timeline Video Preview Playwright Implementation Plan

**Status:** DONE — implemented and verified on `feature/project-folder-model`, completed 2026-06-10.

**Goal:** Add backend-backed video preview playback to Review and Timeline, plus a browser QA route that can be driven by Playwright.

**Architecture:** The backend exposes registered source videos through a safe project-scoped media endpoint (`GET /projects/{project_id}/videos/{file_id}/media`, using Starlette `FileResponse`, handles both uploaded and folder-based projects). The React renderer builds media URLs from project and file IDs, then uses one shared `ClipPreview` component in both Review and Timeline, bounding playback to a clip's trim range. Playwright drives Chromium against the Vite renderer at `http://localhost:5173/#/playwriter` — note the route name stays `/playwriter` for historical reasons, but the automation tool is Playwright, not the Playwriter browser extension (these are unrelated despite the name collision).

**Key decisions:**
- One shared `ClipPreview` component for both Review cards and the Timeline strip, rather than separate players, to keep seek/loop/trim-bounds logic in one place.
- The QA route (`/#/playwriter`) exposes backend-online, project id, video/candidate/accepted counts, and preview-readiness as `data-testid` elements specifically so Playwright can assert on state without scraping visual layout.
- E2E fixture video is generated on the fly via `ffmpeg lavfi color=gray` rather than checked into the repo.

**Surprises / gotchas:**
- The E2E test depends on `ffmpeg` having `vidstabdetect` support; if missing, the test fails during the analysis step, not the preview step. Fix is documented in `docs/MANUAL_QA_GUIDE.md`, not in this plan.
- Media type is inferred from file suffix (`.mov` → `video/quicktime`, `.mkv` → `video/x-matroska`, default `video/mp4`) since registered videos aren't guaranteed to be `.mp4`.

**Final verification:** 131 backend tests passed, frontend typecheck/build passed, and `npm run test:e2e -- --project=chromium` passed, covering upload, analysis, Review preview, inclusion, and Timeline preview.

**Touched areas (for reference):** `backend/src/api.py` (media endpoint + helpers), `frontend/src/renderer/src/components/ClipPreview.tsx` (new shared player), `ClipCard.tsx` and `routes/Review.tsx` (Review integration), `components/Timeline.tsx` (Timeline preview + playhead sync), `routes/PlaywriterQa.tsx` + `App.tsx` (QA route), `playwright.config.ts` + `e2e/playwriter-preview.spec.ts` (test runner and workflow test).
