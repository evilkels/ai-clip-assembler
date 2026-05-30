import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AnalysisStatus,
  ClipCandidate,
  ClipDecision,
  Trim,
  UploadedVideo,
} from '../types/clip';
import { createProject, getClipsWithFallback } from '../api/client';

interface ReviewState {
  projectId: string | null;
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
  setProjectId: (id: string) => void;
  setUploadedVideos: (videos: UploadedVideo[]) => void;
  setAnalysisStatus: (status: AnalysisStatus) => void;
  setClips: (clips: ClipCandidate[]) => void;
  acceptedCount: number;
  totalCount: number;
}

const Ctx = createContext<ReviewState | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [uploadedVideos, setUploadedVideos] = useState<UploadedVideo[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>({ phase: 'idle' });
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ClipDecision>>({});
  const [acceptedOrder, setAcceptedOrder] = useState<string[]>([]);
  const [trims, setTrims] = useState<Record<string, Trim>>({});
  const [smoothnessThreshold, setSmoothnessThreshold] = useState(7);

  useEffect(() => {
    let alive = true;
    createProject()
      .then(({ project_id }) => {
        if (!alive) return;
        setProjectId(project_id);
        setClips([]);
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        getClipsWithFallback(null)
          .then((loaded) => {
            if (!alive) return;
            setClips(loaded);
          })
          .finally(() => {
            if (!alive) return;
            setLoading(false);
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    getClipsWithFallback(projectId)
      .then((loaded) => {
        if (!alive) return;
        setClips(loaded);
        setError(null);
        const newTrims: Record<string, Trim> = {};
        for (const clip of loaded) {
          newTrims[clip.clip_id] = { start_sec: clip.start_sec, end_sec: clip.end_sec };
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

  const include = useCallback((clipId: string) => {
    setDecisions((prev) => ({ ...prev, [clipId]: 'included' }));
    setAcceptedOrder((prev) => (prev.includes(clipId) ? prev : [...prev, clipId]));
  }, []);

  const exclude = useCallback((clipId: string) => {
    setDecisions((prev) => ({ ...prev, [clipId]: 'excluded' }));
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
  }, []);

  const resetDecision = useCallback((clipId: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
    setAcceptedOrder((prev) => prev.filter((id) => id !== clipId));
  }, []);

  const moveAccepted = useCallback((clipId: string, direction: -1 | 1) => {
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
    setTrims((prev) => ({ ...prev, [clipId]: trim }));
  }, []);

  const value = useMemo<ReviewState>(
    () => ({
      projectId,
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
      setClips,
      acceptedCount: acceptedOrder.length,
      totalCount: clips.length,
    }),
    [
      projectId,
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
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview(): ReviewState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReview must be used within ReviewProvider');
  return ctx;
}
