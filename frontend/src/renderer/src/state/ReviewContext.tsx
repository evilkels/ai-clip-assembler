import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
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
  profile: AssemblyProfile;
  setProfile: (profile: AssemblyProfile) => void;
  targetDuration: number;
  setTargetDuration: (seconds: number) => void;
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

type Setter<T> = Dispatch<SetStateAction<T>>;

function useProjectHydration(
  projectId: string | null,
  setLoading: Setter<boolean>,
  setClipCandidates: Setter<ClipCandidate[]>,
  setError: Setter<string | null>,
  setDecisions: Setter<Record<string, ClipDecision>>,
  setAcceptedOrder: Setter<string[]>,
  setTrims: Setter<Record<string, Trim>>,
  setProfile: Setter<AssemblyProfile>,
  setTargetDuration: Setter<number>,
) {
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
        const newTrims: Record<string, Trim> = Object.fromEntries(
          loaded.map((clip) => [
            clip.clip_id,
            { start_sec: clip.start_sec, end_sec: clip.end_sec },
          ]),
        );
        if (savedTimeline) {
          const knownIds = new Set(loaded.map((clip) => clip.clip_id));
          const restored = savedTimeline.clips
            .map((entry) =>
              typeof entry === 'string'
                ? loaded.find((clip) => clip.clip_id === entry)
                : entry,
            )
            .filter((entry): entry is { clip_id: string; start_sec: number; end_sec: number } =>
              Boolean(entry && knownIds.has(entry.clip_id)),
            );
          setDecisions({
            ...Object.fromEntries(restored.map((entry) => [entry.clip_id, 'included' as const])),
            ...savedTimeline.decisions,
          });
          setAcceptedOrder(restored.map((entry) => entry.clip_id));
          for (const entry of restored) {
            newTrims[entry.clip_id] = { start_sec: entry.start_sec, end_sec: entry.end_sec };
          }
          if (savedTimeline.profile) setProfile(savedTimeline.profile);
          if (savedTimeline.targetDurationSec) setTargetDuration(savedTimeline.targetDurationSec);
        }
        setTrims(newTrims);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'Unable to load clip candidates');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, setAcceptedOrder, setClipCandidates, setDecisions, setError, setLoading, setProfile, setTargetDuration, setTrims]);
}

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
  const [profile, setProfile] = useState<AssemblyProfile>('cinematic_highlight');
  const [targetDuration, setTargetDuration] = useState(120);
  const hasReviewEdits = useRef(false);
  const [recommendation, setRecommendation] = useState<AssemblyRecommendation | null>(null);

  useProjectHydration(
    projectId,
    setLoading,
    setClipCandidates,
    setError,
    setDecisions,
    setAcceptedOrder,
    setTrims,
    setProfile,
    setTargetDuration,
  );

  const resetProjectSession = useCallback(() => {
    setClipCandidates([]);
    setDecisions({});
    setAcceptedOrder([]);
    setTrims({});
    setAnalysisStatus({ phase: 'idle' });
    setError(null);
    hasReviewEdits.current = false;
    setRecommendation(null);
    setProfile('cinematic_highlight');
    setTargetDuration(120);
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
    hasReviewEdits.current = false;
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
    setProfile(result.recommendation.profile);
    setTargetDuration(result.recommendation.target_duration_sec);
  }, [restoreTimelineEntries, setClips]);

  const regenerateDraft = useCallback(async (profile: AssemblyProfile, targetDurationSec: number) => {
    if (!projectId) return;
    const result = await requestDraft(projectId, profile, targetDurationSec);
    restoreTimelineEntries(result.timeline.clips);
    setProfile(profile);
    setTargetDuration(targetDurationSec);
    hasReviewEdits.current = false;
  }, [projectId, restoreTimelineEntries]);

  useEffect(() => {
    if (!projectId || !hasReviewEdits.current) return;
    const timeout = window.setTimeout(() => {
      updateTimeline(projectId, {
        order: acceptedOrder,
        trims,
        decisions: Object.fromEntries(
          Object.entries(decisions).filter((entry): entry is [string, 'included' | 'excluded'] =>
            entry[1] !== 'pending',
          ),
        ),
        profile,
        targetDurationSec: targetDuration,
      })
        .then((result) => {
          if (!result.ok) setError('Unable to auto-save Timeline changes');
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : 'Unable to auto-save Timeline changes');
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [projectId, acceptedOrder, trims, decisions, profile, targetDuration]);

  const include = useCallback((clipId: string) => {
    hasReviewEdits.current = true;
    setDecisions((prev) => ({ ...prev, [clipId]: 'included' }));
    setAcceptedOrder((prev) => (prev.includes(clipId) ? prev : [...prev, clipId]));
  }, []);

  const exclude = useCallback((clipId: string) => {
    hasReviewEdits.current = true;
    setDecisions((prev) => ({ ...prev, [clipId]: 'excluded' }));
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
  }, []);

  const resetDecision = useCallback((clipId: string) => {
    hasReviewEdits.current = true;
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
  }, []);

  const moveAccepted = useCallback((clipId: string, direction: -1 | 1) => {
    hasReviewEdits.current = true;
    setAcceptedOrder((prev) => {
      const idx = prev.indexOf(clipId);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const reorderAccepted = useCallback((clipId: string, toIndex: number) => {
    hasReviewEdits.current = true;
    setAcceptedOrder((prev) => {
      const from = prev.indexOf(clipId);
      if (from < 0) return prev;
      const without = prev.slice();
      without.splice(from, 1);
      const target = Math.max(0, Math.min(toIndex, without.length));
      without.splice(target, 0, clipId);
      return without;
    });
  }, []);

  const setTrim = useCallback((clipId: string, trim: Trim) => {
    hasReviewEdits.current = true;
    setTrims((prev) => ({ ...prev, [clipId]: trim }));
  }, []);

  const selectProfile = useCallback((nextProfile: AssemblyProfile) => {
    hasReviewEdits.current = true;
    setProfile(nextProfile);
  }, []);

  const selectTargetDuration = useCallback((seconds: number) => {
    hasReviewEdits.current = true;
    setTargetDuration(seconds);
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
      profile,
      setProfile: selectProfile,
      targetDuration,
      setTargetDuration: selectTargetDuration,
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
      profile,
      targetDuration,
      selectProfile,
      selectTargetDuration,
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
