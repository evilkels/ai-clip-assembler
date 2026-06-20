import { useMemo } from 'react';
import type { Version } from '../types/version';
import { ClipPreview } from './ClipPreview';
import { useSequencePlayer } from './useSequencePlayer';

interface VersionPlayerProps {
  version: Version;
  projectId: string | null;
  expanded?: boolean;
  testId: string;
}

export function VersionPlayer({
  version,
  projectId,
  expanded = false,
  testId,
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
    <div
      className={`version-player${expanded ? ' expanded' : ''}`}
      data-testid={testId}
    >
      <ClipPreview
        {...player.previewProps}
        scale={scale}
        label={version.title}
        testId={`${testId}-video`}
      />
      <button
        type="button"
        className="version-player-play"
        onClick={(event) => {
          event.stopPropagation();
          player.toggle();
        }}
        aria-label={player.playing ? `Pause ${version.title}` : `Play ${version.title}`}
      >
        {player.playing ? '❚❚' : '▶'}
      </button>
    </div>
  );
}
