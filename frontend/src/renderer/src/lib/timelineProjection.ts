/**
 * Presentation projection for the backend-authoritative Timeline Document.
 *
 * A Timeline Item is a placement, not a Candidate Clip. Keep the placement's
 * item_id all the way through this projection so repeated Candidate Clips do
 * not collapse into one visual block or receive shared edit targets.
 */

export interface TimelineProjectionTransform {
  scale: number;
  x: number;
  y: number;
}

export interface TimelineProjectionItem {
  itemId: string;
  sourceClipId: string;
  fileName: string;
  startSec: number;
  endSec: number;
  speed: number;
  durationSec: number;
  transform: TimelineProjectionTransform;
  missingSource: boolean;
}

export interface TimelineProjectionTimelineItem {
  item_id: string;
  source_clip_id: string;
  start_sec: number;
  end_sec: number;
  speed?: number;
  transform?: {
    scale?: number;
    x?: number;
    y?: number;
  };
}

export interface TimelineProjectionClip {
  clip_id: string;
  file_name?: string;
}

function positiveSpeed(speed: number | undefined): number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function transformOrDefault(transform: TimelineProjectionTimelineItem['transform']): TimelineProjectionTransform {
  return {
    scale: typeof transform?.scale === 'number' && Number.isFinite(transform.scale) ? transform.scale : 1,
    x: typeof transform?.x === 'number' && Number.isFinite(transform.x) ? transform.x : 0,
    y: typeof transform?.y === 'number' && Number.isFinite(transform.y) ? transform.y : 0,
  };
}

export function projectTimelineItems(
  items: readonly TimelineProjectionTimelineItem[],
  clips: readonly TimelineProjectionClip[],
): TimelineProjectionItem[] {
  const clipsById = new Map(clips.map((clip) => [clip.clip_id, clip]));

  return items.map((item) => {
    const clip = clipsById.get(item.source_clip_id);
    const speed = positiveSpeed(item.speed);
    const sourceDuration = Math.max(0, item.end_sec - item.start_sec);

    return {
      itemId: item.item_id,
      sourceClipId: item.source_clip_id,
      fileName: clip?.file_name ?? item.source_clip_id,
      startSec: item.start_sec,
      endSec: item.end_sec,
      speed,
      durationSec: sourceDuration / speed,
      transform: transformOrDefault(item.transform),
      missingSource: !clip,
    };
  });
}

export function effectiveTimelineDuration(
  items: readonly TimelineProjectionTimelineItem[],
): number {
  return items.reduce((total, item) => {
    const speed = positiveSpeed(item.speed);
    return total + Math.max(0, item.end_sec - item.start_sec) / speed;
  }, 0);
}
