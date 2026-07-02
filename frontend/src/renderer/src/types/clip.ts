/**
 * Clip and project types — frontend mirror of backend shapes.
 */

export interface ClipScores {
  smoothness: number;
  sharpness?: number;
  exposure?: number;
  contrast?: number;
  visualInterest?: number;
  overall: number;
}

export interface ClipCandidate {
  clip_id: string;
  file_id: string;
  file_name: string;
  scene_id?: number;
  start_sec: number;
  end_sec: number;
  scores: ClipScores;
  reason: string;
  suggested_speed?: number;
  tags?: string[];
  max_turn_rate_deg_per_sec?: number | null;
  thumbnail_url?: string;
  /** ISO 8601 capture time of the source file (for chronological sorting). */
  source_created_at?: string | null;
  /** Full duration of the source file in seconds (for the per-file track). */
  source_duration_sec?: number | null;
}

export interface VideoMetadata {
  file_id: string;
  file_name: string;
  duration_sec: number;
  fps: number;
  resolution: [number, number];
  display_resolution?: [number, number];
  rotation_degrees?: number;
  codec: string;
  size_bytes?: number;
  created_at?: string;
}

export interface UploadedVideo {
  file_id: string;
  file_name: string;
  status: string;
  metadata?: VideoMetadata;
}

export interface ProjectManifest {
  schema_version: number;
  name: string;
  created_at: string;
  harness: string;
  source_videos: Array<{ filename: string; imported_at: string }>;
  settings_overrides: Record<string, unknown>;
}

export interface RecentProject {
  folderPath: string;
  lastOpenedAt: string;
  name?: string;
  missing?: boolean;
}

export interface AnalysisResult {
  project_id: string;
  harness_id: string;
  status: string;
  clips: ClipCandidate[];
  sequence: DraftTimeline;
  recommendation: AssemblyRecommendation;
  generation_stats?: ClipGenerationStats;
}

export interface ClipGenerationPreferences {
  min_clip_duration_sec: number;
  max_clip_duration_sec: number;
  smoothness_threshold: number;
  target_duration_sec: number;
  max_turn_rate_deg_per_sec: number;
  max_clips_per_scene: number;
  max_candidates_per_video: number;
}

export type ClipGenerationPreferenceUpdate = Partial<ClipGenerationPreferences>;

export interface ClipGenerationFileStats {
  candidates_generated: number;
  candidates_kept: number;
  scenes_total: number;
  scenes_at_cap: number;
  preferences: Partial<ClipGenerationPreferences>;
}

export interface ClipGenerationStats {
  per_file: Record<string, ClipGenerationFileStats>;
  totals: {
    candidates_generated: number;
    candidates_kept: number;
    scenes_total: number;
    scenes_at_cap: number;
    videos: number;
    max_candidates_per_video?: number | null;
  };
  preferences: Partial<ClipGenerationPreferences>;
}

export type AssemblyProfile =
  | 'short_social'
  | 'cinematic_highlight'
  | 'long_scenic'
  | 'custom';

export interface AssemblyRecommendation {
  profile: AssemblyProfile;
  target_duration_sec: number;
  reason: string;
}

export interface DraftTimeline {
  source?: 'draft' | 'manual';
  profile?: AssemblyProfile;
  total_duration_sec: number;
  clips: Array<{
    clip_id: string;
    start_sec: number;
    end_sec: number;
  }>;
}

export interface DraftResult {
  project_id: string;
  profile: AssemblyProfile;
  timeline: DraftTimeline;
}

export interface LegacySequence {
    total_duration_sec: number;
    clips: string[];
}

export interface ProjectClipsResponse {
  clips: ClipCandidate[];
}

export type ClipDecision = 'pending' | 'included' | 'excluded';

export interface Trim {
  start_sec: number;
  end_sec: number;
}

export interface AnalysisStatus {
  phase: 'idle' | 'analyzing' | 'complete' | 'error' | 'cancelled';
  harness_id?: string;
  step?: string;
  video_index?: number;
  video_total?: number;
  file_name?: string | null;
  clip_index?: number;
  clip_total?: number;
  message?: string;
  elapsed_sec?: number;
  started_at?: number;
  updated_at?: number;
  error?: string | null;
}
