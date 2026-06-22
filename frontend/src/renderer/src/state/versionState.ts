import type { TimelineSnapshot } from '../api/client';
import type { Version, VersionSet } from '../types/version';

export type VersionDisplayState = 'applied' | 'current' | 'stale' | 'unavailable';

export function deriveVersionState({
  version,
  versionSet,
  snapshot,
  availableClipIds,
}: {
  version: Version;
  versionSet: VersionSet;
  snapshot: TimelineSnapshot;
  availableClipIds: Set<string>;
}): VersionDisplayState {
  if (version.items.some((item) => !availableClipIds.has(item.source_clip_id))) {
    return 'unavailable';
  }
  if (version.sequence_fingerprint === snapshot.sequence_fingerprint) return 'applied';
  const setHasAppliedVersion = versionSet.versions.some(
    (candidate) => candidate.sequence_fingerprint === snapshot.sequence_fingerprint,
  );
  if (
    versionSet.based_on_review_context_fingerprint === snapshot.review_context_fingerprint ||
    setHasAppliedVersion
  ) {
    return 'current';
  }
  return 'stale';
}

export function buildVersionMembership(
  versionSet: VersionSet | null,
): Map<string, string[]> {
  const membership = new Map<string, string[]>();
  for (const [index, version] of (versionSet?.versions ?? []).slice(0, 4).entries()) {
    const label = String.fromCharCode('A'.charCodeAt(0) + index);
    for (const sourceClipId of new Set(version.items.map((item) => item.source_clip_id))) {
      const labels = membership.get(sourceClipId) ?? [];
      labels.push(label);
      membership.set(sourceClipId, labels);
    }
  }
  return membership;
}
