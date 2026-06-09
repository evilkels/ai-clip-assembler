# Review Timeline Video Preview Playwright Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-backed video preview playback to Review and Timeline, plus a browser QA route that can be driven by Playwright.

**Architecture:** The backend exposes registered source videos through a safe project media endpoint. The React renderer builds media URLs from project and file IDs, then uses one shared clip preview component in Review and Timeline. Playwright drives Chromium against the Vite renderer URL `http://localhost:5173/#/playwriter`; the route name stays `/playwriter`, but the automation tool is Playwright, not the Playwriter extension.

**Tech Stack:** FastAPI, Starlette `FileResponse`, React 19, React Router `HashRouter`, Vite, Electron renderer, TypeScript, Playwright test runner.

---

## File Map

- Modify `backend/src/api.py`: add a registered video lookup helper, media-type helper, and `GET /projects/{project_id}/videos/{file_id}/media`.
- Modify `backend/tests/test_api.py`: add endpoint tests for upload projects, folder projects, unknown projects, unknown file IDs, and missing registered files.
- Modify `frontend/src/renderer/src/api/client.ts`: add `buildVideoMediaUrl(projectId, fileId)`.
- Modify `frontend/src/renderer/src/types/clip.ts`: keep `thumbnail_url` optional; no raw path field is added.
- Create `frontend/src/renderer/src/components/ClipPreview.tsx`: shared video player constrained to a clip range.
- Modify `frontend/src/renderer/src/components/ClipCard.tsx`: render `ClipPreview` for Review cards and expose stable test IDs.
- Modify `frontend/src/renderer/src/routes/Review.tsx`: pass media URLs into `ClipCard`.
- Modify `frontend/src/renderer/src/components/Timeline.tsx`: add Timeline preview playback synced to the current or selected segment.
- Create `frontend/src/renderer/src/routes/PlaywriterQa.tsx`: browser QA panel for Playwright at React route `/playwriter`.
- Modify `frontend/src/renderer/src/App.tsx`: register `/playwriter`.
- Modify `frontend/src/renderer/src/styles.css`: add restrained preview styles that match the existing dark editor shell.
- Modify `frontend/package.json`: add Playwright dependency and scripts.
- Create `frontend/playwright.config.ts`: start backend and renderer for E2E tests.
- Create `frontend/e2e/playwriter-preview.spec.ts`: Playwright workflow test for analysis, Review preview, and Timeline preview.

---

## Task 1: Backend Project Video Media Endpoint

**Files:**
- Modify: `backend/src/api.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write failing backend media tests**

Append these tests near the existing upload and folder project tests in `backend/tests/test_api.py`:

```python
def test_project_video_media_returns_uploaded_project_file(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    source_path = tmp_path / "registered.mp4"
    source_path.write_bytes(b"uploaded video bytes")
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(source_path),
            "status": "ready",
            "metadata": None,
        }
    )

    response = client.get(f"/projects/{project_id}/videos/file-1/media")

    assert response.status_code == 200
    assert response.content == b"uploaded video bytes"
    assert response.headers["content-type"].startswith("video/mp4")


def test_project_video_media_returns_folder_project_file(tmp_path):
    api.projects.clear()
    project_folder = tmp_path / "footage"
    project_folder.mkdir()
    source_video = project_folder / "DJI_0042.MP4"
    source_video.write_bytes(b"folder video bytes")
    client = TestClient(api.app)
    project_id = client.post(
        "/projects/from-folder",
        json={"folder_path": str(project_folder)},
    ).json()["project_id"]

    response = client.get(f"/projects/{project_id}/videos/DJI_0042.MP4/media")

    assert response.status_code == 200
    assert response.content == b"folder video bytes"
    assert response.headers["content-type"].startswith("video/mp4")


def test_project_video_media_rejects_unknown_project():
    api.projects.clear()
    client = TestClient(api.app)

    response = client.get("/projects/missing/videos/file-1/media")

    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


def test_project_video_media_rejects_unknown_file(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]

    response = client.get(f"/projects/{project_id}/videos/missing/media")

    assert response.status_code == 404
    assert response.json()["detail"] == "Video not found"


def test_project_video_media_rejects_missing_registered_file(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {
            "file_id": "file-1",
            "file_name": "DJI_0001.MP4",
            "file_path": str(tmp_path / "missing.mp4"),
            "status": "ready",
            "metadata": None,
        }
    )

    response = client.get(f"/projects/{project_id}/videos/file-1/media")

    assert response.status_code == 404
    assert response.json()["detail"] == "Video file not found"
