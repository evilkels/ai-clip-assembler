import { usePreviewAudio } from '../state/usePreviewAudio';

/**
 * Mute toggle plus volume for every preview surface (plan 026). Both routes
 * render this and drive the same preference, so they can never disagree.
 */
export function PreviewAudioControl({ anySourceHasAudio }: { anySourceHasAudio: boolean }) {
  const { muted, volume, setMuted, setVolume } = usePreviewAudio();
  // A hidden control reads as a bug, so it stays visible and says why it is off.
  const disabledReason = anySourceHasAudio ? undefined : 'No audio-bearing source is available';

  return (
    <div className="preview-audio-control">
      <button
        type="button"
        className="btn subtle"
        data-testid="preview-audio-toggle"
        aria-pressed={!muted && anySourceHasAudio}
        aria-label={muted ? 'Enable sound' : 'Mute sound'}
        title={disabledReason ?? (muted ? 'Enable sound' : 'Mute sound')}
        disabled={!anySourceHasAudio}
        onClick={() => setMuted(!muted)}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label="Volume"
        title={disabledReason ?? 'Volume'}
        disabled={!anySourceHasAudio}
        onChange={(event) => setVolume(Number(event.target.value))}
      />
    </div>
  );
}
