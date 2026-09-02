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
  ClipGenerationPreferenceUpdate,
  ClipGenerationStats,
  DraftResult,
  FormatName,
  ProjectManifest,
  RecentProject,
  UploadedVideo,
  VideoMetadata,
} from '../types/clip';
import { mockClips } from './mockClips';
import type { ClipSuggestion } from '../types/generated';
import type { VersionSet } from '../types/version';
import type { ReviewModelAccountStatus } from '../../../shared/reviewModelAuth';
import type { UpdateStatus } from '../../../shared/updateStatus';

export type { ReviewModelAccountStatus } from '../../../shared/reviewModelAuth';
export type { UpdateStatus } from '../../../shared/updateStatus';

export type McpClientId = 'claude_desktop' | 'codex';

export interface McpClientStatus {
  id: McpClientId;
  name: string;
  configPath: string;
  installed: boolean;
  connected: boolean;
  needsRestart: boolean;
  /** Set when the client's config exists but could not be read — connect is unsafe. */
  detectError?: string;
}

export interface McpConnectResult extends McpClientStatus {
  backupPath?: string;
  snippet: string;
}

declare global {
  interface Window {
    clipAssembler?: {
      backendUrl: string;
      platform: string;
      selectProjectFolder?: () => Promise<string | null>;
      listRecentProjects?: () => Promise<RecentProject[]>;
      getLastOpenedRecentProject?: () => Promise<RecentProject | null>;
      addRecentProject?: (folderPath: string, name?: string) => Promise<RecentProject[]>;
      renameRecentProject?: (folderPath: string, name: string) => Promise<RecentProject[]>;
      removeRecentProject?: (folderPath: string) => Promise<RecentProject[]>;
      relocateRecentProject?: (folderPath: string) => Promise<RecentProject[]>;
      setWindowTitle?: (projectName?: string) => Promise<void>;
      openInDaVinci?: (exportPath: string, sourceFolder?: string) => Promise<{ opened: boolean }>;
      revealExportFile?: (filePath: string) => Promise<{ revealed: boolean }>;
      getReviewModelAccountStatus?: () => Promise<ReviewModelAccountStatus>;
      signInReviewModel?: () => Promise<ReviewModelAccountStatus>;
      cancelReviewModelSignIn?: () => Promise<ReviewModelAccountStatus>;
      detectMcpClients?: () => Promise<McpClientStatus[]>;
      connectMcpClient?: (clientId: McpClientId) => Promise<McpConnectResult>;
      checkForAppUpdate?: (force?: boolean) => Promise<UpdateStatus>;
      dismissAppUpdate?: (version: string) => Promise<UpdateStatus>;
      openAppReleasePage?: () => Promise<{ opened: boolean }>;
    };
  }
}

const backendUrl = (): string =>
  window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000';

export function buildVideoMediaUrl(projectId: string, fileId: string): string {
  return `${backendUrl()}/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(fileId)}/media`;
}

