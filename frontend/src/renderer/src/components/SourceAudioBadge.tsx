import { sourceAudioLabel, type SourceAudioState } from '../lib/sourceAudio';

export function SourceAudioBadge({ hasAudio, channels }: SourceAudioState) {
  const label = sourceAudioLabel({ hasAudio, channels });
  if (label === null) return null;
  const title = hasAudio
    ? 'This source carries audio, which exports to Resolve and FCPXML'
    : 'This source has no audio stream; it exports video-only';
  return (
    <span
      className={`source-audio-badge ${hasAudio ? 'has-audio' : 'silent'}`}
      data-testid="source-audio-badge"
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  );
}
