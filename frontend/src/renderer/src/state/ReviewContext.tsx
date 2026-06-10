import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addRecentProject,
  createProject,
  createProjectFromFolder,
  deleteProjectFiles,
  getClipsWithFallback,
  getSavedTimeline,
  listRecentProjects,
  relocateRecentProject,
  removeRecentProject,
  regenerateDraft as requestDraft,
  rescanProject,
  updateTimeline,
} from '../api/client';
import type {
  AnalysisStatus,
  AnalysisResult,
  AssemblyProfile,
  AssemblyRecommendation,
  ClipCandidate,
  ClipDecision,
  RecentProject,
  Trim,
  UploadedVideo,
} from '../types/clip';

interface ReviewState {
  projectId: string | null;
  projectName: string | null;
  projectFolder: string | null;
  recentProjects: RecentProject[];
  uploadedVideos: UploadedVideo[];
  analysisStatus: AnalysisStatus;
  loading: boolean;
  error: string | null;
  clips: ClipCandidate[];
  decisions: Record<string, ClipDecision>;
  acceptedOrder: string[];
  trims: Record<string, Trim>;
  smoothnessThreshold: number;
  setSmoothnessThreshold: (v: number) => void;
  include: (clipId: string) => void;
  exclude: (clipId: string) => void;
  resetDecision: (clipId: string) => void;
  moveAccepted: (clipId: string, direction: -1 | 1) => void;
  reorderAccepted: (clipId: string, toIndex: number) => void;
  setTrim: (clipId: string, trim: Trim) => void;
  setProjectId: (id: string | null) => void;
  setUploadedVideos: (videos: UploadedVideo[]) => void;
  setAnalysisStatus: (status: AnalysisStatus) => void;
  applyAnalysisResult: (result: AnalysisResult) => void;
  recommendation: AssemblyRecommendation | null;
  regenerateDraft: (profile: AssemblyProfile, targetDurationSec: number) => Promise<void>;
  createUploadProject: () => Promise<void>;
  openProjectFolder: (folderPath: string) => Promise<void>;
  refreshRecentProjects: () => Promise<void>;
  removeRecent: (folderPath: string) => Promise<void>;
  relocateRecent: (folderPath: string) => Promise<void>;
  rescanOpenProject: () => Promise<void>;
  deleteOpenProjectFiles: () => Promise<void>;
  acceptedCount: number;
  totalCount: number;
}

