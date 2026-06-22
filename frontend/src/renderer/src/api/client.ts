/**
 * Typed frontend API boundary.
 *
 * All calls go to the FastAPI backend. Mock data is only used as an explicit
 * fallback when no project has been created yet (backend offline on startup).
 */

import type {
  AnalysisResult,
  AnalysisStatus,
  AssemblyProfile,
  ClipCandidate,
  DraftResult,
  ProjectManifest,
  RecentProject,
  UploadedVideo,
  VideoMetadata,
} from '../types/clip';
import { mockClips } from './mockClips';
import type { VersionSet } from '../types/version';

declare global {
  interface Window {
    clipAssembler?: {
      backendUrl: string;
      platform: string;
      selectProjectFolder?: () => Promise<string | null>;
      listRecentProjects?: () => Promise<RecentProject[]>;
      addRecentProject?: (folderPath: string, name?: string) => Promise<RecentProject[]>;
      removeRecentProject?: (folderPath: string) => Promise<RecentProject[]>;
      relocateRecentProject?: (folderPath: string) => Promise<RecentProject[]>;
      setWindowTitle?: (projectName?: string) => Promise<void>;
      openInDaVinci?: (exportPath: string, sourceFolder?: string) => Promise<{ opened: boolean }>;
    };
  }
}

const backendUrl = (): string =>
  window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000';

export function buildVideoMediaUrl(projectId: string, fileId: string): string {
  return `${backendUrl()}/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(fileId)}/media`;
}

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
  scene_id?: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  smoothness_score: number;
  sharpness_score?: number | null;
  exposure_score?: number | null;
  contrast_score?: number | null;
  visual_interest_score: number;
  overall_score: number;
  ai_reason: string;
  suggested_speed?: number;
  suggested_transition?: string;
  tags?: string[];
  source_created_at?: string | null;
  source_duration_sec?: number | null;
}

export function mapBackendClip(c: BackendClipSuggestion): ClipCandidate {
  return {
    clip_id: c.clip_id,
    file_id: c.file_id,
    file_name: c.file_name,
    scene_id: c.scene_id,
    start_sec: c.start_sec,
    end_sec: c.end_sec,
    scores: {
      smoothness: c.smoothness_score,
      sharpness: c.sharpness_score ?? undefined,
      exposure: c.exposure_score ?? undefined,
      contrast: c.contrast_score ?? undefined,
      visualInterest: c.visual_interest_score,
      overall: c.overall_score,
    },
    reason: c.ai_reason,
    suggested_speed: c.suggested_speed,
    source_created_at: c.source_created_at ?? null,
    source_duration_sec: c.source_duration_sec ?? null,
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

export async function listRecentProjects(): Promise<RecentProject[]> {
  return window.clipAssembler?.listRecentProjects?.() ?? [];
}

export async function addRecentProject(
  folderPath: string,
  name?: string,
): Promise<RecentProject[]> {
  return window.clipAssembler?.addRecentProject?.(folderPath, name) ?? [];
}

export async function removeRecentProject(folderPath: string): Promise<RecentProject[]> {
  return window.clipAssembler?.removeRecentProject?.(folderPath) ?? [];
}

export async function relocateRecentProject(folderPath: string): Promise<RecentProject[]> {
  return window.clipAssembler?.relocateRecentProject?.(folderPath) ?? [];
}

export async function setWindowTitle(projectName?: string): Promise<void> {
  await window.clipAssembler?.setWindowTitle?.(projectName);
}

export async function openInDaVinci(exportPath: string, sourceFolder?: string): Promise<boolean> {
  const result = await window.clipAssembler?.openInDaVinci?.(exportPath, sourceFolder);
  return result?.opened ?? false;
}

export async function rescanProject(projectId: string): Promise<FolderProjectResult> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/rescan`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Rescan failed: ${res.status}`);
  }
  return res.json() as Promise<FolderProjectResult>;
}

export async function deleteProjectFiles(
  projectId: string,
): Promise<{ project_id: string; deleted: string[] }> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/files`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Delete project files failed: ${res.status}`);
  }
  return res.json() as Promise<{ project_id: string; deleted: string[] }>;
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

export interface HarnessInfo {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export async function listHarnesses(): Promise<HarnessInfo[]> {
  const res = await fetch(`${backendUrl()}/harnesses`);
  if (!res.ok) throw new Error(`Failed to load harnesses: ${res.status}`);
  const data = (await res.json()) as { harnesses: HarnessInfo[] };
  return data.harnesses;
}

export type AnalysisProgress = AnalysisStatus;

export async function getAnalysisStatus(projectId: string): Promise<AnalysisProgress> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/analyze/status`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to load analysis status: ${res.status}`);
  return res.json() as Promise<AnalysisProgress>;
}

