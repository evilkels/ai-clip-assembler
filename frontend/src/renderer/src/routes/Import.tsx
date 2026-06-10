import { useCallback, useEffect, useRef, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import {
  analyzeProject,
  getAnalysisStatus,
  listHarnesses,
  selectProjectFolder,
  uploadVideo,
  type AnalysisProgress,
  type HarnessInfo,
} from '../api/client';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

const HARNESS_HINTS: Record<string, string> = {
  manual: 'rule-based, fast',
  pi_agent: 'AI scoring, slower',
};

const STEP_LABELS: Record<string, string> = {
  starting: 'Starting',
  motion_analysis: 'Motion analysis',
  frame_extraction: 'Extracting frames',
  scene_detection: 'Detecting scenes',
  scoring_clips: 'Scoring clips with AI',
  complete: 'Complete',
};

function describeProgress(progress: AnalysisProgress): string {
  const step = STEP_LABELS[progress.step ?? ''] ?? progress.step ?? '';
  const video =
    progress.video_total && progress.video_index
      ? `Video ${progress.video_index}/${progress.video_total}${progress.file_name ? ` (${progress.file_name})` : ''}`
      : '';
  const clips =
    progress.step === 'scoring_clips' && progress.clip_total
      ? ` — clip ${progress.clip_index ?? 0}/${progress.clip_total}`
      : '';
  return [video, step].filter(Boolean).join(': ') + clips;
}

function formatElapsed(sec?: number): string {
  if (typeof sec !== 'number') return '0s';
  const whole = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

const STEP_PROGRESS: Record<string, number> = {
  starting: 0.02,
  motion_analysis: 0.15,
  frame_extraction: 0.4,
  scene_detection: 0.62,
  scoring_clips: 0.82,
  complete: 1,
};

function progressPercent(progress: AnalysisProgress): number | null {
  if (!progress.video_total || !progress.video_index) return null;
  const completedVideos = Math.max(0, progress.video_index - 1);
  let currentVideoProgress = STEP_PROGRESS[progress.step ?? ''] ?? 0.05;
  if (progress.step === 'scoring_clips' && progress.clip_total) {
    const clipProgress = Math.min(1, Math.max(0, (progress.clip_index ?? 0) / progress.clip_total));
    currentVideoProgress = 0.82 + clipProgress * 0.18;
  }
  const overall = ((completedVideos + currentVideoProgress) / progress.video_total) * 100;
  return Math.max(2, Math.min(100, overall));
}

export function ImportPage() {
  const {
    projectId,
    projectName,
    projectFolder,
    uploadedVideos,
    analysisStatus,
    createUploadProject,
    setUploadedVideos,
    setAnalysisStatus,
    setClips,
    openProjectFolder,
    rescanOpenProject,
  } = useReview();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([
    { id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true },
    { id: 'pi_agent', name: 'Pi Agent', type: 'agent', enabled: true },
  ]);
  const [harnessId, setHarnessId] = useState('pi_agent');
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  useEffect(() => {
    listHarnesses()
      .then((all) => {
        const enabled = all.filter((h) => h.enabled);
        if (enabled.length > 0) setHarnesses(enabled);
      })
      .catch(() => {
        // Backend offline; keep the default list.
      });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList) => {
      setUploadErrors([]);
      setUploading(true);
      const accepted = Array.from(files).filter((f) =>
        /\.(mp4|mov|MP4|MOV)$/.test(f.name),
      );
      if (accepted.length === 0) {
        setUploadErrors(['No MP4/MOV files selected.']);
        setUploading(false);
        return;
      }
      let activeProjectId = projectId;
      if (!activeProjectId) {
        await createUploadProject();
        setUploadErrors(['Legacy upload project created. Select the files again to upload.']);
        setUploading(false);
        return;
      }
      const newVideos = [...uploadedVideos];
      for (const file of accepted) {
        try {
          const video = await uploadVideo(activeProjectId, file);
          newVideos.push(video);
        } catch (err) {
          setUploadErrors((prev) => [
            ...prev,
            `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
          ]);
        }
      }
      setUploadedVideos(newVideos);
      setUploading(false);
    },
    [projectId, uploadedVideos, setUploadedVideos, createUploadProject],
  );

  const handleAnalyze = useCallback(async () => {
    if (!projectId) return;
    setAnalysisStatus({ phase: 'analyzing', message: 'Preparing analysis' });
    setProgress({ phase: 'analyzing', message: 'Preparing analysis' });
    try {
      const result = await analyzeProject(projectId, { harness_id: harnessId });
      setClips(result.clips);
      setAnalysisStatus({ phase: 'complete' });
    } catch (err) {
      setAnalysisStatus({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProgress(null);
    }
  }, [projectId, harnessId, setAnalysisStatus, setClips]);

  const isAnalyzingNow = analysisStatus.phase === 'analyzing';
  useEffect(() => {
    if (!isAnalyzingNow || !projectId) return;
    const poll = () => {
      getAnalysisStatus(projectId)
        .then((status) => {
          if (status.phase === 'analyzing') {
            setProgress(status);
            setAnalysisStatus(status);
          } else if (status.phase === 'error' || status.phase === 'complete') {
            setAnalysisStatus(status);
          }
        })
        .catch(() => {
          // Transient poll failure; the analyze request itself reports errors.
        });
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [isAnalyzingNow, projectId, setAnalysisStatus]);

  const handleOpenFolder = useCallback(async () => {
    setUploadErrors([]);
    setOpeningFolder(true);
    try {
      const folderPath = await selectProjectFolder();
      if (!folderPath) return;
      await openProjectFolder(folderPath);
    } catch (err) {
      setUploadErrors([
        err instanceof Error ? err.message : String(err),
      ]);
    } finally {
      setOpeningFolder(false);
    }
  }, [openProjectFolder]);

  const isAnalyzing = analysisStatus.phase === 'analyzing';
  const isComplete = analysisStatus.phase === 'complete';
  const hasError = analysisStatus.phase === 'error';
  const hasVideos = uploadedVideos.length > 0;
  const activeProgress = progress ?? analysisStatus;
  const activePercent = activeProgress.phase === 'analyzing' ? progressPercent(activeProgress) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Import</h1>
          <p>
            {projectFolder
              ? `${projectName ?? 'Project'} · ${projectFolder}`
              : 'Choose a footage folder or upload drone footage. Analyze to detect stable clip candidates.'}
          </p>
        </div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn primary" onClick={handleOpenFolder} disabled={openingFolder}>
            {openingFolder ? 'Opening…' : 'Create / Open Folder Project'}
          </button>
          {projectFolder && (
            <button className="btn subtle" onClick={rescanOpenProject}>
              Rescan Folder
            </button>
          )}
        </div>

        <div
          className="drop-zone"
          onClick={() => {
            if (!projectFolder) fileInputRef.current?.click();
          }}
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: 24,
            textAlign: 'center',
            cursor: projectFolder ? 'default' : 'pointer',
            marginBottom: 16,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <p style={{ margin: 0 }}>
            {uploading
              ? 'Uploading…'
              : hasVideos
                ? `${uploadedVideos.length} source video${uploadedVideos.length === 1 ? '' : 's'} ready — click to add more`
                : projectFolder
                  ? 'Add videos to the folder, then rescan'
                  : 'Click to select MP4/MOV files'}
          </p>
        </div>

        {uploadErrors.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {uploadErrors.map((e, i) => (
              <p key={i} style={{ color: 'var(--text-error)', margin: '2px 0', fontSize: 12 }}>
                {e}
              </p>
            ))}
          </div>
        )}

        {uploadedVideos.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
              SOURCE VIDEOS
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>File</th>
                  <th style={{ padding: '4px 8px' }}>Duration</th>
                  <th style={{ padding: '4px 8px' }}>FPS</th>
                  <th style={{ padding: '4px 8px' }}>Resolution</th>
                  <th style={{ padding: '4px 8px' }}>Codec</th>
                </tr>
              </thead>
              <tbody>
                {uploadedVideos.map((v) => (
                  <tr key={v.file_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{v.file_name}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {v.metadata ? formatDuration(v.metadata.duration_sec) : 'Pending analysis'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {v.metadata ? v.metadata.fps.toFixed(2) : '—'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {v.metadata ? `${v.metadata.resolution[0]}×${v.metadata.resolution[1]}` : '—'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>{v.metadata?.codec ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasVideos && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn primary"
              onClick={handleAnalyze}
              disabled={isAnalyzing || isComplete}
            >
              {isAnalyzing ? 'Analyzing…' : isComplete ? 'Analysis complete' : 'Analyze'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              Harness
              <select
                value={harnessId}
                onChange={(e) => setHarnessId(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  background: 'transparent',
                  color: 'inherit',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 12,
                }}
              >
                {harnesses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {HARNESS_HINTS[h.id] ? ` (${HARNESS_HINTS[h.id]})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {isAnalyzing && (
          <section className="analysis-progress" aria-live="polite">
            <div className="analysis-progress-header">
              <div>
                <div className="analysis-progress-title">
                  {activeProgress.message ?? describeProgress(activeProgress) ?? 'Starting analysis'}
                </div>
                <div className="analysis-progress-subtitle">
                  {describeProgress(activeProgress) || 'Waiting for backend status'}
                </div>
              </div>
              <div className="analysis-progress-time">
                {formatElapsed(activeProgress.elapsed_sec)}
              </div>
            </div>
            <div
              className={`analysis-progress-bar ${activePercent === null ? 'indeterminate' : ''}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={activePercent ?? undefined}
            >
              <span style={{ width: activePercent === null ? '36%' : `${activePercent}%` }} />
            </div>
            <div className="analysis-progress-meta">
              <span>{STEP_LABELS[activeProgress.step ?? ''] ?? activeProgress.step ?? 'Starting'}</span>
              {activeProgress.video_total ? (
                <span>
                  Video {activeProgress.video_index ?? 0}/{activeProgress.video_total}
                </span>
              ) : null}
              {activeProgress.clip_total ? (
                <span>
                  Pi clips {activeProgress.clip_index ?? 0}/{activeProgress.clip_total}
                </span>
              ) : null}
            </div>
          </section>
        )}

        {hasError && (
          <p style={{ color: 'var(--text-error)', marginTop: 12, fontSize: 13 }}>
            {analysisStatus.error}
          </p>
        )}

        {isComplete && (
          <p style={{ color: 'var(--text-success)', marginTop: 12, fontSize: 13 }}>
            Analysis complete. Head to Review to see clip candidates.
          </p>
        )}
      </div>
    </div>
  );
}
