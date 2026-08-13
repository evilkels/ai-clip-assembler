import type { UploadedVideo } from '../types/clip';

export interface SourceAudioState {
  /** `undefined` means the source predates audio probing: unknown, not silent. */
  hasAudio: boolean | undefined;
  channels: number | undefined;
}

/**
 * Audio facts for a clip's source video.
 *
 * Matches on `file_id`, never on name: two folders can hold the same file name.
 */
export function sourceAudioState(
  fileId: string | undefined,
  videos: UploadedVideo[],
): SourceAudioState {
  const metadata = videos.find((video) => video.file_id === fileId)?.metadata;
  return { hasAudio: metadata?.has_audio, channels: metadata?.audio_channels ?? undefined };
}

/** Badge text for a source, or `null` when nothing truthful can be claimed. */
export function sourceAudioLabel({ hasAudio, channels }: SourceAudioState): string | null {
  if (hasAudio === undefined) return null;
  if (!hasAudio) return 'Silent';
  return channels ? `Audio · ${channels}ch` : 'Audio';
}
