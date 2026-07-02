import { useEffect, useMemo, useState } from 'react';
import type {
  ClipGenerationPreferenceUpdate,
  ClipGenerationPreferences,
  ClipGenerationStats,
} from '../types/clip';

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
  disabled?: boolean;
  onRegenerate: (preferences: ClipGenerationPreferenceUpdate) => Promise<void>;
}

function preferenceValue(
  stats: ClipGenerationStats | null,
  key: keyof ClipGenerationPreferences,
): number {
  const value = stats?.preferences?.[key];
  return typeof value === 'number' ? value : DEFAULT_PREFERENCES[key];
}

export function ClipGenerationPanel({ stats, disabled = false, onRegenerate }: Props) {
  const effective = useMemo<ClipGenerationPreferences>(
    () => ({
      min_clip_duration_sec: preferenceValue(stats, 'min_clip_duration_sec'),
      max_clip_duration_sec: preferenceValue(stats, 'max_clip_duration_sec'),
      smoothness_threshold: preferenceValue(stats, 'smoothness_threshold'),
      target_duration_sec: preferenceValue(stats, 'target_duration_sec'),
      max_turn_rate_deg_per_sec: preferenceValue(stats, 'max_turn_rate_deg_per_sec'),
      max_clips_per_scene: preferenceValue(stats, 'max_clips_per_scene'),
      max_candidates_per_video: preferenceValue(stats, 'max_candidates_per_video'),
    }),
    [stats],
  );
  const [draft, setDraft] = useState<ClipGenerationPreferences>(effective);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(effective), [effective]);

  const update = (key: keyof ClipGenerationPreferences, value: number) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const regenerate = async () => {
    const confirmed = window.confirm(
      'Regenerating clips resets manual include/exclude choices, order, trims, and the working timeline.',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await onRegenerate(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="clip-generation-panel">
      <summary>
        <strong>Clip generation</strong>
        <span className="draft-summary">Adjust source clip creation without rerunning FFmpeg</span>
      </summary>
      <div className="clip-generation-body">
        <div className="clip-generation-controls">
          <label>
            Min duration
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={draft.min_clip_duration_sec}
              onChange={(event) => update('min_clip_duration_sec', Number(event.target.value))}
            />
          </label>
          <label>
            Max duration
            <input
              type="number"
              min={1}
              step={0.5}
              value={draft.max_clip_duration_sec}
              onChange={(event) => update('max_clip_duration_sec', Number(event.target.value))}
            />
          </label>
          <label>
            Smoothness used to generate clips
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={draft.smoothness_threshold}
              onChange={(event) => update('smoothness_threshold', Number(event.target.value))}
            />
          </label>
          <label>
            Max turn rate
            <input
              type="number"
              min={0}
              step={1}
              value={draft.max_turn_rate_deg_per_sec}
              onChange={(event) => update('max_turn_rate_deg_per_sec', Number(event.target.value))}
            />
          </label>
          <label>
            Clips per scene
            <input
              type="number"
              min={1}
              step={1}
              value={draft.max_clips_per_scene}
              onChange={(event) => update('max_clips_per_scene', Number(event.target.value))}
            />
          </label>
          <label>
            Clips per video
            <input
              type="number"
              min={1}
              step={1}
              value={draft.max_candidates_per_video}
              onChange={(event) => update('max_candidates_per_video', Number(event.target.value))}
            />
          </label>
        </div>
        <div className="clip-generation-footer">
          <span className="clip-generation-warning">
            Regenerating resets manual decisions and the working timeline.
          </span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void regenerate()}
            disabled={disabled || busy}
          >
            {busy ? 'Regenerating…' : 'Regenerate clips'}
          </button>
        </div>
      </div>
    </details>
  );
}
