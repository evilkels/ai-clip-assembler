import { useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type { ClipCandidate, ClipDecision } from '../types/clip';
import { ClipCard } from './ClipCard';

interface SourceClipsPanelProps {
  clips: ClipCandidate[];
  totalCount: number;
  projectId: string | null;
  decisions: Record<string, ClipDecision>;
  draftPositions: Map<string, number>;
  clipsByFile: Map<string, ClipCandidate[]>;
  versionMembership: Map<string, string[]>;
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
  loading,
  error,
  smoothnessThreshold,
  onInclude,
  onExclude,
}: SourceClipsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="source-clips-panel"
      data-testid="source-clips-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="review-zone-label">3 · Inspect</span>
        <strong>Source Clips ({clips.length})</strong>
        <span className="draft-summary">Add individual Source Clips to the Working Timeline</span>
      </summary>
      {/* Closed details still mount children, so conditionally render to avoid N video streams. */}
      {open ? (
        <div className="source-clips-content">
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
              No candidates above smoothness {smoothnessThreshold}. Lower the threshold to see more.
            </div>
          ) : (
            <div className="review-grid">
              {clips.map((clip, index) => {
                const decision = decisions[clip.clip_id] ?? 'pending';
                const siblings = clipsByFile.get(clip.file_id) ?? [];
                const siblingRanges: Array<{ start: number; end: number }> = [];
                for (const candidate of siblings) {
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
                    rank={index + 1}
                    decision={decision}
                    draftPosition={draftPositions.get(clip.clip_id)}
                    versionLabels={versionMembership.get(clip.clip_id)}
                    siblingRanges={siblingRanges}
                    fileClipIndex={
                      [...siblings]
                        .sort((a, b) => a.start_sec - b.start_sec)
                        .findIndex((candidate) => candidate.clip_id === clip.clip_id) + 1
                    }
                    fileClipCount={siblings.length}
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
              })}
            </div>
          )}
        </div>
      ) : null}
    </details>
  );
}
