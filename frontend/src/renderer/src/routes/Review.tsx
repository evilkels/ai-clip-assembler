import { useMemo, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import { ClipCard } from '../components/ClipCard';
import { useReview } from '../state/ReviewContext';
import type { ClipCandidate } from '../types/clip';
import type { AssemblyProfile } from '../types/clip';

const PROFILE_LABELS: Record<AssemblyProfile, string> = {
  short_social: 'Short Social',
  cinematic_highlight: 'Cinematic Highlight',
  long_scenic: 'Long Scenic',
  custom: 'Custom',
};

function rankClips(clips: ClipCandidate[]): ClipCandidate[] {
  return [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
}

function TrimEditor({
  start,
  end,
  minStart,
  maxEnd,
  onChange,
}: {
  start: number;
  end: number;
  minStart: number;
  maxEnd: number;
  onChange: (start: number, end: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        fontSize: 11,
        padding: '4px 0',
      }}
    >
      <label style={{ color: 'var(--text-muted)' }}>Trim</label>
      <input
        type="number"
        min={minStart}
        max={end - 0.1}
        step={0.1}
        value={start}
        style={{ width: 60 }}
        onChange={(e) => {
          const s = Number(e.target.value);
          if (s < minStart || s >= end - 0.1) return;
          onChange(s, end);
        }}
      />
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <input
        type="number"
        min={start + 0.1}
        max={maxEnd}
        step={0.1}
        value={end}
        style={{ width: 60 }}
        onChange={(e) => {
          const e2 = Number(e.target.value);
          if (e2 <= start + 0.1 || e2 > maxEnd) return;
          onChange(start, e2);
        }}
      />
      <span style={{ color: 'var(--text-muted)' }}>
        ({(end - start).toFixed(1)}s)
      </span>
    </div>
  );
}

export function ReviewPage() {
  const {
    projectId,
    loading,
    error,
    clips,
    decisions,
    acceptedOrder,
    trims,
    smoothnessThreshold,
    setSmoothnessThreshold,
    profile,
    setProfile,
    targetDuration,
    setTargetDuration,
    include,
    exclude,
    resetDecision,
    moveAccepted,
    setTrim,
    recommendation,
    regenerateDraft,
  } = useReview();
  const [generatingDraft, setGeneratingDraft] = useState(false);

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
          <h1>Review</h1>
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
        {clips.length > 0 && (
          <section className="draft-setup" aria-label="Draft setup">
            <div>
              <span className="draft-kicker">Recommended assembly</span>
              <strong>{PROFILE_LABELS[recommendation?.profile ?? profile]}</strong>
              <p>
                {recommendation?.reason ??
                  'Choose a pacing profile and generate a chronological best-effort draft.'}
              </p>
            </div>
            <label>
              Profile
              <select value={profile} onChange={(event) => setProfile(event.target.value as AssemblyProfile)}>
                {Object.entries(PROFILE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Target seconds
              <input
                type="number"
                min={5}
                step={5}
                value={targetDuration}
                onChange={(event) => setTargetDuration(Math.max(5, Number(event.target.value)))}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={generatingDraft}
              onClick={async () => {
                if (
                  acceptedOrder.length > 0 &&
                  !window.confirm('Replace the current Timeline with a newly generated draft?')
                ) return;
                setGeneratingDraft(true);
                try {
                  await regenerateDraft(profile, targetDuration);
                } finally {
                  setGeneratingDraft(false);
                }
              }}
            >
              {generatingDraft ? 'Generating…' : 'Regenerate Draft'}
            </button>
          </section>
        )}
        {acceptedClips.length > 0 && (
          <div className="accepted-strip">
            <h2>Accepted order — sent to export</h2>
            <div className="accepted-list">
              {acceptedClips.map((clip, idx) => {
                const trim = trims[clip.clip_id];
                const start = trim?.start_sec ?? clip.start_sec;
                const end = trim?.end_sec ?? clip.end_sec;
                return (
                  <div key={clip.clip_id} className="accepted-pill">
                    <span className="pill-rank">#{idx + 1}</span>
                    <span>{clip.file_name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {start.toFixed(1)}s · {(end - start).toFixed(1)}s
                    </span>
                    <TrimEditor
                      start={start}
                      end={end}
                      minStart={clip.start_sec}
                      maxEnd={clip.end_sec}
                      onChange={(s, e) => setTrim(clip.clip_id, { start_sec: s, end_sec: e })}
                    />
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
                );
              })}
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
                  mediaUrl={projectId ? buildVideoMediaUrl(projectId, clip.file_id) : undefined}
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
