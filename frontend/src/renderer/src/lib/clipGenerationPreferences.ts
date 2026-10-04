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
