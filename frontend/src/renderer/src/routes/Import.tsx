import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipGenerationPanel,
  preferencesFromGenerationStats,
} from '../components/ClipGenerationPanel';
import { SourceVideoBrowser } from '../components/SourceVideoBrowser';
import { StatusSurface } from '../components/StatusSurface';
import { WorkflowHeader } from '../components/WorkflowHeader';
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
import type { ClipGenerationPreferences } from '../types/clip';
import type { SourceVideoSort, SourceVideoSortKey } from '../lib/sourceVideoView';

const HARNESS_HINTS: Record<string, string> = {
  manual: 'rule-based, fast',
  pi_agent: 'cloud AI, opt-in',
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
    projectFolder,
    cloudAiConsent,
    uploadedVideos,
    clips,
    generationStats,
    analysisStatus,
    createUploadProject,
    setUploadedVideos,
    setAnalysisStatus,
    setCloudAiConsent,
    applyAnalysisResult,
    rederiveClips,
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
  const [harnessId, setHarnessId] = useState('manual');
  const [generationPreferences, setGenerationPreferences] =
    useState<ClipGenerationPreferences>(() => preferencesFromGenerationStats(generationStats));
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const analyzedIds = useMemo(() => new Set(clips.map((clip) => clip.file_id)), [clips]);
  // Analyzed files default to unchecked so a rescan targets the new batch.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [preview, setPreview] = useState<{ fileId: string; fileName: string } | null>(null);
  const [sort, setSort] = useState<SourceVideoSort>({
    key: null,
    dir: 'asc',
  });

  const toggleSort = useCallback((key: SourceVideoSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }, []);

  const triggerFilePicker = useCallback(() => {
    if (!projectFolder) fileInputRef.current?.click();
  }, [projectFolder]);

  useEffect(() => {
    const next = new Set<string>();
    for (const video of uploadedVideos) {
      if (analyzedIds.has(video.file_id)) next.add(video.file_id);
    }
    setDeselected(next);
  }, [projectId, uploadedVideos, analyzedIds]);

  useEffect(() => {
    setGenerationPreferences(preferencesFromGenerationStats(generationStats));
  }, [projectId, generationStats]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const selectedIds = useMemo(() => {
    const ids: string[] = [];
    for (const video of uploadedVideos) {
      if (!deselected.has(video.file_id)) ids.push(video.file_id);
    }
    return ids;
  }, [uploadedVideos, deselected]);
  const selectedCount = selectedIds.length;
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

  const deselectAll = useCallback(() => {
    setDeselected(new Set(uploadedVideos.map((video) => video.file_id)));
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
    if (!projectId) return;
    const hasCachedFrameScores = generationStats !== null;
    const shouldRederive = selectedCount === 0 && hasCachedFrameScores;
    if (selectedCount === 0 && !shouldRederive) return;
    if (shouldRederive) {
      const confirmed = window.confirm(
        'Regenerating clips resets manual include/exclude choices, order, trims, and the working timeline.',
      );
      if (!confirmed) return;
      setRegenerating(true);
      try {
        await rederiveClips(generationPreferences);
        setAnalysisStatus({ phase: 'complete' });
      } catch (err) {
        setAnalysisStatus({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRegenerating(false);
      }
      return;
    }
    setCancelling(false);
    setAnalysisStatus({ phase: 'analyzing', message: 'Preparing analysis' });
    setProgress({ phase: 'analyzing', message: 'Preparing analysis' });
    try {
      if (harnessId === 'pi_agent' && !cloudAiConsent) {
        const consented = window.confirm(
          [
            'Pi Agent can send sampled frames or clip metadata to the cloud provider configured for the Pi CLI.',
            'Consent is saved for this project. Continue with cloud AI for this project?',
          ].join('\n\n'),
        );
        if (!consented) {
          setAnalysisStatus({ phase: 'idle' });
          return;
        }
        await setCloudAiConsent(true);
      }
      const result = await analyzeProject(projectId, {
        harness_id: harnessId,
        file_ids: selectedIds,
        preferences: generationPreferences,
      });
      applyAnalysisResult(result);
      setAnalysisStatus({ phase: 'complete', notices: result.notices });
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
  }, [
    projectId,
    harnessId,
    cloudAiConsent,
    selectedIds,
    selectedCount,
    generationStats,
    generationPreferences,
    setAnalysisStatus,
    setCloudAiConsent,
    applyAnalysisResult,
    rederiveClips,
  ]);

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
            setProgress(null);
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
  const activeProgress = isAnalyzing ? progress ?? analysisStatus : analysisStatus;
  const runningFileName = isAnalyzing ? activeProgress.file_name ?? null : null;
  const activePercent = activeProgress.phase === 'analyzing' ? progressPercent(activeProgress) : null;
  const eta = estimatedRemaining(activeProgress, activePercent);

  return (
    <div className="page">
      <WorkflowHeader
        title="Import"
        step="Step 01 / 04"
        description="Choose a footage folder or upload drone footage. Analyze to detect stable clip candidates."
        actions={(
          <>
            <button type="button" className="btn primary" onClick={handleOpenFolder} disabled={openingFolder}>
              {openingFolder ? 'Opening…' : 'Create / Open Folder Project'}
            </button>
            {projectFolder ? <button type="button" className="btn subtle" onClick={rescanOpenProject}>Rescan Folder</button> : null}
          </>
        )}
      />
      <div className="page-body">
        <input
          id="source-video-picker"
          className="source-video-picker"
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,video/mp4,video/quicktime"
          multiple
          aria-label="Select MP4 or MOV files"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={`drop-zone${hasVideos ? ' drop-zone-loaded' : ''}`}
          aria-controls="source-video-picker"
          onClick={triggerFilePicker}
          disabled={Boolean(projectFolder)}
        >
          <p className="drop-zone-label">
            {uploading
              ? 'Uploading…'
              : hasVideos
                ? `${uploadedVideos.length} source video${uploadedVideos.length === 1 ? '' : 's'} ready — click to add more`
                : projectFolder
                  ? 'Add videos to the folder, then rescan'
                  : 'Click to select MP4/MOV files'}
          </p>
        </button>

        {uploadErrors.length > 0 && (
          <div className="upload-errors">
            {uploadErrors.map((e) => (
              <p key={e} className="upload-error">
                {e}
              </p>
            ))}
          </div>
        )}

        {hasVideos && (
          <div className="import-workstation" data-import-workstation>
            <SourceVideoBrowser
              videos={uploadedVideos}
              analyzedIds={analyzedIds}
              deselected={deselected}
              selectedIds={selectedIds}
              sort={sort}
              onSort={toggleSort}
              onToggleOne={toggleOne}
              onToggleAll={toggleAll}
              onPreview={(video) => setPreview({ fileId: video.file_id, fileName: video.file_name })}
              runningFileName={runningFileName}
              disabled={isAnalyzing}
              analyzing={isAnalyzing}
              regenerating={regenerating}
              canRegenerate={generationStats !== null}
              onAnalyze={handleAnalyze}
              onDeselectAll={deselectAll}
              harnessControl={(
                <label className="source-video-harness">
                  Harness
                  <select
                    value={harnessId}
                    onChange={(event) => setHarnessId(event.target.value)}
                    disabled={isAnalyzing}
                  >
                    {harnesses.map((harness) => (
                      <option key={harness.id} value={harness.id}>
                        {harness.name}{HARNESS_HINTS[harness.id] ? ` (${HARNESS_HINTS[harness.id]})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            />

            <div className="import-analysis-dock" data-analysis-dock>
              {isAnalyzing && (
                <div className="analysis-progress" data-analysis-rail="true" data-tone="accent" aria-live="polite">
                  <StatusSurface tone="accent">
                    <div className="analysis-progress-header">
                      <div>
                        <div className="analysis-progress-title">
                          {activeProgress.message ?? describeProgress(activeProgress) ?? 'Starting analysis'}
                        </div>
                        <div className="analysis-progress-subtitle">
                          {activeProgress.file_name ? `Current video: ${activeProgress.file_name}` : describeProgress(activeProgress) || 'Waiting for backend status'}
                        </div>
                      </div>
                      <div className="analysis-progress-time">
                        <span>{formatElapsed(activeProgress.elapsed_sec)} elapsed</span>
                        {eta && <span>{eta}</span>}
                      </div>
                    </div>
                    <progress
                      className={`analysis-progress-bar ${activePercent === null ? 'indeterminate' : ''}`}
                      value={activePercent ?? undefined}
                      max={100}
                      aria-label="Analysis progress"
                    />
                    <div className="analysis-phase-rail" aria-label="Analysis phases">
                      {(['motion_analysis', 'frame_extraction', 'scene_detection', 'scoring_clips'] as const).map((step) => (
                        <span key={step} className={activeProgress.step === step ? 'active' : ''}>
                          {STEP_LABELS[step]}
                        </span>
                      ))}
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
                    <div className="analysis-progress-footer">
                      <span>Running in the background — you can keep preparing your edit.</span>
                      <button type="button" className="btn subtle" onClick={handleAbort} disabled={cancelling}>
                        {cancelling ? 'Stopping…' : 'Abort'}
                      </button>
                    </div>
                  </StatusSurface>
                </div>
              )}
              <div className="analysis-controls import-analysis-anchor" aria-hidden="true" />
              <ClipGenerationPanel
                stats={generationStats}
                preferences={generationPreferences}
                onPreferencesChange={setGenerationPreferences}
                disabled={isAnalyzing || regenerating}
              />
            </div>
          </div>
        )}

        {hasError && (
          <p className="import-status-error">
            {analysisStatus.error}
          </p>
        )}

        {isComplete && (
          <div className="import-status-complete">
            <p className="import-status-success">
              Analysis complete. Head to Review to see clip candidates.
            </p>
            {analysisStatus.notices?.map((notice) => (
              <p
                key={notice.code}
                className={notice.level === 'warning' ? 'import-status-warning' : 'import-status-notice'}
              >
                {notice.message}
              </p>
            ))}
          </div>
        )}

        {isCancelled && (
          <p className="import-status-cancelled">
            Analysis cancelled. Adjust your selection and analyze again when ready.
          </p>
        )}
      </div>

      {preview && projectId && (
        <dialog
          open
          className="preview-overlay"
          aria-label={`Preview ${preview.fileName}`}
          onCancel={() => setPreview(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
        >
          <div className="preview-modal">
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
              aria-label={`Preview video for ${preview.fileName}`}
              className="preview-video"
            >
              <track kind="captions" label="No captions available" />
            </video>
          </div>
        </dialog>
      )}
    </div>
  );
}