export async function cancelAnalysis(projectId: string): Promise<{ status: string }> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/analyze/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Cancel failed: ${res.status}`);
  }
  return res.json() as Promise<{ status: string }>;
}

export interface AnalyzeOptions {
  harness_id?: string;
  preferences?: Record<string, unknown>;
  /** When provided, only these source file_ids are analyzed. */
  file_ids?: string[];
}

export async function analyzeProject(
  projectId: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const harness_id = options.harness_id ?? 'pi_agent';
  const preferences = options.preferences ?? {};
  const file_ids = options.file_ids ?? null;
  const res = await fetch(`${backendUrl()}/projects/${projectId}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, harness_id, preferences, file_ids }),
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
    sequence: AnalysisResult['sequence'];
    recommendation: AnalysisResult['recommendation'];
  };
  return {
    project_id: raw.project_id,
    harness_id: raw.harness_id,
    status: raw.status,
    clips: raw.clips.map(mapBackendClip),
    sequence: raw.sequence,
    recommendation: raw.recommendation,
  };
}

export interface SavedTimelineEntry {
  clip_id: string;
  start_sec: number;
  end_sec: number;
}

export interface SavedReviewState {
  clips: Array<string | SavedTimelineEntry>;
  decisions: Record<string, 'included' | 'excluded'>;
  profile?: AssemblyProfile;
  targetDurationSec?: number;
}

/**
 * Returns the saved (user-edited) timeline for a project, or null when the
 * timeline is still the fresh post-analysis ranking (clip-id strings) and
 * carries no review decisions to restore.
 */
export async function getSavedTimeline(
  projectId: string,
): Promise<SavedReviewState | null> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    timeline: {
      clips?: Array<string | SavedTimelineEntry>;
      decisions?: Record<string, 'included' | 'excluded'>;
      profile?: AssemblyProfile;
      target_duration_sec?: number;
      total_duration_sec?: number;
    } | null;
  };
  const entries = data.timeline?.clips;
  if (!entries) return null;
  return {
    clips: entries,
    decisions: data.timeline?.decisions ?? {},
    profile: data.timeline?.profile,
    targetDurationSec: data.timeline?.target_duration_sec,
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

export type ExportFormat = 'edl' | 'fcpxml' | 'resolve_xml';

export async function exportTimeline(
  projectId: string,
  format: ExportFormat,
  options: { overwrite?: boolean } = {},
): Promise<ExportResult> {
  const overwrite = options.overwrite ? '&overwrite=true' : '';
  const res = await fetch(
    `${backendUrl()}/projects/${projectId}/export?format=${format}${overwrite}`,
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
  decisions?: Record<string, 'included' | 'excluded'>;
  profile?: AssemblyProfile;
  targetDurationSec?: number;
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
      body: JSON.stringify({
        clips,
        decisions: options.decisions ?? {},
        profile: options.profile,
        target_duration_sec: options.targetDurationSec,
      }),
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

// --- Backend-authoritative Timeline Document (operations core over HTTP) ---

export interface TimelineTransform {
  scale: number;
  x: number;
  y: number;
}

export interface TimelineItem {
  item_id: string;
  source_clip_id: string;
  start_sec: number;
  end_sec: number;
  speed: number;
  transform: TimelineTransform;
}

export interface TimelineDocument {
  version: number;
  revision: number;
  items: TimelineItem[];
  profile: AssemblyProfile | null;
  target_duration_sec: number | null;
  decisions: Record<string, 'included' | 'excluded'>;
}

export interface TimelineSnapshot {
  document: TimelineDocument;
  sequence_fingerprint: string;
  review_context_fingerprint: string;
}

export interface TimelineRevisionConflictDetail {
  expected_revision: number;
  current_revision: number;
  current_snapshot: TimelineSnapshot;
}

export class TimelineRevisionConflictError extends Error {
  constructor(public readonly detail: TimelineRevisionConflictDetail) {
    super(`Working Timeline changed from revision ${detail.expected_revision} to ${detail.current_revision}`);
    this.name = 'TimelineRevisionConflictError';
  }
}

export async function getTimelineDocument(projectId: string): Promise<TimelineDocument> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/document`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to load timeline document: ${res.status}`);
  return (await res.json()).document as TimelineDocument;
}

export async function applyTimelineOp(
  projectId: string,
  operation: string,
  args: Record<string, unknown> = {},
  expectedRevision?: number,
): Promise<TimelineDocument> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/op`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, args, expected_revision: expectedRevision }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 409 && typeof err.detail === 'object') {
      throw new TimelineRevisionConflictError(err.detail as TimelineRevisionConflictDetail);
    }
    throw new Error(err.detail ?? `Timeline operation failed: ${res.status}`);
  }
  return (await res.json()).document as TimelineDocument;
}

export async function undoTimeline(projectId: string): Promise<TimelineDocument> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/undo`, { method: 'POST' });
  if (!res.ok) throw new Error(`Undo failed: ${res.status}`);
  return (await res.json()).document as TimelineDocument;
}

