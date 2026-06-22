import type { ClipCandidate } from '../types/clip';
import type { Version, VersionItem } from '../types/version';

const IDENTITY = { scale: 1, x: 0, y: 0 };

const RECIPES = [
  {
    id: 'v-social',
    title: 'Punchy Social Cut',
    vibe: 'fast & upbeat',
    profile: 'short_social' as const,
    count: 4,
    segmentDuration: 3,
    speed: 1,
    rationale: 'Quick 3s hits for a vertical-friendly social edit.',
  },
  {
    id: 'v-cinematic',
    title: 'Cinematic Highlight',
    vibe: 'slow & sweeping',
    profile: 'cinematic_highlight' as const,
    count: 3,
    segmentDuration: 6,
    speed: 0.5,
    rationale: 'Fewer, longer beats at half-speed for a cinematic feel.',
  },
  {
    id: 'v-scenic',
    title: 'Long Scenic',
    vibe: 'relaxed & wide',
    profile: 'long_scenic' as const,
    count: 5,
    segmentDuration: 6,
    speed: 1,
    rationale: 'A longer establishing montage that lets each location breathe.',
  },
] as const;

function sliceItem(
  clip: ClipCandidate,
  offset: number,
  segmentDuration: number,
  speed: number,
): VersionItem {
  const start = Math.min(
    clip.start_sec + offset,
    Math.max(clip.start_sec, clip.end_sec - 1),
  );
  const end = Math.min(clip.end_sec, Math.max(start + 0.5, start + segmentDuration));
  return {
    source_clip_id: clip.clip_id,
    file_id: clip.file_id,
    file_name: clip.file_name,
    start_sec: Number(start.toFixed(2)),
    end_sec: Number(end.toFixed(2)),
    speed,
    transform: { ...IDENTITY },
  };
}

/** Build deterministic preview-spec Versions from the real Candidate Clip pool. */
export function proposeVersions(clips: ClipCandidate[]): Version[] {
  if (clips.length === 0) return [];

  const ranked = [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
  return RECIPES.map((recipe) => {
    const items: VersionItem[] = [];
    for (let index = 0; index < recipe.count; index += 1) {
      const clip = ranked[index % ranked.length];
      const offset = Math.floor(index / ranked.length) * recipe.segmentDuration;
      items.push(
        sliceItem(clip, offset, recipe.segmentDuration, recipe.speed),
      );
    }
    const totalDuration = items.reduce(
      (total, item) => total + (item.end_sec - item.start_sec) / item.speed,
      0,
    );
    return {
      version_id: recipe.id,
      title: recipe.title,
      vibe: recipe.vibe,
      rationale: recipe.rationale,
      profile: recipe.profile,
      total_duration_sec: Number(totalDuration.toFixed(1)),
      items,
      // Fixture-only sentinel until Task 4 removes this runtime fallback.
      sequence_fingerprint: 'frontend-fixture-only',
    };
  });
}