export function buildClipPosterUrl(projectId: string, fileId: string, atMs: number): string {
  // Clip start times are frame timestamps, so atMs arrives as a float, but
  // the route takes an integer millisecond. Round here or nearly every
  // poster request 422s.
  const at = Math.max(0, Math.round(atMs));
  return `${backendUrl()}/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(fileId)}/poster?at_ms=${at}`;
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

type BackendClipSuggestion = ClipSuggestion;

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
    tags: c.tags,
    max_turn_rate_deg_per_sec: c.max_turn_rate_deg_per_sec ?? null,
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
  generation_stats?: ClipGenerationStats | null;
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

export async function updateCloudAiConsent(
  projectId: string,
  consented: boolean,
): Promise<{ project_id: string; cloud_ai_consent: boolean; project?: ProjectManifest }> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/cloud-ai-consent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consented }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Failed to update cloud AI consent: ${res.status}`);
  }
  return res.json() as Promise<{
    project_id: string;
    cloud_ai_consent: boolean;
    project?: ProjectManifest;
  }>;
}

export async function selectProjectFolder(): Promise<string | null> {
  return window.clipAssembler?.selectProjectFolder?.() ?? null;
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  return window.clipAssembler?.listRecentProjects?.() ?? [];
}

export async function getLastOpenedRecentProject(): Promise<RecentProject | null> {
  return window.clipAssembler?.getLastOpenedRecentProject?.() ?? null;
}

export async function addRecentProject(
  folderPath: string,
  name?: string,
): Promise<RecentProject[]> {
  return window.clipAssembler?.addRecentProject?.(folderPath, name) ?? [];
}

export async function renameRecentProject(
  folderPath: string,
  name: string,
): Promise<RecentProject[]> {
  return window.clipAssembler?.renameRecentProject?.(folderPath, name) ?? [];
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

export async function revealExportFile(filePath: string): Promise<void> {
  if (!window.clipAssembler?.revealExportFile) {
    throw new Error('Reveal export file is only available in the desktop app');
  }
  await window.clipAssembler.revealExportFile(filePath);
}

const REVIEW_MODEL_DESKTOP_ERROR = 'Review model sign-in is only available in the desktop app';

type ReviewModelBridgeMethod =
  | 'getReviewModelAccountStatus'
  | 'signInReviewModel'
  | 'cancelReviewModelSignIn';

function callReviewModelBridge(method: ReviewModelBridgeMethod): Promise<ReviewModelAccountStatus> {
  const call = window.clipAssembler?.[method];
  if (!call) {
    throw new Error(REVIEW_MODEL_DESKTOP_ERROR);
  }
  return call();
}

export async function getReviewModelAccountStatus(): Promise<ReviewModelAccountStatus> {
  return callReviewModelBridge('getReviewModelAccountStatus');
}

export async function signInReviewModel(): Promise<ReviewModelAccountStatus> {
  return callReviewModelBridge('signInReviewModel');
}

export async function cancelReviewModelSignIn(): Promise<ReviewModelAccountStatus> {
  return callReviewModelBridge('cancelReviewModelSignIn');
}

export async function detectMcpClients(): Promise<McpClientStatus[]> {
  return window.clipAssembler?.detectMcpClients?.() ?? [];
}

export async function connectMcpClient(clientId: McpClientId): Promise<McpConnectResult> {
  if (!window.clipAssembler?.connectMcpClient) {
    throw new Error('MCP client connection is only available in the desktop app');
  }
  return window.clipAssembler.connectMcpClient(clientId);
}

/** Outside the desktop shell there is nothing to update, so report unknown. */
const NO_UPDATE_BRIDGE: UpdateStatus = {
  state: 'unknown',
  currentVersion: 'dev',
  detail: 'Update checks are only available in the desktop app.',
};

export async function checkForAppUpdate(force = false): Promise<UpdateStatus> {
  return window.clipAssembler?.checkForAppUpdate?.(force) ?? NO_UPDATE_BRIDGE;
}

export async function dismissAppUpdate(version: string): Promise<UpdateStatus> {
  return window.clipAssembler?.dismissAppUpdate?.(version) ?? NO_UPDATE_BRIDGE;
}

export async function openAppReleasePage(): Promise<boolean> {
  const result = await window.clipAssembler?.openAppReleasePage?.();
  return result?.opened ?? false;
}

export async function activateProject(projectId: string): Promise<void> {
  const res = await fetch(`${backendUrl()}/projects/${encodeURIComponent(projectId)}/activate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: res.statusText }))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to activate project: ${res.status}`);
  }
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
  preferences?: ClipGenerationPreferenceUpdate;
  /** When provided, only these source file_ids are analyzed. */
  file_ids?: string[];
}

export async function analyzeProject(
  projectId: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const harness_id = options.harness_id ?? 'manual';
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
    generation_stats?: ClipGenerationStats;
    notices?: AnalysisResult['notices'];
  };
  return {
    project_id: raw.project_id,
    harness_id: raw.harness_id,
    status: raw.status,
    clips: raw.clips.map(mapBackendClip),
    sequence: raw.sequence,
    recommendation: raw.recommendation,
    generation_stats: raw.generation_stats,
    notices: raw.notices,
  };
}

export async function rederiveClips(
  projectId: string,
  preferences: ClipGenerationPreferenceUpdate,
): Promise<AnalysisResult> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/clips/rederive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Clip regeneration failed: ${res.status}`);
  }
  const raw = (await res.json()) as {
    project_id: string;
    harness_id: string;
    status: string;
    clips: BackendClipSuggestion[];
    sequence: AnalysisResult['sequence'];
    recommendation: AnalysisResult['recommendation'];
    generation_stats?: ClipGenerationStats;
  };
  return {
    project_id: raw.project_id,
    harness_id: raw.harness_id,
    status: raw.status,
    clips: raw.clips.map(mapBackendClip),
    sequence: raw.sequence,
    recommendation: raw.recommendation,
    generation_stats: raw.generation_stats,
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
  format: ExportFormat;
  status: string;
  file_path: string;
  clip_count: number;
  total_duration_sec: number;
  warnings: string[];
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

export async function getTimelineDocument(projectId: string): Promise<TimelineSnapshot> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/document`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to load timeline document: ${res.status}`);
  return res.json() as Promise<TimelineSnapshot>;
}

