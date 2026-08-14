import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pingBackend } from '../api/client';
import { useReview } from '../state/ReviewContext';

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
  const exportPreviewReady = Boolean(projectId && acceptedCount > 0);

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
      </div>
    </div>
  );
}
