import { useEffect, useMemo, useState } from 'react';
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
    sortAcceptedChronologically,
    recommendation,
    regenerateDraft,
  } = useReview();
  const [generatingDraft, setGeneratingDraft] = useState(false);
  // Free-text buffer for the target-seconds field. Clamping on every keystroke
  // corrupts multi-digit entry (typing "45" snapped to "55"), so we only parse
  // and clamp on blur / before regenerating.
  const [secondsInput, setSecondsInput] = useState(String(targetDuration));
  useEffect(() => {
    setSecondsInput(String(targetDuration));
  }, [targetDuration]);

  const commitSeconds = (): number => {
    const parsed = Math.round(Number(secondsInput));
    const next = Number.isFinite(parsed) && parsed >= 5 ? parsed : 5;
    setTargetDuration(next);
    setSecondsInput(String(next));
    return next;
  };

  const ranked = useMemo(() => rankClips(clips), [clips]);
  const filtered = useMemo(
    () => ranked.filter((c) => c.scores.smoothness >= smoothnessThreshold),
    [ranked, smoothnessThreshold],
  );

  const draftPositions = useMemo(
    () => new Map(acceptedOrder.map((id, index) => [id, index + 1])),
    [acceptedOrder],
  );

  // Group candidates by source file so each card can show its siblings on the
  // file track ("this is candidate 2 of 3 from this clip").
  const clipsByFile = useMemo(() => {
    const map = new Map<string, ClipCandidate[]>();
    for (const clip of clips) {
      const list = map.get(clip.file_id) ?? [];
      list.push(clip);
      map.set(clip.file_id, list);
    }
    return map;
  }, [clips]);

  const acceptedClips = useMemo(
    () => {
      const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));
      return acceptedOrder
        .map((id) => clipsById.get(id))
        .filter((c): c is ClipCandidate => Boolean(c));
    },
    [acceptedOrder, clips],
  );

  const draftDurationSec = useMemo(
    () =>
      acceptedClips.reduce((sum, clip) => {
        const trim = trims[clip.clip_id];
        const start = trim?.start_sec ?? clip.start_sec;
        const end = trim?.end_sec ?? clip.end_sec;
        return sum + Math.max(0, end - start);
      }, 0),
    [acceptedClips, trims],
  );

  // Flag a draft that falls well short of the requested target so the user
  // understands the seconds field worked but there wasn't enough usable footage.
  const targetShortfall =
    acceptedClips.length > 0 && draftDurationSec < targetDuration * 0.9;

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
          <details className="score-legend">
            <summary>How clips are scored</summary>
            <div className="score-legend-body">
              <p>
                Every clip gets a <strong>verdict</strong> from its combined score:{' '}
                <span className="clip-verdict green">Strong</span> (≥8),{' '}
                <span className="clip-verdict yellow">Usable</span> (5–8),{' '}
                <span className="clip-verdict red">Weak</span> (&lt;5). The combined score blends
                technical quality (smoothness, sharpness, exposure, contrast) with AI-judged visual
                interest. The <strong>Why</strong> line on each card is written by the local vision
                model. Generating a draft re-picks and re-orders clips for your profile and target —
                cards already in the timeline are tagged <em>◆ Timeline #n</em>.
              </p>
            </div>
          </details>
        )}
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
                value={secondsInput}
                onChange={(event) => setSecondsInput(event.target.value)}
                onBlur={commitSeconds}
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
                const seconds = commitSeconds();
                setGeneratingDraft(true);
                try {
                  await regenerateDraft(profile, seconds);
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
            <div className="accepted-strip-head">
              <h2>Timeline — sent to export</h2>
              <div className="accepted-strip-tools">
                <button
                  type="button"
                  className="btn subtle"
                  onClick={sortAcceptedChronologically}
                  title="Reorder the timeline by source capture time"
                >
                  Sort chronologically
                </button>
                <span className="draft-summary">
                  {acceptedClips.length} clip{acceptedClips.length === 1 ? '' : 's'} ·{' '}
                  {draftDurationSec.toFixed(0)}s / {targetDuration}s target
                </span>
              </div>
            </div>
            {targetShortfall && (
              <p className="draft-warning">
                Draft is {draftDurationSec.toFixed(0)}s — short of the {targetDuration}s target.
                Not enough footage clears the smoothness filter. Lower the threshold or the target
                to fit more.
              </p>
            )}
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
                  draftPosition={draftPositions.get(clip.clip_id)}
                  siblingRanges={(clipsByFile.get(clip.file_id) ?? [])
                    .filter((c) => c.clip_id !== clip.clip_id)
                    .map((c) => ({ start: c.start_sec, end: c.end_sec }))}
                  fileClipIndex={
                    [...(clipsByFile.get(clip.file_id) ?? [])]
                      .sort((a, b) => a.start_sec - b.start_sec)
                      .findIndex((c) => c.clip_id === clip.clip_id) + 1
                  }
                  fileClipCount={(clipsByFile.get(clip.file_id) ?? []).length}
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
