import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getClips, pingBackend } from '../api/client';
import { useReview } from '../state/ReviewContext';
import type { AnalysisResult } from '../types/clip';

type VisualFixture =
  | 'shell'
  | 'import-analyzing'
  | 'review-grid'
  | 'review-list'
  | 'timeline-selection'
  | 'export-receipt';

const VISUAL_FIXTURES: VisualFixture[] = [
  'shell',
  'import-analyzing',
  'review-grid',
  'review-list',
  'timeline-selection',
  'export-receipt',
];
const VISUAL_PROJECT_FOLDER = '/tmp/ai-clip-assembler/ESTEPONA_03-05-26';

function readVisualFixture(): VisualFixture | null {
  const query = window.location.hash.split('?')[1];
  const value = query ? new URLSearchParams(query).get('fixture') : null;
  return VISUAL_FIXTURES.includes(value as VisualFixture) ? value as VisualFixture : null;
}

export function PlaywriterQaPage() {
  const {
    projectId,
    uploadedVideos,
    analysisStatus,
    clips,
    acceptedCount,
    timelineItems,
    openProjectFolder,
    setAnalysisStatus,
    applyAnalysisResult,
  } = useReview();
  const [backendOnline, setBackendOnline] = useState(false);
  const fixture = readVisualFixture();
  const [seededFixture, setSeededFixture] = useState<string | null>(null);
  const seedPromises = useRef(new Map<VisualFixture, Promise<void>>());
  const hydratePromises = useRef(new Map<VisualFixture, Promise<void>>());

  useEffect(() => {
    if (!fixture) {
      setSeededFixture(null);
      return;
    }
    let alive = true;
    setSeededFixture(null);
    let seed = seedPromises.current.get(fixture);
    if (!seed) {
      seed = openProjectFolder(VISUAL_PROJECT_FOLDER);
      seedPromises.current.set(fixture, seed);
      seed.catch(() => seedPromises.current.delete(fixture));
    }
    seed.then(() => {
      if (!alive) return;
      if (fixture === 'import-analyzing') {
        setAnalysisStatus({
          phase: 'analyzing', harness_id: 'manual', step: 'scoring_clips', video_index: 2,
          video_total: 4, file_name: 'estepone-cliffs-02.mp4', clip_index: 3, clip_total: 4,
          message: 'Scoring candidate clips', elapsed_sec: 12,
          started_at: 1_755_000_000_000, updated_at: 1_755_000_012_000,
        });
      }
      setSeededFixture(fixture);
    }).catch(() => {
      if (alive) setSeededFixture('error');
    });
    return () => {
      alive = false;
    };
  }, [fixture, openProjectFolder, setAnalysisStatus]);

  const fixtureNeedsTimeline = fixture === 'review-grid' || fixture === 'review-list' || fixture === 'timeline-selection' || fixture === 'export-receipt';
  useEffect(() => {
    if (!fixture || !fixtureNeedsTimeline || seededFixture !== fixture || !projectId) return;
    let alive = true;
    let hydrate = hydratePromises.current.get(fixture);
    if (!hydrate) {
      hydrate = getClips(projectId).then((nextClips) => {
        const result: AnalysisResult = {
          project_id: projectId,
          harness_id: 'manual',
          status: 'complete',
          clips: nextClips,
          sequence: {
            source: 'draft', profile: 'cinematic_highlight', total_duration_sec: 13.2,
            clips: nextClips.map((clip) => ({ clip_id: clip.clip_id, start_sec: clip.start_sec, end_sec: clip.end_sec })),
          },
          recommendation: {
            profile: 'cinematic_highlight', target_duration_sec: 15,
            reason: 'Balanced reveal, movement, and close.', format: 'medium',
          },
          generation_stats: {
            per_file: {},
            totals: { candidates_generated: nextClips.length, candidates_kept: nextClips.length, scenes_total: nextClips.length, scenes_at_cap: 0, videos: 4 },
            preferences: {},
          },
        };
        applyAnalysisResult(result);
      });
      hydratePromises.current.set(fixture, hydrate);
      hydrate.catch(() => hydratePromises.current.delete(fixture));
    }
    hydrate.catch(() => {
      if (alive) setSeededFixture('error');
    });
    return () => {
      alive = false;
    };
  }, [applyAnalysisResult, fixture, fixtureNeedsTimeline, projectId, seededFixture]);
  const fixtureReady = seededFixture === fixture && (!fixtureNeedsTimeline || timelineItems.length > 0);

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
  const exportPreviewReady = Boolean(projectId && acceptedCount > 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Playwright QA</h1>
          <p>Browser-accessible workflow surface for automated Electron renderer checks.</p>
        </div>
      </div>
      <div className="page-body" data-testid="playwriter-qa-panel" data-qa-fixture={fixture ?? undefined}>
        {fixture && (
          <div className="accepted-strip" data-testid="qa-fixture-state">
            <h2>Deterministic fixture</h2>
            <strong data-testid="qa-fixture-ready">{fixtureReady ? fixture : 'loading'}</strong>
            <span data-testid="qa-fixture-source-count">{uploadedVideos.length} fixed source videos</span>
          </div>
        )}
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
            <div className="accepted-pill">
              <span>Export preview</span>
              <strong data-testid="qa-export-preview">{exportPreviewReady ? 'ready' : 'missing'}</strong>
            </div>
          </div>
        </div>
        <div className="controls" style={{ marginTop: 16 }}>
          <Link className="btn" to="/import">Import</Link>
          <Link className="btn" to="/review">Review</Link>
          <Link className="btn" to="/timeline">Timeline</Link>
          <Link className="btn" to="/export">Export</Link>
        </div>
        <div className="controls qa-fixture-links" aria-label="Visual fixture states">
          {VISUAL_FIXTURES.map((name) => <Link className="btn subtle" key={name} to={`/playwriter?fixture=${name}`}>{name}</Link>)}
        </div>
      </div>
    </div>
  );
}
