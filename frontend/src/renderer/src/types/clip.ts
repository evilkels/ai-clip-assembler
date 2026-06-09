/**
 * Clip and project types — frontend mirror of backend shapes.
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
  codec: string;
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
  sequence: {
    total_duration_sec: number;
    clips: string[];
  };
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
  phase: 'idle' | 'analyzing' | 'complete' | 'error';
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
