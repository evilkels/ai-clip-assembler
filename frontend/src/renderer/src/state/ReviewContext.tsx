import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addRecentProject,
  applyTimelineOp,
  createProject,
  createProjectFromFolder,
  deleteProjectFiles,
  getClipsWithFallback,
  getTimelineDocument,
  listRecentProjects,
  redoTimeline,
  relocateRecentProject,
  removeRecentProject,
  regenerateDraft as requestDraft,
  rescanProject,
  subscribeTimelineEvents,
  undoTimeline,
  type TimelineDocument,
  type TimelineItem,
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
  /** Authoritative timeline items from the backend Timeline Document. */
  timelineItems: TimelineItem[];
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
  sortAcceptedChronologically: () => void;
  setTrim: (clipId: string, trim: Trim) => void;
  /** Drive any operation through the backend operations core (used by the editor). */
  applyTimelineOperation: (operation: string, args: Record<string, unknown>) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
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
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [smoothnessThreshold, setSmoothnessThreshold] = useState(7);
  const [profile, setProfile] = useState<AssemblyProfile>('cinematic_highlight');
  const [targetDuration, setTargetDuration] = useState(120);
  const [recommendation, setRecommendation] = useState<AssemblyRecommendation | null>(null);

  // The latest authoritative document, kept in a ref so operation handlers can
  // map a Candidate Clip to its Timeline Item without re-rendering churn.
  const documentRef = useRef<TimelineDocument | null>(null);

  // Reconcile local review state from the authoritative Timeline Document. The
  // backend document is the source of truth; the GUI mirrors it.
  const reconcileFromDocument = useCallback((document: TimelineDocument) => {
    documentRef.current = document;
    setTimelineItems(document.items);
    const order: string[] = [];
    const seenSourceIds = new Set<string>();
    const itemTrims: Record<string, Trim> = {};
    for (const item of document.items) {
      if (!seenSourceIds.has(item.source_clip_id)) {
        seenSourceIds.add(item.source_clip_id);
        order.push(item.source_clip_id);
      }
      if (!(item.source_clip_id in itemTrims)) {
        itemTrims[item.source_clip_id] = { start_sec: item.start_sec, end_sec: item.end_sec };
      }
    }
    setAcceptedOrder(order);
    setTrims((current) => ({ ...current, ...itemTrims }));
    setDecisions(document.decisions as Record<string, ClipDecision>);
    if (document.profile) setProfile(document.profile);
    if (document.target_duration_sec) setTargetDuration(document.target_duration_sec);
  }, []);

  const itemIdForClip = useCallback((clipId: string): string | undefined => {
    return documentRef.current?.items.find((item) => item.source_clip_id === clipId)?.item_id;
  }, []);

  // Single mutation path: every GUI edit runs through the backend operations
  // core and reconciles from the returned document (the SSE stream reconciles
  // the same way for edits made by agents).
  const applyTimelineOperation = useCallback(
    async (operation: string, args: Record<string, unknown>) => {
      if (!projectId) return;
      try {
        const document = await applyTimelineOp(projectId, operation, args);
        reconcileFromDocument(document);
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : 'Timeline operation failed');
        getTimelineDocument(projectId).then(reconcileFromDocument).catch(() => {});
      }
    },
    [projectId, reconcileFromDocument],
  );

  const refreshTimelineDocument = useCallback(async () => {
    if (!projectId) return;
    try {
      reconcileFromDocument(await getTimelineDocument(projectId));
    } catch {
      /* transient; SSE or the next op will reconcile */
    }
  }, [projectId, reconcileFromDocument]);

  // Hydration: load candidates + the authoritative document for the project.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    Promise.all([getClipsWithFallback(projectId), getTimelineDocument(projectId).catch(() => null)])
      .then(([loaded, document]) => {
        if (!alive) return;
        setClipCandidates(loaded);
        setError(null);
        setTrims(
          Object.fromEntries(
            loaded.map((clip) => [clip.clip_id, { start_sec: clip.start_sec, end_sec: clip.end_sec }]),
          ),
        );
        if (document) reconcileFromDocument(document);
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
  }, [projectId, reconcileFromDocument]);

  // Live-sync: an agent's edit (in-app or external over MCP) emits
  // `timeline-changed`; reconcile from the authoritative document so it appears
  // live in the GUI.
  useEffect(() => {
    if (!projectId) return;
    const unsubscribe = subscribeTimelineEvents(projectId, () => {
      void refreshTimelineDocument();
    });
    return unsubscribe;
  }, [projectId, refreshTimelineDocument]);

  const resetProjectSession = useCallback(() => {
    setClipCandidates([]);
    setDecisions({});
    setAcceptedOrder([]);
    setTrims({});
    setTimelineItems([]);
    documentRef.current = null;
    setAnalysisStatus({ phase: 'idle' });
    setError(null);
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
        nextClips.map((clip) => [clip.clip_id, { start_sec: clip.start_sec, end_sec: clip.end_sec }]),
      ),
    );
    setDecisions({});
    setAcceptedOrder([]);
    setTimelineItems([]);
  }, []);

  const applyAnalysisResult = useCallback(
    (result: AnalysisResult) => {
      // Analysis rebuilt the backend draft; seed the pool, then reconcile from
      // the freshly built Timeline Document.
      setClips(result.clips);
      setRecommendation(result.recommendation);
      setProfile(result.recommendation.profile);
      setTargetDuration(result.recommendation.target_duration_sec);
      void refreshTimelineDocument();
    },
    [refreshTimelineDocument, setClips],
  );

  const regenerateDraft = useCallback(
    async (nextProfile: AssemblyProfile, targetDurationSec: number) => {
      if (!projectId) return;
      await requestDraft(projectId, nextProfile, targetDurationSec);
      setProfile(nextProfile);
      setTargetDuration(targetDurationSec);
      await refreshTimelineDocument();
    },
    [projectId, refreshTimelineDocument],
  );

  const include = useCallback(
    (clipId: string) => {
      setDecisions((prev) => ({ ...prev, [clipId]: 'included' }));
      setAcceptedOrder((prev) => (prev.includes(clipId) ? prev : [...prev, clipId]));
      void applyTimelineOperation('include', { clip_id: clipId });
    },
    [applyTimelineOperation],
  );

  const exclude = useCallback(
    (clipId: string) => {
      setDecisions((prev) => ({ ...prev, [clipId]: 'excluded' }));
      setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
      void applyTimelineOperation('exclude', { clip_id: clipId });
    },
    [applyTimelineOperation],
  );

  const resetDecision = useCallback(
    (clipId: string) => {
      setDecisions((prev) => {
        const next = { ...prev };
        delete next[clipId];
        return next;
      });
      setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
      void applyTimelineOperation('reset_decision', { clip_id: clipId });
    },
    [applyTimelineOperation],
  );

  const reorderAccepted = useCallback(
    (clipId: string, toIndex: number) => {
      setAcceptedOrder((prev) => {
        const from = prev.indexOf(clipId);
        if (from < 0) return prev;
        const without = prev.slice();
        without.splice(from, 1);
        const target = Math.max(0, Math.min(toIndex, without.length));
        without.splice(target, 0, clipId);
        return without;
      });
      const itemId = itemIdForClip(clipId);
      if (itemId) void applyTimelineOperation('reorder', { item_id: itemId, to_index: toIndex });
    },
    [applyTimelineOperation, itemIdForClip],
  );

  const moveAccepted = useCallback(
    (clipId: string, direction: -1 | 1) => {
      const index = acceptedOrder.indexOf(clipId);
      if (index < 0) return;
      const target = index + direction;
      if (target < 0 || target >= acceptedOrder.length) return;
      reorderAccepted(clipId, target);
    },
    [acceptedOrder, reorderAccepted],
  );

  const sortAcceptedChronologically = useCallback(() => {
    const byId = new Map(clips.map((clip) => [clip.clip_id, clip]));
    const captureKey = (id: string): string => {
      const clip = byId.get(id);
      return clip?.source_created_at ?? clip?.file_name ?? '';
    };
    const sorted = [...acceptedOrder].sort((a, b) => {
      const ka = captureKey(a);
      const kb = captureKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return (byId.get(a)?.start_sec ?? 0) - (byId.get(b)?.start_sec ?? 0);
    });
    setAcceptedOrder(sorted);
    void (async () => {
      for (let index = 0; index < sorted.length; index += 1) {
        const itemId = itemIdForClip(sorted[index]);
        if (itemId) await applyTimelineOperation('reorder', { item_id: itemId, to_index: index });
      }
    })();
  }, [acceptedOrder, applyTimelineOperation, clips, itemIdForClip]);

  const setTrim = useCallback(
    (clipId: string, trim: Trim) => {
      setTrims((prev) => ({ ...prev, [clipId]: trim }));
      const itemId = itemIdForClip(clipId);
      if (itemId) {
        void applyTimelineOperation('set_bounds', {
          item_id: itemId,
          start_sec: trim.start_sec,
          end_sec: trim.end_sec,
        });
      }
    },
    [applyTimelineOperation, itemIdForClip],
  );

  const selectProfile = useCallback(
    (nextProfile: AssemblyProfile) => {
      setProfile(nextProfile);
      void applyTimelineOperation('set_profile', { profile: nextProfile });
    },
    [applyTimelineOperation],
  );

  const selectTargetDuration = useCallback(
    (seconds: number) => {
      setTargetDuration(seconds);
      void applyTimelineOperation('set_target_duration', { target_duration_sec: seconds });
    },
    [applyTimelineOperation],
  );

  const undo = useCallback(async () => {
    if (!projectId) return;
    reconcileFromDocument(await undoTimeline(projectId));
  }, [projectId, reconcileFromDocument]);

  const redo = useCallback(async () => {
    if (!projectId) return;
    reconcileFromDocument(await redoTimeline(projectId));
  }, [projectId, reconcileFromDocument]);

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
      timelineItems,
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
      sortAcceptedChronologically,
      setTrim,
      applyTimelineOperation,
      undo,
      redo,
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
      timelineItems,
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
      sortAcceptedChronologically,
      setTrim,
      applyTimelineOperation,
      undo,
      redo,
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
