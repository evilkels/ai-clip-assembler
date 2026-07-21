import { useMemo, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type { ClipCandidate, ClipDecision, ClipGenerationStats } from '../types/clip';
import { ClipCard } from './ClipCard';

interface LookGroup {
  key: string;
  lead: ClipCandidate;
  /** Other clips sharing this look group; empty when the clip has no group
   *  (or is its group's only member) so it renders exactly like a flat list. */
  siblings: ClipCandidate[];
}

/** Groups clips sharing a `look_group`, leading each group with the
 *  highest-scored member (the input is already sorted by score, so the first
 *  clip seen per group is the lead). Clips without a `look_group` — or the
 *  only member of one — get a group of size 1 and render with no extra
 *  chrome, matching today's flat list when nothing actually groups. */
function groupByLook(clips: ClipCandidate[]): LookGroup[] {
  const membersByKey = new Map<string, ClipCandidate[]>();
  const order: string[] = [];
  for (const clip of clips) {
    const key = clip.look_group != null ? `look-${clip.look_group}` : `solo-${clip.clip_id}`;
    const members = membersByKey.get(key);
    if (members) {
      members.push(clip);
    } else {
      membersByKey.set(key, [clip]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = membersByKey.get(key)!;
    return { key, lead: members[0], siblings: members.slice(1) };
  });
}

interface SourceClipsPanelProps {
  clips: ClipCandidate[];
  totalCount: number;
  projectId: string | null;
  decisions: Record<string, ClipDecision>;
  draftPositions: Map<string, number>;
  clipsByFile: Map<string, ClipCandidate[]>;
  versionMembership: Map<string, string[]>;
  generationStats: ClipGenerationStats | null;
  loading: boolean;
  error: string | null;
  smoothnessThreshold: number;
  onInclude: (clipId: string) => void;
  onExclude: (clipId: string) => void;
}

export function SourceClipsPanel({
  clips,
  totalCount,
  projectId,
  decisions,
  draftPositions,
  clipsByFile,
  versionMembership,
  generationStats,
  loading,
  error,
  smoothnessThreshold,
  onInclude,
  onExclude,
}: SourceClipsPanelProps) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const totals = generationStats?.totals;
  const rankByClipId = useMemo(
    () => new Map(clips.map((clip, index) => [clip.clip_id, index + 1])),
    [clips],
  );
  const groups = useMemo(() => groupByLook(clips), [clips]);
  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <details
      className="source-clips-panel"
      data-testid="source-clips-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      >
      <summary>
        <strong>{open ? 'Hide' : 'Browse'} your clips ({totalCount})</strong>
        <span className="draft-summary">
          {totals
            ? `Generated ${totals.candidates_generated} → kept ${totals.candidates_kept} · scene cap on ${totals.scenes_at_cap}/${totals.scenes_total} scenes · video cap ${totals.max_candidates_per_video ?? '—'}`
            : `${clips.length} shown · click to preview and pick clips`}
        </span>
      </summary>
      {/* Closed details still mount children, so conditionally render to avoid N video streams. */}
      {open ? (
        <div className="source-clips-content">
          <p className="review-pipeline-helper">
            Every usable clip found in your footage. Preview each one and “Add to working timeline”
            to build your own edit. Removing a clip also keeps it out of the AI’s suggested cuts.
          </p>
          {totalCount > 0 ? (
            <details className="score-legend">
              <summary>How clips are scored</summary>
              <div className="score-legend-body">
                <p>
                  Combined scores blend technical quality with visual interest. Strong clips score
                  at least 8, usable clips score 5–8, and weak clips score below 5.
                </p>
              </div>
            </details>
          ) : null}
          {loading ? (
            <div className="empty-state">Loading candidates…</div>
          ) : error ? (
            <div className="empty-state">{error}</div>
          ) : clips.length === 0 ? (
            <div className="empty-state">
              No clips above display filter {smoothnessThreshold}. Lower the filter to see more.
            </div>
          ) : (
            <div className="review-grid">
              {groups.flatMap(({ key, lead, siblings: lookSiblings }) => {
                const renderClip = (clip: ClipCandidate, similarLookCount: number) => {
                  const decision = decisions[clip.clip_id] ?? 'pending';
                  const fileSiblings = clipsByFile.get(clip.file_id) ?? [];
                  const siblingRanges: Array<{ start: number; end: number }> = [];
                  for (const candidate of fileSiblings) {
                    if (candidate.clip_id !== clip.clip_id) {
                      siblingRanges.push({
                        start: candidate.start_sec,
                        end: candidate.end_sec,
                      });
                    }
                  }
                  return (
                    <ClipCard
                      key={clip.clip_id}
                      clip={clip}
                      rank={rankByClipId.get(clip.clip_id) ?? 0}
                      decision={decision}
                      draftPosition={draftPositions.get(clip.clip_id)}
                      versionLabels={versionMembership.get(clip.clip_id)}
                      siblingRanges={siblingRanges}
                      fileClipIndex={
                        // ES2022 target: toSorted() unavailable; spread keeps siblings immutable.
                        // react-doctor-disable-next-line react-doctor/js-tosorted-immutable
                        [...fileSiblings]
                          .sort((a, b) => a.start_sec - b.start_sec)
                          .findIndex((candidate) => candidate.clip_id === clip.clip_id) + 1
                      }
                      fileClipCount={fileSiblings.length}
                      similarLookCount={similarLookCount}
                      similarLooksExpanded={expandedGroups.has(key)}
                      onToggleSimilarLooks={() => toggleGroup(key)}
                      mediaUrl={
                        projectId ? buildVideoMediaUrl(projectId, clip.file_id) : undefined
                      }
                      onToggleInclude={() =>
                        draftPositions.has(clip.clip_id)
                          ? onExclude(clip.clip_id)
                          : onInclude(clip.clip_id)
                      }
                    />
                  );
                };
                const cards = [renderClip(lead, lookSiblings.length)];
                if (lookSiblings.length > 0 && expandedGroups.has(key)) {
                  cards.push(...lookSiblings.map((sibling) => renderClip(sibling, 0)));
                }
                return cards;
              })}
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}
