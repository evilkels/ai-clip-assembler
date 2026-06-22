import { useMemo } from 'react';
import type { Version } from '../types/version';
import { ClipPreview } from './ClipPreview';
import { useSequencePlayer } from './useSequencePlayer';
import { VersionScrubber } from './VersionScrubber';

interface VersionPlayerProps {
  version: Version;
  projectId: string | null;
  expanded?: boolean;
  testId: string;
  /**
   * Whether this Version is the gallery's single playing player. Ownership of
   * the play state lives in the gallery so starting one Version pauses any
   * other without cross-player effects.
   */
  playing?: boolean;
  /** Toggle this Version as the playing one (pausing any other). */
  onTogglePlay?: () => void;
  /** Expand/collapse the card by clicking the preview surface. */
  onExpand?: () => void;
}

export function VersionPlayer({
  version,
  projectId,
  expanded = false,
  testId,
  playing = false,
  onTogglePlay,
  onExpand,
}: VersionPlayerProps) {
  const segments = useMemo(
    () =>
      version.items.map((item) => ({
        file_id: item.file_id,
        start_sec: item.start_sec,
        end_sec: item.end_sec,
        speed: item.speed,
      })),
    [version.items],
  );
  const player = useSequencePlayer({ projectId, segments, loop: true });
  const scale = version.items[player.currentIndex]?.transform.scale ?? 1;

  return (
    <>
      <div
        className={`version-player${expanded ? ' expanded' : ''}`}
        data-testid={testId}
      >
        <ClipPreview
          {...player.previewProps}
          playing={playing}
          scale={scale}
          label={version.title}
          testId={`${testId}-video`}
        />
        {onExpand ? (
          // A real button over the preview (no interactive children) so the
          // expand affordance is keyboard-operable without a button-role
          // wrapper. The play button sits above it via z-index.
          <button
            type="button"
            className={`version-player-expand${expanded ? ' expanded' : ''}`}
            aria-label={expanded ? `Collapse ${version.title}` : `Focus ${version.title}`}
            onClick={onExpand}
          />
        ) : null}
        <button
          type="button"
          className="version-player-play"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePlay?.();
          }}
          aria-label={playing ? `Pause ${version.title}` : `Play ${version.title}`}
        >
          {playing ? '❚❚' : '▶'}
        </button>
      </div>
      <VersionScrubber
        items={version.items}
        currentTimelineTimeSec={player.currentTimelineTimeSec}
        totalDurationSec={player.totalDurationSec}
        currentIndex={player.currentIndex}
        onSeek={player.seekToTimelineTime}
      />
    </>
  );
}