export async function applyTimelineOp(
  projectId: string,
  operation: string,
  args: Record<string, unknown> = {},
  expectedRevision?: number,
): Promise<TimelineSnapshot> {
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
  return res.json() as Promise<TimelineSnapshot>;
}

export async function undoTimeline(projectId: string): Promise<TimelineSnapshot> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/undo`, { method: 'POST' });
  if (!res.ok) throw new Error(`Undo failed: ${res.status}`);
  return res.json() as Promise<TimelineSnapshot>;
}

export async function redoTimeline(projectId: string): Promise<TimelineSnapshot> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/timeline/redo`, { method: 'POST' });
  if (!res.ok) throw new Error(`Redo failed: ${res.status}`);
  return res.json() as Promise<TimelineSnapshot>;
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

export async function clearReviewSession(projectId: string): Promise<ReviewSession> {
  const res = await fetch(`${backendUrl()}/projects/${projectId}/review/session`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Clear review session failed: ${res.status}`);
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
  params: { format: FormatName } | { profile: AssemblyProfile; targetDurationSec: number },
): Promise<DraftResult> {
  const body =
    'format' in params
      ? { format: params.format }
      : { profile: params.profile, target_duration_sec: params.targetDurationSec };
  const res = await fetch(`${backendUrl()}/projects/${projectId}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export interface AppSettings {
  pi_bin: string;
  pi_provider: string;
  pi_model: string;
  pi_timeout_sec: number;
}

export interface SettingsResponse {
  settings: AppSettings;
  editable: (keyof AppSettings)[];
}

export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${backendUrl()}/settings`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  return res.json() as Promise<SettingsResponse>;
}

export type SettingsUpdate = Partial<
  Pick<AppSettings, 'pi_provider' | 'pi_model' | 'pi_timeout_sec'>
>;

export async function updateSettings(changes: SettingsUpdate): Promise<SettingsResponse> {
  const res = await fetch(`${backendUrl()}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Saving settings failed: ${res.status}`);
  }
  return res.json() as Promise<SettingsResponse>;
}

export interface ReviewModelDiagnostic {
  binary: { configured: string; resolved: string | null; found: boolean };
  provider: string;
  model: string;
  reachable: boolean;
  elapsed_sec: number | null;
  detail: string;
}

export interface Diagnostics {
  review_model: ReviewModelDiagnostic;
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const res = await fetch(`${backendUrl()}/diagnostics`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Diagnostics failed: ${res.status}`);
  return res.json() as Promise<Diagnostics>;
}