```

- [ ] **Step 2: Run backend media tests and verify red**

Run:

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -k "project_video_media" -q
```

Expected result: all five new tests fail with `404 Not Found` because the endpoint does not exist.

- [ ] **Step 3: Implement the media endpoint**

Edit `backend/src/api.py`.

Add this import with the other FastAPI imports:

```python
from fastapi.responses import FileResponse
```

Add this route after `upload_video`:

```python
@app.get("/projects/{project_id}/videos/{file_id}/media")
async def get_project_video_media(project_id: str, file_id: str):
    video = registered_video(project_id, file_id)
    video_path = Path(video["file_path"])
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=404, detail="Video file not found")
    return FileResponse(
        video_path,
        media_type=media_type_for_video(video_path),
        filename=video["file_name"],
    )
```

Add these helpers near `videos_from_manifest`:

```python
def registered_video(project_id: str, file_id: str) -> dict:
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    for video in projects[project_id].get("videos", []):
        if video.get("file_id") == file_id:
            return video
    raise HTTPException(status_code=404, detail="Video not found")


def media_type_for_video(video_path: Path) -> str:
    suffix = video_path.suffix.lower()
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".mkv":
        return "video/x-matroska"
    return "video/mp4"
```

- [ ] **Step 4: Run backend media tests and verify green**

Run:

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -k "project_video_media" -q
```

Expected result: `5 passed`.

- [ ] **Step 5: Run focused API tests**

Run:

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_api.py -q
```

Expected result: all `test_api.py` tests pass.

- [ ] **Step 6: Commit backend media endpoint**

Run:

```bash
git add backend/src/api.py backend/tests/test_api.py
git commit -m "feat: serve registered project videos"
```

---

## Task 2: Frontend Media URL Helper And Shared Preview Component

**Files:**
- Modify: `frontend/src/renderer/src/api/client.ts`
- Create: `frontend/src/renderer/src/components/ClipPreview.tsx`
- Modify: `frontend/src/renderer/src/styles.css`

- [ ] **Step 1: Add media URL helper**

Append this helper after `backendUrl()` in `frontend/src/renderer/src/api/client.ts`:

```ts
export function buildVideoMediaUrl(projectId: string, fileId: string): string {
  return `${backendUrl()}/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(fileId)}/media`;
}
```

- [ ] **Step 2: Create shared clip preview component**

Create `frontend/src/renderer/src/components/ClipPreview.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';

interface ClipPreviewProps {
  mediaUrl?: string;
  startSec: number;
  endSec: number;
  label: string;
  currentTimeSec?: number;
  playing?: boolean;
  loop?: boolean;
  testId: string;
}

function boundedStart(startSec: number, endSec: number): number {
  return Math.max(0, Math.min(startSec, Math.max(startSec, endSec - 0.05)));
}

export function ClipPreview({
  mediaUrl,
  startSec,
  endSec,
  label,
  currentTimeSec,
  playing = false,
  loop = true,
  testId,
}: ClipPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const safeStart = useMemo(() => boundedStart(startSec, endSec), [startSec, endSec]);
  const targetTime = currentTimeSec ?? safeStart;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    const seek = () => {
      video.currentTime = targetTime;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [mediaUrl, targetTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (Math.abs(video.currentTime - targetTime) > 0.35) {
      video.currentTime = targetTime;
    }
  }, [mediaUrl, targetTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [mediaUrl, playing]);

  if (!mediaUrl) {
    return (
      <div className="clip-preview missing" data-testid={`${testId}-missing`}>
        <span>{label}</span>
        <span>No preview</span>
      </div>
    );
  }

  return (
    <div className="clip-preview">
      <video
        ref={videoRef}
        data-testid={testId}
        src={mediaUrl}
        controls
        muted
        preload="metadata"
        playsInline
        aria-label={label}
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = safeStart;
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (video.currentTime < startSec) video.currentTime = safeStart;
          if (video.currentTime >= endSec) {
            if (loop && endSec > startSec) {
              video.currentTime = safeStart;
              if (playing) video.play().catch(() => {});
            } else {
              video.pause();
              video.currentTime = safeStart;
            }
          }
        }}
      />
      <div className="clip-preview-label">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Add preview styles**

Append these styles near the existing clip and timeline styles in `frontend/src/renderer/src/styles.css`:

```css
.clip-preview {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #05070a;
  min-height: 160px;
}

