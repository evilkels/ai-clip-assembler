import { useCallback, useRef, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import {
  analyzeProject,
  selectProjectFolder,
  uploadVideo,
} from '../api/client';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
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
    setAnalysisStatus({ phase: 'analyzing' });
    try {
      const result = await analyzeProject(projectId);
      setClips(result.clips);
      setAnalysisStatus({ phase: 'complete' });
    } catch (err) {
      setAnalysisStatus({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [projectId, setAnalysisStatus, setClips]);

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
          <div>
            <button
              className="btn primary"
              onClick={handleAnalyze}
              disabled={isAnalyzing || isComplete}
            >
              {isAnalyzing ? 'Analyzing…' : isComplete ? 'Analysis complete' : 'Analyze'}
            </button>
          </div>
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
