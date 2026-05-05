import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClipCandidate, ClipDecision } from '../types/clip';
import { getClips } from '../api/client';

interface ReviewState {
  loading: boolean;
  clips: ClipCandidate[];
  decisions: Record<string, ClipDecision>;
  acceptedOrder: string[];
  smoothnessThreshold: number;
  setSmoothnessThreshold: (v: number) => void;
  include: (clipId: string) => void;
  exclude: (clipId: string) => void;
  resetDecision: (clipId: string) => void;
  moveAccepted: (clipId: string, direction: -1 | 1) => void;
  acceptedCount: number;
  totalCount: number;
}

const Ctx = createContext<ReviewState | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, ClipDecision>>({});
  const [acceptedOrder, setAcceptedOrder] = useState<string[]>([]);
  const [smoothnessThreshold, setSmoothnessThreshold] = useState(7);

  useEffect(() => {
    let alive = true;
    getClips({ useMock: true }).then((loaded) => {
      if (!alive) return;
      setClips(loaded);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const value = useMemo<ReviewState>(
    () => ({
      loading,
      clips,
      decisions,
      acceptedOrder,
      smoothnessThreshold,
      setSmoothnessThreshold,
      include,
      exclude,
      resetDecision,
      moveAccepted,
      acceptedCount: acceptedOrder.length,
      totalCount: clips.length,
    }),
    [
      loading,
      clips,
      decisions,
      acceptedOrder,
      smoothnessThreshold,
      include,
      exclude,
      resetDecision,
      moveAccepted,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview(): ReviewState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReview must be used within ReviewProvider');
  return ctx;
}