.clip-preview video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: #05070a;
}

.clip-preview.missing {
  display: grid;
  place-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 12px;
  aspect-ratio: 16 / 9;
}

.clip-preview-label {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-main);
  font-size: 11px;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.75);
}

.timeline-preview {
  display: grid;
  grid-template-columns: minmax(280px, 520px) minmax(180px, 1fr);
  gap: 16px;
  align-items: stretch;
  margin-bottom: 16px;
}

.timeline-preview-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.timeline-preview-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-main);
  font-size: 14px;
}

@media (max-width: 900px) {
  .timeline-preview {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run frontend typecheck and verify green**

Run:

```bash
cd frontend && npm run typecheck
```

Expected result: `tsc --noEmit -p tsconfig.json` exits with code `0`.

- [ ] **Step 5: Commit media helper and preview component**

Run:

```bash
git add frontend/src/renderer/src/api/client.ts frontend/src/renderer/src/components/ClipPreview.tsx frontend/src/renderer/src/styles.css
git commit -m "feat: add reusable clip preview player"
```

---

## Task 3: Review Clip Preview Integration

**Files:**
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Modify: `frontend/src/renderer/src/routes/Review.tsx`

- [ ] **Step 1: Update ClipCard props and render preview**

Edit `frontend/src/renderer/src/components/ClipCard.tsx`.

Add this import:

```ts
import { ClipPreview } from './ClipPreview';
```

Change `Props` to include a media URL:

```ts
interface Props {
  clip: ClipCandidate;
  rank: number;
  decision: ClipDecision;
  mediaUrl?: string;
  onToggleInclude: () => void;
  onExclude: () => void;
}
```

Change the component signature:

```tsx
export function ClipCard({ clip, rank, decision, mediaUrl, onToggleInclude, onExclude }: Props) {
```

Replace the current `.clip-thumb` block with:

```tsx
<div className="clip-thumb">
  <span className="clip-thumb-rank">#{rank}</span>
  <ClipPreview
    mediaUrl={mediaUrl}
    startSec={clip.start_sec}
    endSec={clip.end_sec}
    label={clip.file_name}
    testId="clip-preview-video"
  />
  <span className="clip-thumb-time">{(clip.end_sec - clip.start_sec).toFixed(1)}s</span>
</div>
```

- [ ] **Step 2: Pass Review media URLs**

Edit `frontend/src/renderer/src/routes/Review.tsx`.

Add this import:

```ts
import { buildVideoMediaUrl } from '../api/client';
```

Destructure `projectId` from `useReview()`:

```ts
    projectId,
```

Pass `mediaUrl` to each `ClipCard`:

```tsx
<ClipCard
  key={clip.clip_id}
  clip={clip}
  rank={idx + 1}
  decision={decision}
  mediaUrl={projectId ? buildVideoMediaUrl(projectId, clip.file_id) : undefined}
  onToggleInclude={() =>
    decision === 'included' ? resetDecision(clip.clip_id) : include(clip.clip_id)
  }
  onExclude={() =>
    decision === 'excluded' ? resetDecision(clip.clip_id) : exclude(clip.clip_id)
  }
/>
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected result: exits with code `0`.

- [ ] **Step 4: Commit Review preview integration**

Run:

```bash
git add frontend/src/renderer/src/components/ClipCard.tsx frontend/src/renderer/src/routes/Review.tsx
git commit -m "feat: preview clips in review"
```

---

## Task 4: Timeline Preview And Playback Synchronization

**Files:**
- Modify: `frontend/src/renderer/src/components/Timeline.tsx`

- [ ] **Step 1: Add imports and project ID**

Edit `frontend/src/renderer/src/components/Timeline.tsx`.

Add imports:

```ts
import { buildVideoMediaUrl } from '../api/client';
import { ClipPreview } from './ClipPreview';
```

Change the `useReview()` destructure:

```ts
  const { projectId, clips, acceptedOrder, trims, reorderAccepted, moveAccepted, setTrim, resetDecision } =
    useReview();
```

- [ ] **Step 2: Add selected segment and preview timing**

Place this after `currentSegment`:

```ts
  const selectedSegment = selectedId
    ? segments.find((seg) => seg.clip.clip_id === selectedId)
    : undefined;

  const previewSegment = currentSegment ?? selectedSegment ?? segments[0];
  const previewRelativeTime =
    previewSegment && currentSegment?.clip.clip_id === previewSegment.clip.clip_id
      ? clamp(playhead - previewSegment.offset, 0, previewSegment.duration)
      : 0;
  const previewSourceTime = previewSegment
    ? previewSegment.trimStart + previewRelativeTime
    : 0;
  const previewMediaUrl =
    projectId && previewSegment
      ? buildVideoMediaUrl(projectId, previewSegment.clip.file_id)
      : undefined;
```

- [ ] **Step 3: Render Timeline preview before toolbar**

Inside the non-empty return, immediately after `<div className="timeline">`, add:

```tsx
      {previewSegment && (
        <section className="timeline-preview" aria-label="Timeline video preview">
          <ClipPreview
            mediaUrl={previewMediaUrl}
            startSec={previewSegment.trimStart}
            endSec={previewSegment.trimEnd}
            currentTimeSec={previewSourceTime}
            playing={direction === 1 && currentSegment?.clip.clip_id === previewSegment.clip.clip_id}
            loop={false}
            label={previewSegment.clip.file_name}
            testId="timeline-preview-video"
          />
          <div className="timeline-preview-meta">
            <strong data-testid="timeline-preview-current-clip">
              {previewSegment.clip.file_name}
            </strong>
            <span>
              Source {formatTime(previewSegment.trimStart)} → {formatTime(previewSegment.trimEnd)}
            </span>
            <span>
              Timeline {formatTime(previewSegment.offset)} · {(previewSegment.duration).toFixed(1)}s
            </span>
          </div>
        </section>
      )}
```

- [ ] **Step 4: Make selected clip drive preview even before scrub**

In the existing `onPointerDown` handler for each `.tl-clip`, keep the existing selection and also move the playhead to the start of that segment:

```tsx
onPointerDown={(e) => {
  e.stopPropagation();
  setSelectedId(seg.clip.clip_id);
  setPlayhead(seg.offset);
}}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected result: exits with code `0`.

- [ ] **Step 6: Commit Timeline preview integration**

Run:

```bash
git add frontend/src/renderer/src/components/Timeline.tsx
git commit -m "feat: preview timeline playback"
```

---

## Task 5: Browser QA Route For Playwright

**Files:**
- Create: `frontend/src/renderer/src/routes/PlaywriterQa.tsx`
- Modify: `frontend/src/renderer/src/App.tsx`

- [ ] **Step 1: Create QA route component**

Create `frontend/src/renderer/src/routes/PlaywriterQa.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { pingBackend } from '../api/client';
import { useReview } from '../state/ReviewContext';
import { useEffect, useState } from 'react';

export function PlaywriterQaPage() {
  const {
    projectId,
    uploadedVideos,
    analysisStatus,
    clips,
    acceptedCount,
  } = useReview();
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      pingBackend().then((status) => {
        if (alive) setBackendOnline(status.online);
      });
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const reviewPreviewReady = Boolean(projectId && clips.length > 0);
  const timelinePreviewReady = Boolean(projectId && acceptedCount > 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Playwright QA</h1>
          <p>Browser-accessible workflow surface for automated Electron renderer checks.</p>
        </div>
      </div>
      <div className="page-body" data-testid="playwriter-qa-panel">
        <div className="accepted-strip">
          <h2>QA status</h2>
          <div className="accepted-list">
            <div className="accepted-pill">
              <span>Backend</span>
              <strong data-testid="qa-backend-online">{backendOnline ? 'online' : 'offline'}</strong>
            </div>
            <div className="accepted-pill">
              <span>Project</span>
              <strong data-testid="qa-project-id">{projectId ?? 'none'}</strong>
            </div>
            <div className="accepted-pill">
              <span>Videos</span>
              <strong data-testid="qa-source-video-count">{uploadedVideos.length}</strong>
            </div>
            <div className="accepted-pill">
              <span>Analysis</span>
              <strong data-testid="qa-analysis-phase">{analysisStatus.phase}</strong>
            </div>
            <div className="accepted-pill">
              <span>Candidates</span>
              <strong data-testid="qa-candidate-count">{clips.length}</strong>
            </div>
            <div className="accepted-pill">
              <span>Accepted</span>
              <strong data-testid="qa-accepted-count">{acceptedCount}</strong>
            </div>
            <div className="accepted-pill">
              <span>Review preview</span>
              <strong data-testid="qa-review-preview">{reviewPreviewReady ? 'ready' : 'missing'}</strong>
            </div>
            <div className="accepted-pill">
              <span>Timeline preview</span>
              <strong data-testid="qa-timeline-preview">{timelinePreviewReady ? 'ready' : 'missing'}</strong>
            </div>
          </div>
        </div>
        <div className="controls" style={{ marginTop: 16 }}>
          <Link className="btn" to="/import">Import</Link>
          <Link className="btn" to="/review">Review</Link>
          <Link className="btn" to="/timeline">Timeline</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register route**

Edit `frontend/src/renderer/src/App.tsx`.

Add import:

```ts
import { PlaywriterQaPage } from './routes/PlaywriterQa';
```

Add route:

```tsx
<Route path="/playwriter" element={<PlaywriterQaPage />} />
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected result: exits with code `0`.

- [ ] **Step 4: Commit QA route**

Run:

```bash
git add frontend/src/renderer/src/routes/PlaywriterQa.tsx frontend/src/renderer/src/App.tsx
git commit -m "feat: add playwright qa route"
```

---

## Task 6: Playwright Test Runner And Workflow Test

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/playwriter-preview.spec.ts`

- [ ] **Step 1: Install Playwright test dependency**

Run:

```bash
cd frontend && npm install -D @playwright/test
```

Expected result: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Add Playwright scripts**

Edit `frontend/package.json` scripts:

```json
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed"
```

The scripts block keeps the existing scripts and adds these two entries.

- [ ] **Step 3: Add Playwright config**

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'cd ../backend && PYTHONPATH=. .venv/bin/uvicorn src.api:app --port 8000',
      url: 'http://127.0.0.1:8000/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:renderer -- --host localhost',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

- [ ] **Step 4: Add Playwright workflow test**

Create `frontend/e2e/playwriter-preview.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function ensureFixtureVideo(): string {
  const dir = join(process.cwd(), 'e2e', '.fixtures');
  const file = join(dir, 'preview-fixture.mp4');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:size=640x360:rate=30',
      '-t',
      '6',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }
  return file;
}

test('analysis completes and review/timeline previews render playable videos', async ({ page }) => {
  const videoPath = process.env.E2E_VIDEO_FIXTURE ?? ensureFixtureVideo();

  await page.goto('/#/playwriter');
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await expect(page.getByTestId('qa-backend-online')).toHaveText('online');

  await page.getByRole('link', { name: 'Import' }).click();
  await page.getByRole('button', { name: 'Legacy upload project' }).click();
  await page.locator('input[type="file"]').setInputFiles(videoPath);
  await expect(page.getByText(/1 source video ready/)).toBeVisible();

  await page.getByLabel('Harness').selectOption('manual');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByText(/Analysis complete/)).toBeVisible({ timeout: 180_000 });

  await page.goto('/#/review');
  const reviewPreview = page.getByTestId('clip-preview-video').first();
  await expect(reviewPreview).toBeVisible();
  await expect
    .poll(async () => reviewPreview.evaluate((video) => (video as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Include' }).first().click();

  await page.goto('/#/timeline');
  const timelinePreview = page.getByTestId('timeline-preview-video');
  await expect(timelinePreview).toBeVisible();
  await expect(page.getByTestId('timeline-preview-current-clip')).not.toHaveText('');
  await expect
    .poll(async () => timelinePreview.evaluate((video) => (video as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 5: Run Playwright install**

Run:

```bash
cd frontend && npx playwright install chromium
```

Expected result: Chromium browser is installed or reported as already installed.

- [ ] **Step 6: Run Playwright E2E test**

Run:

```bash
cd frontend && npm run test:e2e -- --project=chromium
```

Expected result: the single E2E test passes. If `ffmpeg` lacks `vidstabdetect`, the test fails during analysis and the correct fix is the FFmpeg setup documented in `docs/MANUAL_QA_GUIDE.md`.

- [ ] **Step 7: Commit Playwright coverage**

Run:

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/e2e/playwriter-preview.spec.ts
git commit -m "test: cover preview workflow with playwright"
```

---

## Task 7: Full Verification

**Files:**
- No new file edits.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
```

Expected result: all backend tests pass.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected result: exits with code `0`.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected result: Electron Vite build completes without TypeScript or bundling errors.

- [ ] **Step 4: Run Playwright workflow**

Run:

```bash
cd frontend && npm run test:e2e -- --project=chromium
```

Expected result: the Playwright workflow passes in Chromium.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected result: no unstaged implementation files from these tasks remain. Existing unrelated user changes can remain if they were present before this plan was executed.
