export interface SequenceSegment {
  file_id: string;
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
  play: () => void;
  stop: () => void;
  toggle: () => void;
  seekTo: (index: number, sourceTimeSec: number) => void;
  previewProps: SequencePreviewProps;
}
