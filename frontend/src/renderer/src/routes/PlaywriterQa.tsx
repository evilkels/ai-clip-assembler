import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pingBackend } from '../api/client';
import { useReview } from '../state/ReviewContext';
import type { AnalysisResult, AnalysisStatus, UploadedVideo } from '../types/clip';

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

const visualVideos: UploadedVideo[] = [
  {
    file_id: 'visual-source-01',
    file_name: 'estepone-coast-01.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-01', file_name: 'estepone-coast-01.mp4', duration_sec: 12.4,
      fps: 59.94, resolution: [3840, 2160], codec: 'hevc', size_bytes: 734_003_200,
      created_at: '2026-08-11T10:00:00Z', has_audio: true, audio_channels: 2,
      audio_sample_rate: 48_000, audio_codec: 'aac',
    },
  },
  {
    file_id: 'visual-source-02',
    file_name: 'estepone-cliffs-02.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-02', file_name: 'estepone-cliffs-02.mp4', duration_sec: 8.7,
      fps: 59.94, resolution: [3840, 2160], codec: 'hevc', size_bytes: 512_000_000,
      created_at: '2026-08-11T10:01:00Z', has_audio: true, audio_channels: 2,
      audio_sample_rate: 48_000, audio_codec: 'aac',
    },
  },
  {
    file_id: 'visual-source-03',
    file_name: 'estepone-water-03.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-03', file_name: 'estepone-water-03.mp4', duration_sec: 15.1,
      fps: 29.97, resolution: [1920, 1080], codec: 'h264', size_bytes: 401_000_000,
      created_at: '2026-08-11T10:02:00Z', has_audio: false, audio_channels: 0,
      audio_sample_rate: null, audio_codec: null,
    },
  },
  {
    file_id: 'visual-source-04',
    file_name: 'estepone-sunset-04.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-04', file_name: 'estepone-sunset-04.mp4', duration_sec: 9.3,
      fps: 59.94, resolution: [3840, 2160], codec: 'hevc', size_bytes: 615_000_000,
      created_at: '2026-08-11T10:03:00Z', has_audio: true, audio_channels: 2,
      audio_sample_rate: 48_000, audio_codec: 'aac',
    },
  },
];

const visualClips: AnalysisResult['clips'] = [
  {
    clip_id: 'visual-clip-01', file_id: 'visual-source-01', file_name: 'estepone-coast-01.mp4',
    scene_id: 1, start_sec: 1.2, end_sec: 5.8,
    scores: { smoothness: 9.2, sharpness: 8.7, exposure: 8.9, contrast: 8.2, visualInterest: 9.1, overall: 9 },
    reason: 'Clean reveal over the coastline.', suggested_speed: 1,
    tags: ['coast', 'reveal'], source_created_at: '2026-08-11T10:00:00Z', source_duration_sec: 12.4,
  },
  {
    clip_id: 'visual-clip-02', file_id: 'visual-source-02', file_name: 'estepone-cliffs-02.mp4',
    scene_id: 2, start_sec: 0.6, end_sec: 4.9,
    scores: { smoothness: 8.4, sharpness: 8.8, exposure: 8.1, contrast: 8.6, visualInterest: 8.8, overall: 8.6 },
    reason: 'Strong parallax along the cliffs.', suggested_speed: 0.8,
    tags: ['cliffs', 'parallax'], source_created_at: '2026-08-11T10:01:00Z', source_duration_sec: 8.7,
  },
  {
    clip_id: 'visual-clip-03', file_id: 'visual-source-03', file_name: 'estepone-water-03.mp4',
    scene_id: 3, start_sec: 3.1, end_sec: 7.4,
    scores: { smoothness: 8.1, sharpness: 7.9, exposure: 9, contrast: 8, visualInterest: 8.3, overall: 8.2 },
    reason: 'Steady waterline tracking shot.', suggested_speed: 1,
    tags: ['water', 'tracking'], source_created_at: '2026-08-11T10:02:00Z', source_duration_sec: 15.1,
  },
  {
    clip_id: 'visual-clip-04', file_id: 'visual-source-04', file_name: 'estepone-sunset-04.mp4',
    scene_id: 4, start_sec: 2.4, end_sec: 6.7,
    scores: { smoothness: 8.8, sharpness: 8.5, exposure: 9.4, contrast: 8.9, visualInterest: 9.3, overall: 9.1 },
    reason: 'Warm closing frame with clear horizon.', suggested_speed: 1,
    tags: ['sunset', 'closing'], source_created_at: '2026-08-11T10:03:00Z', source_duration_sec: 9.3,
  },
];

const visualAnalysisResult: AnalysisResult = {
  project_id: 'visual-conformance-project', harness_id: 'manual', status: 'complete', clips: visualClips,
  sequence: {
    source: 'draft', profile: 'cinematic_highlight', total_duration_sec: 13.2,
    clips: visualClips.map((clip) => ({ clip_id: clip.clip_id, start_sec: clip.start_sec, end_sec: clip.end_sec })),
  },
  recommendation: { profile: 'cinematic_highlight', target_duration_sec: 15, reason: 'Balanced reveal, movement, and close.', format: 'medium' },
  generation_stats: { per_file: {}, totals: { candidates_generated: 4, candidates_kept: 4, scenes_total: 4, scenes_at_cap: 0, videos: 4 }, preferences: {} },
};

const visualAnalyzingStatus: AnalysisStatus = {
  phase: 'analyzing', harness_id: 'manual', step: 'scoring_clips', video_index: 2, video_total: 4,
  file_name: 'estepone-cliffs-02.mp4', clip_index: 3, clip_total: 4, message: 'Scoring candidate clips',
  elapsed_sec: 12, started_at: 1_755_000_000_000, updated_at: 1_755_000_012_000,
};

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

  useEffect(() => {
    if (!fixture) {
      setSeededFixture(null);
      return;
    }
    let alive = true;
    setSeededFixture(null);
    const seed = async () => {
      await openProjectFolder(VISUAL_PROJECT_FOLDER);
      if (!alive) return;
      if (fixture === 'import-analyzing') setAnalysisStatus(visualAnalyzingStatus);
      setSeededFixture(fixture);
    };
    seed().catch(() => {
      if (alive) setSeededFixture('error');
    });
    return () => {
      alive = false;
    };
  }, [applyAnalysisResult, fixture, openProjectFolder, setAnalysisStatus]);

  const fixtureNeedsTimeline = fixture === 'review-grid' || fixture === 'review-list' || fixture === 'timeline-selection' || fixture === 'export-receipt';
  useEffect(() => {
    if (!fixture || !fixtureNeedsTimeline || seededFixture !== fixture || !projectId) return;
    applyAnalysisResult(visualAnalysisResult);
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
            <span data-testid="qa-fixture-source-count">{visualVideos.length} fixed source videos</span>
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
