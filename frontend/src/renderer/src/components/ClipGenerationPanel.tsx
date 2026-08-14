import { useEffect, useMemo, useState } from 'react';
import type { ClipGenerationPreferences, ClipGenerationStats } from '../types/clip';

const DEFAULT_PREFERENCES: ClipGenerationPreferences = {
  min_clip_duration_sec: 3,
  max_clip_duration_sec: 10,
  smoothness_threshold: 6,
  target_duration_sec: 120,
  max_turn_rate_deg_per_sec: 16,
  max_clips_per_scene: 4,
  max_candidates_per_video: 30,
};

interface Props {
  stats: ClipGenerationStats | null;
  preferences?: ClipGenerationPreferences;
  onPreferencesChange?: (preferences: ClipGenerationPreferences) => void;
  disabled?: boolean;
}

function preferenceValue(
  stats: ClipGenerationStats | null,
  key: keyof ClipGenerationPreferences,
): number {
  const value = stats?.preferences?.[key];
  return typeof value === 'number' ? value : DEFAULT_PREFERENCES[key];
}

export function preferencesFromGenerationStats(
  stats: ClipGenerationStats | null,
): ClipGenerationPreferences {
  return {
    min_clip_duration_sec: preferenceValue(stats, 'min_clip_duration_sec'),
    max_clip_duration_sec: preferenceValue(stats, 'max_clip_duration_sec'),
    smoothness_threshold: preferenceValue(stats, 'smoothness_threshold'),
    target_duration_sec: preferenceValue(stats, 'target_duration_sec'),
    max_turn_rate_deg_per_sec: preferenceValue(stats, 'max_turn_rate_deg_per_sec'),
    max_clips_per_scene: preferenceValue(stats, 'max_clips_per_scene'),
    max_candidates_per_video: preferenceValue(stats, 'max_candidates_per_video'),
  };
}

export function ClipGenerationPanel({
  stats,
  preferences,
  onPreferencesChange,
  disabled = false,
}: Props) {
  const effective = useMemo<ClipGenerationPreferences>(
    () => preferencesFromGenerationStats(stats),
    [stats],
  );
  const [draft, setDraft] = useState<ClipGenerationPreferences>(effective);
  const current = preferences ?? draft;
  const invalidDurationRange = current.max_clip_duration_sec < current.min_clip_duration_sec;

  useEffect(() => setDraft(effective), [effective]);

  const update = (key: keyof ClipGenerationPreferences, value: number) => {
    const next = { ...current, [key]: value };
    if (onPreferencesChange) onPreferencesChange(next);
    else setDraft(next);
  };

  return (
    <section className="clip-generation-panel">
      <header className="clip-generation-header">
        <strong>Advanced: how clips are found</strong>
        <span className="draft-summary">
          Change what counts as a usable clip, then re-scan — no re-import needed
        </span>
      </header>
      <div className="clip-generation-body">
        <p className="clip-generation-intro">
          These control how your footage is cut into the clips above — clip length limits, how
          steady a shot must be, and how many clips to keep per scene and per video. The defaults
          suit most drone footage; adjust only if you want more, fewer, or longer clips.
        </p>
        <div className="clip-generation-rules">
          <div className="clip-generation-rule">
            <strong>Clip length</strong>
            <label>
              Shortest clip (s)
              <span className="clip-generation-help">Discard usable moments shorter than this.</span>
              <input aria-label="Shortest clip (s)" type="number" min={0.5} step={0.5} disabled={disabled} value={current.min_clip_duration_sec} onChange={(event) => update('min_clip_duration_sec', Number(event.target.value))} />
            </label>
            <label>
              Longest clip (s)
              <span className="clip-generation-help">Split longer usable moments into shorter clips.</span>
              <input aria-label="Longest clip (s)" type="number" min={1} step={0.5} disabled={disabled} value={current.max_clip_duration_sec} onChange={(event) => update('max_clip_duration_sec', Number(event.target.value))} />
            </label>
          </div>
          <div className="clip-generation-rule">
            <strong>Camera quality</strong>
            <label>
              How steady (0–10)
              <span className="clip-generation-help">Keep footage at or above this Smoothness Score.</span>
              <input aria-label="How steady (0–10)" type="number" min={0} max={10} step={0.5} disabled={disabled} value={current.smoothness_threshold} onChange={(event) => update('smoothness_threshold', Number(event.target.value))} />
            </label>
            <label>
              Max camera turn (°/s)
              <span className="clip-generation-help">Reject moments where the camera turns faster.</span>
              <input aria-label="Max camera turn (°/s)" type="number" min={0} step={1} disabled={disabled} value={current.max_turn_rate_deg_per_sec} onChange={(event) => update('max_turn_rate_deg_per_sec', Number(event.target.value))} />
            </label>
          </div>
          <div className="clip-generation-rule">
            <strong>Candidate limits</strong>
            <label>
              Max clips per scene
              <span className="clip-generation-help">Limit how many Candidate Clips one Scene can keep.</span>
              <input aria-label="Max clips per scene" type="number" min={1} step={1} disabled={disabled} value={current.max_clips_per_scene} onChange={(event) => update('max_clips_per_scene', Number(event.target.value))} />
            </label>
            <label>
              Max clips per video
              <span className="clip-generation-help">Limit how many Candidate Clips one Source Video can keep.</span>
              <input aria-label="Max clips per video" type="number" min={1} step={1} disabled={disabled} value={current.max_candidates_per_video} onChange={(event) => update('max_candidates_per_video', Number(event.target.value))} />
            </label>
          </div>
        </div>
        {invalidDurationRange ? (
          <span className="clip-generation-warning">
            Longest clip must be at least the shortest clip.
          </span>
        ) : null}
      </div>
    </section>
  );
}
