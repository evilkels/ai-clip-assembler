/**
 * Clip and project types — frontend mirror of backend shapes.
 *
 * These match issue #5's expected output: rule-based ranked clip candidates
 * with smoothness-focused scores and a human-readable reason. The backend's
 * current `ClipSuggestion` only carries `smoothness_score` / `visual_interest_score`
 * / `overall_score`; we extend with sharpness/exposure/contrast that #5 will add.
 */

export interface ClipScores {
  smoothness: number;
  sharpness: number;
  exposure: number;
  contrast: number;
  overall: number;
}

export interface ClipCandidate {
  clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  scores: ClipScores;
  reason: string;
  thumbnail_url?: string;
}

export interface VideoMetadata {
  file_id: string;
  file_name: string;
  duration_sec: number;
  fps: number;
  resolution: [number, number];
}

export interface ProjectClipsResponse {
  clips: ClipCandidate[];
}

export type ClipDecision = 'pending' | 'included' | 'excluded';
