import type { ClipCandidate, ClipDecision } from '../types/clip';

export type ReviewViewMode = 'grid' | 'list' | 'filmstrip';

export type ReviewDecisionFilter = 'all' | 'included' | 'excluded' | 'undecided';

export interface ReviewFilters {
  minOverall: number;
  minSmoothness: number;
  decision: ReviewDecisionFilter;
}

export interface ReviewClipRecord {
  clip: ClipCandidate;
  /** Stable rank in the complete score-ordered Candidate Clip collection. */
  rank: number;
  decision: ClipDecision;
  /** 1-based position in the authoritative accepted order. */
  timelinePosition?: number;
  /** Version labels supplied by the current, authoritative VersionSet. */
  versionLabels: string[];
}

type VersionMembership = Map<string, string[]> | ReadonlyMap<string, readonly string[]>;

/**
 * Project ReviewContext state into the records consumed by each browser view.
 *
 * Sorting is intentionally stable and happens before filtering, which keeps a
 * Candidate Clip's rank meaningful when a filter is changed. Decisions,
 * accepted order, and Version membership are read independently: none is
 * inferred from another, because the backend Timeline Document is the source
 * of truth for those identities.
 */
export function buildReviewClipRecords(
  clips: readonly ClipCandidate[],
  decisions: Readonly<Record<string, ClipDecision>>,
  acceptedOrder: readonly string[],
  versionMembership: VersionMembership,
  filters: ReviewFilters,
): ReviewClipRecord[] {
  const acceptedPositions = new Map<string, number>();
  acceptedOrder.forEach((clipId, index) => {
    if (!acceptedPositions.has(clipId)) acceptedPositions.set(clipId, index + 1);
  });

  const sorted = clips
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => b.clip.scores.overall - a.clip.scores.overall || a.index - b.index);

  return sorted
    .map(({ clip }, index) => {
      const decision = decisions[clip.clip_id] ?? 'pending';
      const labels = versionMembership.get(clip.clip_id) ?? [];
      return {
        clip,
        rank: index + 1,
        decision,
        timelinePosition: acceptedPositions.get(clip.clip_id),
        versionLabels: [...labels],
      };
    })
    .filter(({ clip, decision }) => {
      if (clip.scores.overall < filters.minOverall) return false;
      if (clip.scores.smoothness < filters.minSmoothness) return false;
      if (filters.decision === 'included' && decision !== 'included') return false;
      if (filters.decision === 'excluded' && decision !== 'excluded') return false;
      if (filters.decision === 'undecided' && decision !== 'pending') return false;
      return true;
    });
}

/** A deterministic accent token for a source file, shared by all projections. */
export function reviewFileAccent(fileId: string): string {
  let hash = 0;
  for (let index = 0; index < fileId.length; index += 1) {
    hash = (hash * 31 + fileId.charCodeAt(index)) % 360;
  }
  return `hsl(${hash}, 70%, 62%)`;
}
