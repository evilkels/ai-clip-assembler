/**
 * Typed frontend API boundary.
 *
 * All calls go to the FastAPI backend. Mock data is only used as an explicit
 * fallback when no project has been created yet (backend offline on startup).
 */

import type {
  AnalysisResult,
  ClipCandidate,
  ProjectManifest,
  UploadedVideo,
  VideoMetadata,
} from '../types/clip';
import { mockClips } from './mockClips';

declare global {
  interface Window {
    clipAssembler?: {
      backendUrl: string;
      platform: string;
      selectProjectFolder?: () => Promise<string | null>;
      listRecentProjects?: () => Promise<Array<{ folderPath: string; lastOpenedAt: string }>>;
      addRecentProject?: (
        folderPath: string,
      ) => Promise<Array<{ folderPath: string; lastOpenedAt: string }>>;
    };
  }
}

const backendUrl = (): string =>
  window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000';

export interface BackendStatus {
  online: boolean;
  version?: string;
}

export async function pingBackend(): Promise<BackendStatus> {
  try {
    const res = await fetch(`${backendUrl()}/`, { cache: 'no-store' });
    if (!res.ok) return { online: false };
    const data = (await res.json()) as { version?: string };
    return { online: true, version: data.version };
  } catch {
    return { online: false };
  }
}

interface BackendClipSuggestion {
  clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  smoothness_score: number;
  visual_interest_score: number;
  overall_score: number;
  ai_reason: string;
  suggested_speed?: number;
  suggested_transition?: string;
  tags?: string[];
}

export function mapBackendClip(c: BackendClipSuggestion): ClipCandidate {
  return {
    clip_id: c.clip_id,
    file_id: c.file_id,
    file_name: c.file_name,
    start_sec: c.start_sec,
    end_sec: c.end_sec,
    scores: {
      smoothness: c.smoothness_score,
      sharpness: 0,
      exposure: 0,
      contrast: 0,
      overall: c.overall_score,
    },
    reason: c.ai_reason,
  };
}

export async function createProject(): Promise<{ project_id: string }> {
  const res = await fetch(`${backendUrl()}/projects`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  return res.json() as Promise<{ project_id: string }>;
}

export interface FolderProjectResult {
  project_id: string;
  project_folder: string;
  project: ProjectManifest;
  videos: UploadedVideo[];
}

export async function createProjectFromFolder(folderPath: string): Promise<FolderProjectResult> {
  const res = await fetch(`${backendUrl()}/projects/from-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_path: folderPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Failed to open project folder: ${res.status}`);
  }
  return res.json() as Promise<FolderProjectResult>;
}

export async function selectProjectFolder(): Promise<string | null> {
  return window.clipAssembler?.selectProjectFolder?.() ?? null;
}

export async function listRecentProjects(): Promise<Array<{ folderPath: string; lastOpenedAt: string }>> {
  return window.clipAssembler?.listRecentProjects?.() ?? [];
}

export async function addRecentProject(
  folderPath: string,
): Promise<Array<{ folderPath: string; lastOpenedAt: string }>> {
  return window.clipAssembler?.addRecentProject?.(folderPath) ?? [];
}

export async function uploadVideo(
  projectId: string,
  file: File,
): Promise<UploadedVideo> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${backendUrl()}/projects/${projectId}/videos`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Upload failed: ${res.status}`);
  }
  const data = (await res.json()) as { file_id: string; status: string; metadata: VideoMetadata };
  return { ...data, file_name: file.name };
}

export interface AnalyzeOptions {
  harness_id?: string;
  preferences?: Record<string, unknown>;
}

export async function analyzeProject(
  projectId: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const harness_id = options.harness_id ?? 'pi_agent';
  const preferences = options.preferences ?? {};
  const res = await fetch(`${backendUrl()}/projects/${projectId}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, harness_id, preferences }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Analysis failed: ${res.status}`);
  }
  const raw = (await res.json()) as {
    project_id: string;
    harness_id: string;
    status: string;
    clips: BackendClipSuggestion[];
    sequence: { total_duration_sec: number; clips: string[] };
  };
  return {
    project_id: raw.project_id,
    harness_id: raw.harness_id,
    status: raw.status,
    clips: raw.clips.map(mapBackendClip),
    sequence: raw.sequence,
  };
}

export async function getClips(projectId: string): Promise<ClipCandidate[]> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/clips`);
  if (!res.ok) throw new Error(`Failed to load clips: ${res.status}`);
  const data = (await res.json()) as { clips: BackendClipSuggestion[] };
  return data.clips.map(mapBackendClip);
}

export interface ExportResult {
  project_id: string;
  format: string;
  status: string;
  file_path: string;
}

export async function exportTimeline(
  projectId: string,
  format: 'edl' | 'fcpxml',
): Promise<ExportResult> {
  const res = await fetch(
    `${backendUrl()}/projects/${projectId}/export?format=${format}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Export failed: ${res.status}`);
  }
  return res.json() as Promise<ExportResult>;
}

export interface UpdateTimelineOptions {
  order?: string[];
  trims?: Record<string, { start_sec: number; end_sec: number }>;
  clips?: Array<{
    clip_id: string;
    start_sec: number;
    end_sec: number;
    included?: boolean;
  }>;
}

export async function updateTimeline(
  projectId: string,
  options: UpdateTimelineOptions,
): Promise<{ ok: boolean }> {
  const clips =
    options.clips ??
    (options.order ?? []).map((clipId) => {
      const trim = options.trims?.[clipId];
      if (!trim) {
        throw new Error(`Missing trim for accepted clip: ${clipId}`);
      }
      return {
        clip_id: clipId,
        start_sec: trim.start_sec,
        end_sec: trim.end_sec,
        included: true,
      };
    });

  try {
    const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clips }),
    });
    if (!res.ok) {
      if (res.status === 404) return { ok: false };
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? `Timeline sync failed: ${res.status}`);
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message.includes('Timeline sync failed')) {
      throw err;
    }
    return { ok: false };
  }
}

export async function getClipsWithFallback(
  projectId: string | null,
): Promise<ClipCandidate[]> {
  if (!projectId) return mockClips;
  return await getClips(projectId);
}
