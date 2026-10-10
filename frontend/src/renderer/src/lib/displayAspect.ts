import type { UploadedVideo, VideoMetadata } from '../types/clip';

const LANDSCAPE = 16 / 9;

function positivePair(pair: readonly number[] | undefined): pair is [number, number] {
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    pair.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  );
}

/**
 * Width / height of a source as it is displayed, or `null` when its metadata
 * can't say. Prefers `display_resolution`; otherwise falls back to the encoded
 * `resolution`, swapped when the rotation tag turns the picture on its side.
 */
export function sourceDisplayAspect(metadata?: VideoMetadata): number | null {
  if (!metadata) return null;
  if (positivePair(metadata.display_resolution)) {
    const [width, height] = metadata.display_resolution;
    return width / height;
  }
  if (!positivePair(metadata.resolution)) return null;
  const [width, height] = metadata.resolution;
  return Math.abs(metadata.rotation_degrees ?? 0) % 180 === 90 ? height / width : width / height;
}

/**
 * Aspect of the sequence the export will build: the export sizes it from the
 * first clip's source, so the previews do the same. Falls back to 16:9.
 */
export function sequenceAspect(
  firstFileId: string | undefined,
  videos: UploadedVideo[],
): number {
  const metadata = videos.find((video) => video.file_id === firstFileId)?.metadata;
  return sourceDisplayAspect(metadata) ?? LANDSCAPE;
}
