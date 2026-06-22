import type { AssemblyProfile } from './clip';

/** One placement in a proposed cut; it has no live Timeline Item id yet. */
export interface VersionItem {
  source_clip_id: string;
  file_id: string;
  file_name: string;
  start_sec: number;
  end_sec: number;
  speed: number;
  transform: { scale: number; x: number; y: number };
}

/** A complete alternative cut that the Editor can preview and adopt. */
export interface Version {
  version_id: string;
  title: string;
  vibe: string;
  rationale: string;
  profile: AssemblyProfile;
  total_duration_sec: number;
  items: VersionItem[];
  sequence_fingerprint: string;
}

export interface VersionSet {
  version_set_id: string;
  versions: Version[];
  created_at: string;
  based_on_timeline_revision: number;
  based_on_sequence_fingerprint: string;
  based_on_review_context_fingerprint: string;
}
