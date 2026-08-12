export interface SequenceSegment {
  item_id?: string;
  file_id?: string;
  start_sec: number;
  end_sec: number;
  speed?: number;
}

export interface UseSequencePlayerArgs {
  projectId: string | null;
  segments: SequenceSegment[];
  loop?: boolean;
  onProgress?: (index: number, sourceTimeSec: number) => void;
}

export interface SequencePreviewProps {
  mediaUrl: string | undefined;
  startSec: number;
  endSec: number;
  playing: boolean;
  loop: false;
  controls: false;
  seek: { time: number; epoch: number };
  onPlaybackTime: (sourceTimeSec: number) => void;
  playbackRate: number;
}

export interface UseSequencePlayerResult {
  playing: boolean;
  currentIndex: number;
  /** Source time of the current segment's playhead. */
  currentSourceTimeSec: number;
  /** Playhead position expressed in total Version (effective) time. */
  currentTimelineTimeSec: number;
  /** Sum of every segment's effective duration `(end - start) / speed`. */
  totalDurationSec: number;
  play: () => void;
  stop: () => void;
  toggle: () => void;
  seekTo: (index: number, sourceTimeSec: number) => void;
  /** Seek by total Version time; clamps to `[0, totalDurationSec]`. */
  seekToTimelineTime: (timelineTimeSec: number) => void;
  previewProps: SequencePreviewProps;
}
