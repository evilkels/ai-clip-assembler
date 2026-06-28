import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReview } from '../state/ReviewContext';
import {
  analyzeProject,
  buildVideoMediaUrl,
  cancelAnalysis,
  getAnalysisStatus,
  listHarnesses,
  selectProjectFolder,
  uploadVideo,
  type AnalysisProgress,
  type HarnessInfo,
} from '../api/client';
import { formatBytes, formatClock, formatDate } from '../lib/format';

function formatResolution(metadata: {
  resolution: [number, number];
  display_resolution?: [number, number];
}): string {
  // Display resolution accounts for rotation metadata, so vertical footage
  // (e.g. drone clips with 90° rotation) reads as 1080×1920, matching export.
  const [w, h] =
    metadata.display_resolution && metadata.display_resolution.length === 2
      ? metadata.display_resolution
      : metadata.resolution;
  const orientation = h > w ? ' ↕' : '';
  return `${w}×${h}${orientation}`;
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

function estimatedRemaining(progress: AnalysisProgress, percent: number | null): string | null {
  if (!percent || percent < 5 || typeof progress.elapsed_sec !== 'number') return null;
  const remaining = progress.elapsed_sec * ((100 - percent) / percent);
  return `about ${formatElapsed(remaining)} remaining`;
}

export function ImportPage() {
  const {
    projectId,
    projectName,
    projectFolder,
    uploadedVideos,
    clips,
    analysisStatus,
    createUploadProject,
    setUploadedVideos,
    setAnalysisStatus,
    applyAnalysisResult,
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
  const analyzedIds = useMemo(() => new Set(clips.map((clip) => clip.file_id)), [clips]);
  // Analyzed files default to unchecked so a rescan targets the new batch.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [preview, setPreview] = useState<{ fileId: string; fileName: string } | null>(null);
  const [sort, setSort] = useState<{ key: 'size' | 'date' | 'analyzed' | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc',
  });

  const toggleSort = useCallback((key: 'size' | 'date' | 'analyzed') => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }, []);

  const sortedVideos = useMemo(() => {
    if (!sort.key) return uploadedVideos;
    const factor = sort.dir === 'asc' ? 1 : -1;
    const value = (v: (typeof uploadedVideos)[number]): number =>
      sort.key === 'size'
        ? v.metadata?.size_bytes ?? 0
        : sort.key === 'analyzed'
          ? Number(analyzedIds.has(v.file_id))
        : v.metadata?.created_at
          ? new Date(v.metadata.created_at).getTime() || 0
          : 0;
    return [...uploadedVideos].sort((a, b) => (value(a) - value(b)) * factor);
  }, [uploadedVideos, sort, analyzedIds]);

  const sortArrow = (key: 'size' | 'date' | 'analyzed') =>
    sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  useEffect(() => {
    setDeselected(
      new Set(uploadedVideos.filter((video) => analyzedIds.has(video.file_id)).map((video) => video.file_id)),
    );
  }, [projectId, uploadedVideos, analyzedIds]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const selectedIds = uploadedVideos
    .map((v) => v.file_id)
    .filter((id) => !deselected.has(id));
  const selectedCount = selectedIds.length;
  const allSelected = uploadedVideos.length > 0 && selectedCount === uploadedVideos.length;

  const toggleOne = useCallback((fileId: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setDeselected((prev) => {
      // If everything is currently selected, deselect all; otherwise select all.
      const everythingSelected = uploadedVideos.every((v) => !prev.has(v.file_id));
      return everythingSelected ? new Set(uploadedVideos.map((v) => v.file_id)) : new Set();
    });
  }, [uploadedVideos]);

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
      const activeProjectId = projectId;
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
    if (!projectId || selectedCount === 0) return;
    setCancelling(false);
    setAnalysisStatus({ phase: 'analyzing', message: 'Preparing analysis' });
    setProgress({ phase: 'analyzing', message: 'Preparing analysis' });
    try {
      const result = await analyzeProject(projectId, {
        harness_id: harnessId,
        file_ids: selectedIds,
      });
      applyAnalysisResult(result);
      setAnalysisStatus({ phase: 'complete' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(message)) {
        setAnalysisStatus({ phase: 'cancelled', message: 'Analysis cancelled' });
      } else {
        setAnalysisStatus({ phase: 'error', error: message });
      }
    } finally {
      setProgress(null);
      setCancelling(false);
    }
  }, [projectId, harnessId, selectedIds, selectedCount, setAnalysisStatus, applyAnalysisResult]);

  const handleAbort = useCallback(async () => {
    if (!projectId) return;
    setCancelling(true);
    try {
      await cancelAnalysis(projectId);
    } catch {
      // The analyze request itself surfaces the final state; ignore cancel errors.
    }
  }, [projectId]);

  const isAnalyzingNow = analysisStatus.phase === 'analyzing';
  useEffect(() => {
    if (!isAnalyzingNow || !projectId) return;
    const poll = () => {
      getAnalysisStatus(projectId)
        .then((status) => {
          if (status.phase === 'analyzing') {
            setProgress(status);
            setAnalysisStatus(status);
          } else if (
            status.phase === 'error' ||
            status.phase === 'complete' ||
            status.phase === 'cancelled'
          ) {
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
  const isCancelled = analysisStatus.phase === 'cancelled';
  const hasVideos = uploadedVideos.length > 0;
  const activeProgress = progress ?? analysisStatus;
  const activePercent = activeProgress.phase === 'analyzing' ? progressPercent(activeProgress) : null;
  const eta = estimatedRemaining(activeProgress, activePercent);

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
          <button type="button" className="btn primary" onClick={handleOpenFolder} disabled={openingFolder}>
            {openingFolder ? 'Opening…' : 'Create / Open Folder Project'}
          </button>
          {projectFolder && (
            <button type="button" className="btn subtle" onClick={rescanOpenProject}>
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
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--text-muted)' }}>
                SOURCE VIDEOS
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selectedCount} of {uploadedVideos.length} selected
              </span>
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                tableLayout: 'auto',
              }}
            >
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', width: 28 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                      }}
                      onChange={toggleAll}
                      disabled={isAnalyzing}
                      aria-label="Select all videos"
                      style={{ cursor: isAnalyzing ? 'default' : 'pointer' }}
                    />
                  </th>
                  <th style={{ padding: '6px 8px', width: 28 }} aria-label="Preview" />
                  <th style={{ padding: '6px 8px' }}>File</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Duration</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>FPS</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Resolution</th>
                  <th
                    onClick={() => toggleSort('size')}
                    style={{ padding: '6px 8px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    title="Sort by size"
                  >
                    Size{sortArrow('size')}
                  </th>
                  <th
                    onClick={() => toggleSort('date')}
                    style={{ padding: '6px 8px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    title="Sort by date"
                  >
                    Date{sortArrow('date')}
                  </th>
                  <th style={{ padding: '6px 8px' }}>Codec</th>
                  <th
                    onClick={() => toggleSort('analyzed')}
                    style={{ padding: '6px 8px', cursor: 'pointer', userSelect: 'none' }}
                    title="Sort by analysis status"
                  >
                    Analysis{sortArrow('analyzed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedVideos.map((v) => {
                  const checked = !deselected.has(v.file_id);
                  return (
                    <tr
                      key={v.file_id}
                      onClick={() => !isAnalyzing && toggleOne(v.file_id)}
                      style={{
                        borderTop: '1px solid var(--border)',
                        cursor: isAnalyzing ? 'default' : 'pointer',
                        opacity: checked ? 1 : 0.45,
                        background: checked ? 'transparent' : 'var(--bg-subtle, transparent)',
                      }}
                    >
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(v.file_id)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={isAnalyzing}
                          aria-label={`Select ${v.file_name}`}
                          style={{ cursor: isAnalyzing ? 'default' : 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          type="button"
                          className="preview-eye"
                          title={`Preview ${v.file_name}`}
                          aria-label={`Preview ${v.file_name}`}
                          disabled={!projectId || !v.metadata}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreview({ fileId: v.file_id, fileName: v.file_name });
                          }}
                        >
                          👁
                        </button>
                      </td>
                      <td style={{ padding: '6px 8px' }}>{v.file_name}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {v.metadata ? formatClock(v.metadata.duration_sec) : 'Pending'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {v.metadata ? v.metadata.fps.toFixed(2) : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {v.metadata ? formatResolution(v.metadata) : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatBytes(v.metadata?.size_bytes)}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatDate(v.metadata?.created_at)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{v.metadata?.codec ?? '—'}</td>
                      <td
                        style={{
                          padding: '6px 8px',
                          color: analyzedIds.has(v.file_id) ? 'var(--green)' : 'var(--text-muted)',
                        }}
                      >
                        {analyzedIds.has(v.file_id) ? '✓ Analyzed' : '— Not analyzed'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasVideos && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button"
              className="btn primary"
              onClick={handleAnalyze}
              disabled={isAnalyzing || selectedCount === 0}
            >
              {isAnalyzing
                ? 'Analyzing…'
                : selectedCount === 0
                  ? 'Select videos to analyze'
                  : selectedCount === uploadedVideos.length
                    ? `Analyze all ${selectedCount}`
                    : `Analyze ${selectedCount} of ${uploadedVideos.length}`}
            </button>
            {isAnalyzing && (
              <button type="button" className="btn subtle" onClick={handleAbort} disabled={cancelling}>
                {cancelling ? 'Stopping…' : 'Abort'}
              </button>
            )}
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
                <span>{formatElapsed(activeProgress.elapsed_sec)} elapsed</span>
                {eta && <span>{eta}</span>}
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

        {isCancelled && (
          <p style={{ color: 'var(--text-muted)', marginTop: 12, fontSize: 13 }}>
            Analysis cancelled. Adjust your selection and analyze again when ready.
          </p>
        )}
      </div>

      {preview && projectId && (
        <div
          className="preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.fileName}`}
          onClick={() => setPreview(null)}
        >
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-head">
              <span className="preview-modal-title">{preview.fileName}</span>
              <button
                type="button"
                className="btn subtle"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <video
              key={preview.fileId}
              src={buildVideoMediaUrl(projectId, preview.fileId)}
              controls
              autoPlay
              playsInline
              className="preview-video"
            />
          </div>
        </div>
      )}
    </div>
  );
}
