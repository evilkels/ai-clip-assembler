import { formatClock } from '../lib/format';

export interface Range {
  start: number;
  end: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** A bar spanning the full source file with the clip region, sibling candidates
 *  and a live playhead marked on it. */
export function SourceTrack({
  durationSec,
  startSec,
  endSec,
  playheadSec,
  siblings,
  accent,
  onSeek,
}: {
  durationSec: number;
  startSec: number;
  endSec: number;
  playheadSec: number;
  siblings: Range[];
  accent: string;
  onSeek?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const left = (t: number) => `${clamp01(t / durationSec) * 100}%`;
  const width = (a: number, b: number) => `${clamp01((b - a) / durationSec) * 100}%`;
  return (
    <div className="source-track-wrap">
      <button
        type="button"
        className={`source-track${onSeek ? ' seekable' : ''}`}
        onClick={onSeek}
        disabled={!onSeek}
        aria-label={`Seek preview within ${formatClock(startSec)} to ${formatClock(endSec)}`}
        title={`Clip is ${formatClock(startSec)}–${formatClock(endSec)} of a ${formatClock(durationSec)} file`}
      >
        {siblings.map((s, i) => (
          <span
            key={`${s.start}-${i}`}
            className="source-track-sibling"
            style={{ left: left(s.start), width: width(s.start, s.end) }}
          />
        ))}
        <span
          className="source-track-clip"
          style={{ left: left(startSec), width: width(startSec, endSec), background: accent }}
        />
        <span className="source-track-playhead" style={{ left: left(playheadSec) }} />
      </button>
      <span className="source-track-caption">
        {formatClock(startSec)}–{formatClock(endSec)} of {formatClock(durationSec)}
      </span>
    </div>
  );
}