export async function redoTimeline(projectId: string): Promise<TimelineDocument> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/redo`, { method: 'POST' });
  if (!res.ok) throw new Error(`Redo failed: ${res.status}`);
  return (await res.json()).document as TimelineDocument;
}

/**
 * Subscribe to a project's live timeline events (SSE). The callback fires on
 * every `timeline-changed` event so the GUI reconciles from the authoritative
 * document — this is what makes an agent's edit appear live. Returns a teardown.
 */
export function subscribeTimelineEvents(
  projectId: string,
  onTimelineChanged: () => void,
): () => void {
  const source = new EventSource(`${backendUrl()}/projects/${projectId}/events`);
  source.addEventListener('timeline-changed', () => onTimelineChanged());
  return () => source.close();
}

// --- In-app review agent (propose mode) ------------------------------------

export interface Proposal {
  proposal_id: string;
  project_id: string;
  message: string;
  operations: Array<{ operation: string; args: Record<string, unknown> }>;
  summary: string[];
  before_item_count: number;
  after_item_count: number;
  based_on_timeline_revision: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ReviewTurnResult {
  message: string;
  proposal: Proposal | null;
  agent_message: ReviewMessage;
  session: ReviewSession;
}

export interface ReviewMessage {
  message_id: string;
  role: 'agent' | 'editor';
  text: string;
  created_at: string;
  reply_to_message_id: string | null;
  proposal: Proposal | null;
  payload: Record<string, unknown> & { version_set?: VersionSet };
}

export interface ReviewSession {
  schema_version: number;
  session_id: string;
  messages: ReviewMessage[];
  updated_at: string;
}

export async function getReviewSession(projectId: string): Promise<ReviewSession> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/review/session`);
  if (!res.ok) throw new Error(`Review session failed: ${res.status}`);
  return res.json() as Promise<ReviewSession>;
}

export async function reviewTurn(
  projectId: string,
  message: string,
  clientMessageId: string = crypto.randomUUID(),
): Promise<ReviewTurnResult> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/review/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, client_message_id: clientMessageId }),
  });
  if (!res.ok) throw new Error(`Review turn failed: ${res.status}`);
  return res.json() as Promise<ReviewTurnResult>;
}

export async function reviewKickoff(projectId: string): Promise<ReviewTurnResult> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/review/kickoff`, { method: 'POST' });
  if (!res.ok) throw new Error(`Review kickoff failed: ${res.status}`);
  return res.json() as Promise<ReviewTurnResult>;
}

export async function acceptProposal(projectId: string, proposalId: string): Promise<TimelineDocument> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/proposals/${proposalId}/accept`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 409 && typeof err.detail === 'object') {
      throw new TimelineRevisionConflictError(err.detail as TimelineRevisionConflictDetail);
    }
    throw new Error(`Accept proposal failed: ${res.status}`);
  }
  return (await res.json()).document as TimelineDocument;
}

export async function rejectProposal(projectId: string, proposalId: string): Promise<Proposal> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/proposals/${proposalId}/reject`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Reject proposal failed: ${res.status}`);
  return (await res.json()).proposal as Proposal;
}

export async function regenerateDraft(
  projectId: string,
  profile: AssemblyProfile,
  targetDurationSec: number,
): Promise<DraftResult> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, target_duration_sec: targetDurationSec }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Draft generation failed: ${res.status}`);
  }
  return res.json() as Promise<DraftResult>;
}

export async function getClipsWithFallback(
  projectId: string | null,
): Promise<ClipCandidate[]> {
  if (!projectId) return mockClips;
  return await getClips(projectId);
}
