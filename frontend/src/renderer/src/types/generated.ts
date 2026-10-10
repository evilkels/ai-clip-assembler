/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface AssemblyResult {
  harness_id?: string;
  harness_version?: string;
  processing_time_sec?: number;
  clips: ClipSuggestion[];
  sequence: TimelineSequence;
  metadata?: {
    [k: string]: unknown;
  };
}
export interface ClipSuggestion {
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
  max_turn_rate_deg_per_sec?: number | null;
  visual_interest_score: number;
  overall_score: number;
  ai_reason: string;
  suggested_speed?: number;
  suggested_transition?: string | null;
  tags?: string[];
  source_created_at?: string | null;
  source_duration_sec?: number | null;
  look_group?: number | null;
}
export interface TimelineSequence {
  total_duration_sec: number;
  clips: string[];
}
export interface CreativeVersion {
  version_id: string;
  title: string;
  vibe: string;
  rationale: string;
  profile: "short_social" | "cinematic_highlight" | "long_scenic" | "custom";
  total_duration_sec: number;
  items: CreativeVersionItem[];
  sequence_fingerprint: string;
}
export interface CreativeVersionItem {
  source_clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  speed?: number;
  transform?: {
    [k: string]: unknown;
  };
}
export interface FrameSample {
  timestamp: number;
  frame_path: string;
  scene_id?: number;
  is_keyframe?: boolean;
}
export interface FrameScore {
  timestamp: number;
  frame_path: string;
  motion_stability: number;
  smoothness_score: number;
  sharpness_score: number;
  exposure_score: number;
  contrast_score: number;
  visual_interest_score?: number;
  overall_score: number;
  blur_score: number;
  brightness: number;
  contrast: number;
  scene_id?: number;
  is_keyframe?: boolean;
  turn_rate_deg_per_sec?: number;
}
export interface Proposal {
  proposal_id: string;
  project_id: string;
  message: string;
  operations?: {
    [k: string]: unknown;
  }[];
  summary?: string[];
  before_item_count?: number;
  after_item_count?: number;
  before_duration_sec?: number;
  after_duration_sec?: number;
  based_on_timeline_revision?: number;
  status?: "pending" | "accepted" | "rejected" | "superseded";
}
export interface RemoteError {
  reason: string;
  message?: string | null;
}
export interface RemoteHealth {
  ok?: boolean;
  instance: string;
}
export interface RemoteMe {
  device_label: string;
  user_agent?: string;
  owner_login: string;
  mac_name: string;
  csrf_token: string;
  session_active: boolean;
  approved_at: string;
  session_started_at?: string | null;
  network_path?: "direct" | "relayed" | "unknown";
  devices_connected?: number;
}
export interface RemoteNowOnMac {
  state: "idle" | "analyzing" | "failed";
  phase?: string | null;
  percent?: number | null;
  message?: string | null;
  elapsed_sec?: number | null;
  updated_at?: number | null;
}
export interface RemotePairPoll {
  state: "pending" | "approved" | "denied" | "expired";
  csrf_token?: string | null;
  device_label?: string | null;
}
export interface RemotePairRequest {
  token: string;
  label?: string | null;
}
export interface RemotePairStarted {
  pending_id: string;
}
export interface RemoteProjectDetail {
  id: string;
  name: string;
  source_count: number;
  clip_count: number;
  last_analyzed_at?: string | null;
  now_on_mac: RemoteNowOnMac;
  sources: RemoteSource[];
}
export interface RemoteSource {
  source_uuid: string;
  name: string;
  duration_sec?: number | null;
  size_bytes?: number | null;
  imported_at: string;
  from_phone?: boolean;
}
export interface RemoteProjectList {
  projects: RemoteProjectSummary[];
}
export interface RemoteProjectSummary {
  id: string;
  name: string;
  source_count: number;
  clip_count: number;
  state: "not_analyzed" | "analyzing" | "ready";
  percent?: number | null;
}
export interface RemoteSessionRenewed {
  csrf_token: string;
}
export interface ReviewMessage {
  message_id: string;
  role: "agent" | "editor";
  text: string;
  created_at: string;
  reply_to_message_id?: string | null;
  proposal?: Proposal | null;
  script?: ScriptRun | null;
  payload?: {
    [k: string]: unknown;
  };
}
/**
 * One run of a Script, saved on the Review Message that carries it (ADR 0006).
 */
export interface ScriptRun {
  language?: "lua";
  engine?: string;
  source: string;
  author: "editor" | "agent";
  log?: string[];
  error?: ScriptRunError | null;
  proposal_id?: string | null;
  operation_count?: number;
  based_on_timeline_revision: number;
  ran_at: string;
}
export interface ScriptRunError {
  kind: "syntax" | "runtime" | "operation" | "limit";
  message: string;
  line?: number | null;
}
export interface ReviewSession {
  schema_version?: number;
  session_id: string;
  messages?: ReviewMessage[];
  updated_at: string;
}
/**
 * The single backend-authoritative record of the Timeline.
 *
 * Ordered Timeline Items plus the assembly knobs (profile, target duration)
 * and a schema version. The GUI and agents are clients of this document.
 */
export interface TimelineDocument {
  version?: number;
  revision?: number;
  items?: TimelineItem[];
  profile?: string | null;
  target_duration_sec?: number | null;
  decisions?: {
    [k: string]: string;
  };
}
/**
 * One placement of a Candidate Clip on the Timeline.
 *
 * The same candidate may appear as more than one item (multi-instance); each
 * placement has its own in/out bounds within the source video, Speed, and
 * Transform.
 */
export interface TimelineItem {
  item_id: string;
  source_clip_id: string;
  start_sec: number;
  end_sec: number;
  speed?: number;
  transform?: Transform;
}
/**
 * A Timeline Item's digital zoom/pan/crop. Identity by default.
 *
 * ``scale`` is the zoom factor (1.0 = no zoom). ``x`` / ``y`` are pan offsets
 * in normalized frame units. Validated so a transform can never be degenerate.
 */
export interface Transform {
  scale?: number;
  x?: number;
  y?: number;
}
export interface VersionSet {
  version_set_id: string;
  versions: CreativeVersion[];
  created_at: string;
  based_on_timeline_revision: number;
  based_on_sequence_fingerprint: string;
  based_on_review_context_fingerprint: string;
}
export interface VideoMetadata {
  file_id: string;
  file_path: string;
  file_name: string;
  duration_sec: number;
  fps: number;
  resolution: number[];
  display_resolution?: number[];
  rotation_degrees?: number;
  codec: string;
  size_bytes?: number;
  created_at?: string | null;
  has_audio?: boolean;
  audio_channels?: number | null;
  audio_sample_rate?: number | null;
  audio_codec?: string | null;
  audio_bit_depth?: number | null;
}