const Ctx = createContext<ReviewState | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [uploadedVideos, setUploadedVideos] = useState<UploadedVideo[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>({ phase: 'idle' });
  const [clips, setClipCandidates] = useState<ClipCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ClipDecision>>({});
  const [acceptedOrder, setAcceptedOrder] = useState<string[]>([]);
  const [trims, setTrims] = useState<Record<string, Trim>>({});
  const [smoothnessThreshold, setSmoothnessThreshold] = useState(7);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [recommendation, setRecommendation] = useState<AssemblyRecommendation | null>(null);

  const resetProjectSession = useCallback(() => {
    setClipCandidates([]);
    setDecisions({});
    setAcceptedOrder([]);
    setTrims({});
    setAnalysisStatus({ phase: 'idle' });
    setError(null);
    setReviewRevision(0);
    setRecommendation(null);
  }, []);

  const refreshRecentProjects = useCallback(async () => {
    setRecentProjects(await listRecentProjects());
  }, []);

  useEffect(() => {
    refreshRecentProjects().catch(() => {});
  }, [refreshRecentProjects]);

  const createUploadProject = useCallback(async () => {
    setLoading(true);
    try {
      const { project_id } = await createProject();
      setProjectId(project_id);
      setProjectName('Upload Project');
      setProjectFolder(null);
      setUploadedVideos([]);
      resetProjectSession();
    } finally {
      setLoading(false);
    }
  }, [resetProjectSession]);

  const openProjectFolder = useCallback(
    async (folderPath: string) => {
      setLoading(true);
      try {
        const result = await createProjectFromFolder(folderPath);
        setProjectId(result.project_id);
        setProjectName(result.project.name);
        setProjectFolder(result.project_folder);
        setUploadedVideos(result.videos);
        resetProjectSession();
        setRecentProjects(await addRecentProject(result.project_folder, result.project.name));
      } finally {
        setLoading(false);
      }
    },
    [resetProjectSession],
  );

  const removeRecent = useCallback(async (folderPath: string) => {
    setRecentProjects(await removeRecentProject(folderPath));
  }, []);

  const relocateRecent = useCallback(async (folderPath: string) => {
    setRecentProjects(await relocateRecentProject(folderPath));
  }, []);

  const rescanOpenProject = useCallback(async () => {
    if (!projectId || !projectFolder) return;
    setLoading(true);
    try {
      const result = await rescanProject(projectId);
      setProjectName(result.project.name);
      setProjectFolder(result.project_folder);
      setUploadedVideos(result.videos);
      resetProjectSession();
      setRecentProjects(await addRecentProject(result.project_folder, result.project.name));
    } finally {
      setLoading(false);
    }
  }, [projectId, projectFolder, resetProjectSession]);

  const deleteOpenProjectFiles = useCallback(async () => {
    if (!projectId || !projectFolder) return;
    setLoading(true);
    try {
      await deleteProjectFiles(projectId);
      setRecentProjects(await removeRecentProject(projectFolder));
      setProjectId(null);
      setProjectName(null);
      setProjectFolder(null);
      setUploadedVideos([]);
      resetProjectSession();
    } finally {
      setLoading(false);
    }
  }, [projectId, projectFolder, resetProjectSession]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      getClipsWithFallback(projectId),
      getSavedTimeline(projectId).catch(() => null),
    ])
      .then(([loaded, savedTimeline]) => {
        if (!alive) return;
        setClipCandidates(loaded);
        setError(null);
        const newTrims: Record<string, Trim> = {};
        for (const clip of loaded) {
          newTrims[clip.clip_id] = { start_sec: clip.start_sec, end_sec: clip.end_sec };
        }
        if (savedTimeline) {
          // Restore the user's saved review session: accepted clips, their
          // order, and any trims they made before the project was closed.
          const knownIds = new Set(loaded.map((clip) => clip.clip_id));
          const restored = savedTimeline.filter((entry) => knownIds.has(entry.clip_id));
          const newDecisions: Record<string, ClipDecision> = {};
          for (const entry of restored) {
            newDecisions[entry.clip_id] = 'included';
            newTrims[entry.clip_id] = { start_sec: entry.start_sec, end_sec: entry.end_sec };
          }
          setDecisions(newDecisions);
          setAcceptedOrder(restored.map((entry) => entry.clip_id));
        }
        setTrims(newTrims);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : 'Unable to load clip candidates');
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const setClips = useCallback((nextClips: ClipCandidate[]) => {
    setClipCandidates(nextClips);
    setTrims(
      Object.fromEntries(
        nextClips.map((clip) => [
          clip.clip_id,
          { start_sec: clip.start_sec, end_sec: clip.end_sec },
        ]),
      ),
    );
    setDecisions({});
    setAcceptedOrder([]);
    setReviewRevision(0);
  }, []);

  const restoreTimelineEntries = useCallback((entries: Array<{ clip_id: string; start_sec: number; end_sec: number }>) => {
    setAcceptedOrder(entries.map((entry) => entry.clip_id));
    setDecisions(Object.fromEntries(entries.map((entry) => [entry.clip_id, 'included' as const])));
    setTrims((current) => ({
      ...current,
      ...Object.fromEntries(
        entries.map((entry) => [
          entry.clip_id,
          { start_sec: entry.start_sec, end_sec: entry.end_sec },
        ]),
      ),
    }));
  }, []);

  const applyAnalysisResult = useCallback((result: AnalysisResult) => {
    setClips(result.clips);
    restoreTimelineEntries(result.sequence.clips);
    setRecommendation(result.recommendation);
  }, [restoreTimelineEntries, setClips]);

  const regenerateDraft = useCallback(async (profile: AssemblyProfile, targetDurationSec: number) => {
    if (!projectId) return;
    const result = await requestDraft(projectId, profile, targetDurationSec);
    restoreTimelineEntries(result.timeline.clips);
    setReviewRevision(0);
  }, [projectId, restoreTimelineEntries]);

  useEffect(() => {
    if (!projectId || reviewRevision === 0) return;
    const timeout = window.setTimeout(() => {
      updateTimeline(projectId, { order: acceptedOrder, trims })
        .then((result) => {
          if (!result.ok) setError('Unable to auto-save Timeline changes');
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'Unable to auto-save Timeline changes');
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [projectId, acceptedOrder, trims, reviewRevision]);

  const include = useCallback((clipId: string) => {
    setDecisions((prev) => ({ ...prev, [clipId]: 'included' }));
    setAcceptedOrder((prev) => (prev.includes(clipId) ? prev : [...prev, clipId]));
    setReviewRevision((revision) => revision + 1);
  }, []);

  const exclude = useCallback((clipId: string) => {
    setDecisions((prev) => ({ ...prev, [clipId]: 'excluded' }));
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
    setReviewRevision((revision) => revision + 1);
  }, []);

  const resetDecision = useCallback((clipId: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
    setReviewRevision((revision) => revision + 1);
  }, []);

  const moveAccepted = useCallback((clipId: string, direction: -1 | 1) => {
    setAcceptedOrder((prev) => {
      const idx = prev.indexOf(clipId);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      setReviewRevision((revision) => revision + 1);
      return next;
    });
  }, []);

  const reorderAccepted = useCallback((clipId: string, toIndex: number) => {
    setAcceptedOrder((prev) => {
      const from = prev.indexOf(clipId);
      if (from < 0) return prev;
      const without = prev.slice();
      without.splice(from, 1);
      const target = Math.max(0, Math.min(toIndex, without.length));
      without.splice(target, 0, clipId);
      setReviewRevision((revision) => revision + 1);
      return without;
    });
  }, []);

  const setTrim = useCallback((clipId: string, trim: Trim) => {
    setTrims((prev) => ({ ...prev, [clipId]: trim }));
    setReviewRevision((revision) => revision + 1);
  }, []);

  const value = useMemo<ReviewState>(
    () => ({
      projectId,
      projectName,
      projectFolder,
      recentProjects,
      uploadedVideos,
      analysisStatus,
      loading,
      error,
      clips,
      decisions,
      acceptedOrder,
      trims,
      smoothnessThreshold,
      setSmoothnessThreshold,
      include,
      exclude,
      resetDecision,
      moveAccepted,
      reorderAccepted,
      setTrim,
      setProjectId,
      setUploadedVideos,
      setAnalysisStatus,
      applyAnalysisResult,
      recommendation,
      regenerateDraft,
      createUploadProject,
      openProjectFolder,
      refreshRecentProjects,
      removeRecent,
      relocateRecent,
      rescanOpenProject,
      deleteOpenProjectFiles,
      acceptedCount: acceptedOrder.length,
      totalCount: clips.length,
    }),
    [
      projectId,
      projectName,
      projectFolder,
      recentProjects,
      uploadedVideos,
      analysisStatus,
      loading,
      error,
      clips,
      decisions,
      acceptedOrder,
      trims,
      smoothnessThreshold,
      include,
      exclude,
      resetDecision,
      moveAccepted,
      reorderAccepted,
      setTrim,
      applyAnalysisResult,
      recommendation,
      regenerateDraft,
      createUploadProject,
      openProjectFolder,
      refreshRecentProjects,
      removeRecent,
      relocateRecent,
      rescanOpenProject,
      deleteOpenProjectFiles,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview(): ReviewState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReview must be used within ReviewProvider');
  return ctx;
}
