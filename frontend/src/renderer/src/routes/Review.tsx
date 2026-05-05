import { useMemo } from 'react';
import { ClipCard } from '../components/ClipCard';
import { useReview } from '../state/ReviewContext';
import type { ClipCandidate } from '../types/clip';

function rankClips(clips: ClipCandidate[]): ClipCandidate[] {
  return [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
}

export function ReviewPage() {
  const {
    loading,
    error,
    clips,
    decisions,
    acceptedOrder,
    smoothnessThreshold,
    setSmoothnessThreshold,
    include,
    exclude,
    resetDecision,
    moveAccepted,
  } = useReview();

  const ranked = useMemo(() => rankClips(clips), [clips]);
  const filtered = useMemo(
    () => ranked.filter((c) => c.scores.smoothness >= smoothnessThreshold),
    [ranked, smoothnessThreshold],
  );

  const acceptedClips = useMemo(
    () => {
      const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));
      return acceptedOrder
        .map((id) => clipsById.get(id))
        .filter((c): c is ClipCandidate => Boolean(c));
    },
    [acceptedOrder, clips],
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review · Drone candidates</h1>
          <p>
            Ranked by overall score. Filter by smoothness, then include the keepers.
          </p>
        </div>
        <div className="controls">
          <div className="control">
            <label htmlFor="smoothness">Smoothness ≥</label>
            <input
              id="smoothness"
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={smoothnessThreshold}
              onChange={(e) => setSmoothnessThreshold(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={smoothnessThreshold}
              onChange={(e) => setSmoothnessThreshold(Number(e.target.value))}
            />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {filtered.length} / {ranked.length} pass threshold
          </span>
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {acceptedClips.length > 0 && (
          <div className="accepted-strip">
            <h2>Accepted order — sent to export</h2>
            <div className="accepted-list">
              {acceptedClips.map((clip, idx) => (
                <div key={clip.clip_id} className="accepted-pill">
                  <span className="pill-rank">#{idx + 1}</span>
                  <span>{clip.file_name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {clip.start_sec.toFixed(1)}s · {(clip.end_sec - clip.start_sec).toFixed(1)}s
                  </span>
                  <div className="accepted-pill-controls">
                    <button
                      className="btn subtle"
                      onClick={() => moveAccepted(clip.clip_id, -1)}
                      disabled={idx === 0}
                      title="Move earlier"
                    >
                      ←
                    </button>
                    <button
                      className="btn subtle"
                      onClick={() => moveAccepted(clip.clip_id, 1)}
                      disabled={idx === acceptedClips.length - 1}
                      title="Move later"
                    >
                      →
                    </button>
                    <button
                      className="btn subtle"
                      onClick={() => resetDecision(clip.clip_id)}
                      title="Remove from accepted"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="empty-state">Loading candidates…</div>
        ) : error ? (
          <div className="empty-state">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            No candidates above smoothness {smoothnessThreshold}. Lower the threshold to see more.
          </div>
        ) : (
          <div className="review-grid">
            {filtered.map((clip, idx) => {
              const decision = decisions[clip.clip_id] ?? 'pending';
              return (
                <ClipCard
                  key={clip.clip_id}
                  clip={clip}
                  rank={idx + 1}
                  decision={decision}
                  onToggleInclude={() =>
                    decision === 'included' ? resetDecision(clip.clip_id) : include(clip.clip_id)
                  }
                  onExclude={() =>
                    decision === 'excluded' ? resetDecision(clip.clip_id) : exclude(clip.clip_id)
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
