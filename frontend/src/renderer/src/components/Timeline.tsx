import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useReview } from '../state/ReviewContext';
import { EmptyState } from './EmptyState';
import { ClipPreview } from './ClipPreview';
import { PreviewAudioControl } from './PreviewAudioControl';
import { SourceAudioBadge } from './SourceAudioBadge';
import { sourceAudioState } from '../lib/sourceAudio';
import { usePreviewAudio } from '../state/usePreviewAudio';
import { useSequencePlayer } from './useSequencePlayer';
import { formatClock } from '../lib/format';

const MIN_PX_PER_SEC = 6;
const MAX_PX_PER_SEC = 160;
const MIN_CLIP_DURATION = 0.1;
const TICK_TARGET_PX = 80;
const NICE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const PLAYHEAD_THROTTLE_MS = 150;
const REVERSE_SEEK_HZ = 4;
const SNAP_DISTANCE_PX = 10;
const PREVIEW_HEIGHT_KEY = 'ai-clip-assembler:timeline-preview-height:v1';
const MIN_PREVIEW_HEIGHT = 220;
const MAX_PREVIEW_HEIGHT = 720;

interface Segment {
  itemId: string;
  sourceClipId: string;
  fileId?: string;
  fileName: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  scale: number;
  duration: number;
  offset: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function niceStep(pxPerSec: number): number {
  const raw = TICK_TARGET_PX / pxPerSec;
  return NICE_STEPS.find((step) => step >= raw) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

export function Timeline() {
  const { projectId, timelineItems, clips, applyTimelineOperation, uploadedVideos } = useReview();
  const { muted, volume, setMuted } = usePreviewAudio();

  const [pxPerSec, setPxPerSec] = useState(40);
  const [playhead, setPlayhead] = useState(0);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [canDrag, setCanDrag] = useState(true);
  const [trimPreview, setTrimPreview] = useState<{
    itemId: string;
    startSec: number;
    endSec: number;
  } | null>(null);
  const [previewHeight, setPreviewHeight] = useState(() => {
    const stored = Number(window.localStorage.getItem(PREVIEW_HEIGHT_KEY));
    return Number.isFinite(stored) ? clamp(stored, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT) : 360;
  });

  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  // While playing, the <video> is the only clock: RAF callbacks mutate these
  // refs and the DOM directly; React state follows via throttled updates.
  const playheadRef = useRef(0);
  const pxPerSecRef = useRef(40);
  const totalDurationRef = useRef(0);
  const segmentsRef = useRef<Segment[]>([]);
  const directionRef = useRef<-1 | 0 | 1>(0);
  const lastReverseSeekRef = useRef(0);
  const lastPlayheadSetRef = useRef(0);
  const didInitialSeekRef = useRef(false);

  const segments = useMemo<Segment[]>(() => {
    const byId = new Map(clips.map((clip) => [clip.clip_id, clip]));
    let offset = 0;
    return timelineItems.map((item) => {
      const clip = byId.get(item.source_clip_id);
      const preview = trimPreview?.itemId === item.item_id ? trimPreview : undefined;
      const trimStart = preview?.startSec ?? item.start_sec;
      const trimEnd = preview?.endSec ?? item.end_sec;
      const duration = (trimEnd - trimStart) / item.speed;
      const seg: Segment = {
        itemId: item.item_id,
        sourceClipId: item.source_clip_id,
        fileId: clip?.file_id,
        fileName: clip?.file_name ?? item.source_clip_id,
        trimStart,
        trimEnd,
        speed: item.speed,
        scale: item.transform.scale,
        duration,
        offset,
      };
      offset += duration;
      return seg;
    });
  }, [clips, timelineItems, trimPreview]);

  const totalDuration = segments.length
    ? segments[segments.length - 1].offset + segments[segments.length - 1].duration
    : 0;

  const sequenceSegments = useMemo(
    () =>
      segments.map((segment) => ({
        item_id: segment.itemId,
        file_id: segment.fileId,
        start_sec: segment.trimStart,
        end_sec: segment.trimEnd,
        speed: segment.speed,
      })),
    [segments],
  );

  segmentsRef.current = segments;
  totalDurationRef.current = totalDuration;
  pxPerSecRef.current = pxPerSec;
  directionRef.current = direction;

  const step = niceStep(pxPerSec);
  const ticks = useMemo(() => {
    const result: number[] = [];
    for (let t = 0; t <= totalDuration + 0.001; t += step) result.push(round1(t));
    return result;
  }, [totalDuration, step]);

  const currentSegment = segments.find(
    (seg) => playhead >= seg.offset && playhead < seg.offset + seg.duration,
  );
  const selectedSegment = selectedId
    ? segments.find((seg) => seg.itemId === selectedId)
    : undefined;
  // Keep the playhead inside the timeline when durations change.
  useEffect(() => {
    setPlayhead((p) => {
      const clamped = clamp(p, 0, totalDuration);
      playheadRef.current = clamped;
      return clamped;
    });
  }, [totalDuration]);

  const paintPlayhead = useCallback((timelineSec: number) => {
    playheadRef.current = timelineSec;
    if (playheadLineRef.current) {
      playheadLineRef.current.style.left = `${timelineSec * pxPerSecRef.current}px`;
    }
    if (timecodeRef.current) {
      timecodeRef.current.textContent = `${formatClock(timelineSec)} / ${formatClock(totalDurationRef.current)}`;
    }
    const now = performance.now();
    if (now - lastPlayheadSetRef.current > PLAYHEAD_THROTTLE_MS) {
      lastPlayheadSetRef.current = now;
      setPlayhead(timelineSec);
    }
  }, []);

  const onSequenceProgress = useCallback(
    (index: number, sourceTimeSec: number) => {
      const segment = segmentsRef.current[index];
      if (!segment) return;
      paintPlayhead(
        clamp(
          segment.offset + (sourceTimeSec - segment.trimStart) / segment.speed,
          segment.offset,
          segment.offset + segment.duration,
        ),
      );
    },
    [paintPlayhead],
  );

  const sequencePlayer = useSequencePlayer({
    projectId,
    segments: sequenceSegments,
    onProgress: onSequenceProgress,
  });
  const { currentIndex, play, playing, previewProps, seekTo, stop } = sequencePlayer;
  const previewSegment = segments[currentIndex] ?? selectedSegment ?? segments[0];
  const previewAudio = sourceAudioState(previewSegment?.fileId, uploadedVideos);
  const anySourceHasAudio = uploadedVideos.some((video) => video.metadata?.has_audio === true);
  // A source known to have no audio stays silent whatever the preference says.
  const previewMuted = muted || previewAudio.hasAudio === false;

  const jumpTo = useCallback(
    (timelineSec: number) => {
      const currentSegments = segmentsRef.current;
      const clamped = clamp(timelineSec, 0, totalDurationRef.current);
      playheadRef.current = clamped;
      setPlayhead(clamped);
      let index = currentSegments.findIndex(
        (segment) =>
          clamped >= segment.offset && clamped < segment.offset + segment.duration,
      );
      if (index < 0) index = Math.max(0, currentSegments.length - 1);
      const segment = currentSegments[index];
      if (!segment) return;
      seekTo(index, segment.trimStart + (clamped - segment.offset) * segment.speed);
    },
    [seekTo],
  );

  const playForward = useCallback(() => {
    setDirection(1);
    play();
  }, [play]);

  const stopPlayback = useCallback(() => {
    setDirection(0);
    stop();
  }, [stop]);

  const playReverse = useCallback(() => {
    stop();
    setDirection(-1);
  }, [stop]);

  // Show the first clip's trimmed start frame instead of the source's frame 0.
  useEffect(() => {
    if (didInitialSeekRef.current || segments.length === 0) return;
    didInitialSeekRef.current = true;
    jumpTo(playheadRef.current);
  }, [segments.length, jumpTo]);

  // Keep the shared player's index valid when Timeline Items are removed.
  useEffect(() => {
    if (segments.length > 0 && currentIndex >= segments.length) {
      const lastIndex = segments.length - 1;
      seekTo(lastIndex, segments[lastIndex].trimStart);
    }
  }, [currentIndex, seekTo, segments]);

  // The shared player stops itself at the end of a non-looping sequence.
  useEffect(() => {
    if (direction === 1 && !playing) setDirection(0);
  }, [direction, playing]);

  // Settle React state on the engine's last position when playback stops.
  useEffect(() => {
    if (direction === 0 && !playing) setPlayhead(playheadRef.current);
  }, [direction, playing]);

  // Reverse is scrub-style: HTML5 video cannot play backwards, so walk the
  // playhead with the video paused and command coarse seeks at most 4 Hz.
  useEffect(() => {
    if (direction !== -1 || totalDuration === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = clamp(playheadRef.current - dt, 0, totalDurationRef.current);
      paintPlayhead(next);

      if (now - lastReverseSeekRef.current > 1000 / REVERSE_SEEK_HZ) {
        lastReverseSeekRef.current = now;
        const segs = segmentsRef.current;
        let idx = segs.findIndex((seg) => next >= seg.offset && next < seg.offset + seg.duration);
        if (idx < 0) idx = 0;
        const seg = segs[idx];
        if (seg) {
          seekTo(idx, seg.trimStart + (next - seg.offset) * seg.speed);
        }
      }

      if (next <= 0) {
        setDirection(0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [direction, totalDuration, paintPlayhead, seekTo]);

  const zoomBy = useCallback((factor: number) => {
    setPxPerSec((p) => clamp(Math.round(p * factor), MIN_PX_PER_SEC, MAX_PX_PER_SEC));
  }, []);

  const selectRelative = useCallback(
    (delta: number) => {
      setSelectedId((cur) => {
        if (timelineItems.length === 0) return cur;
        const i = cur ? timelineItems.findIndex((item) => item.item_id === cur) : -1;
        const ni = clamp(i < 0 ? 0 : i + delta, 0, timelineItems.length - 1);
        return timelineItems[ni].item_id;
      });
    },
    [timelineItems],
  );

  // Keyboard transport, scrubbing, selection, and reordering.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest('button, a, select, input, textarea') ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (timelineItems.length === 0) return;

      switch (e.key) {
        case 'l':
        case 'L':
          playForward();
          break;
        case 'k':
        case 'K':
          stopPlayback();
          break;
        case 'j':
        case 'J':
          playReverse();
          break;
        case ' ':
          e.preventDefault();
          if (directionRef.current === 0 && !playing) playForward();
          else stopPlayback();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey && selectedId) {
            const index = timelineItems.findIndex((item) => item.item_id === selectedId);
            if (index > 0) {
              void applyTimelineOperation('reorder', {
                item_id: selectedId,
                to_index: index - 1,
              });
            }
          } else jumpTo(playheadRef.current - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey && selectedId) {
            const index = timelineItems.findIndex((item) => item.item_id === selectedId);
            if (index >= 0 && index < timelineItems.length - 1) {
              void applyTimelineOperation('reorder', {
                item_id: selectedId,
                to_index: index + 1,
              });
            }
          } else jumpTo(playheadRef.current + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          selectRelative(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          selectRelative(1);
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedId) {
            void applyTimelineOperation('remove_item', { item_id: selectedId });
            setSelectedId(null);
          }
          break;
        case '+':
        case '=':
          zoomBy(1.25);
          break;
        case '-':
        case '_':
          zoomBy(0.8);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    applyTimelineOperation,
    timelineItems,
    selectedId,
    selectRelative,
    zoomBy,
    jumpTo,
    playForward,
    playReverse,
    playing,
    stopPlayback,
  ]);

  const scrub = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const requested = clamp((clientX - rect.left) / pxPerSecRef.current, 0, totalDurationRef.current);
      const snapThreshold = SNAP_DISTANCE_PX / pxPerSecRef.current;
      const boundaries = segmentsRef.current.flatMap((seg) => [seg.offset, seg.offset + seg.duration]);
      const nearest = boundaries.reduce(
        (best, boundary) =>
          Math.abs(boundary - requested) < Math.abs(best - requested) ? boundary : best,
        requested,
      );
      jumpTo(Math.abs(nearest - requested) <= snapThreshold ? nearest : requested);
    },
    [jumpTo],
  );

  const startScrub = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      stopPlayback();
      scrub(e.clientX);
      const onMove = (event: PointerEvent) => scrub(event.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [scrub, stopPlayback],
  );

  const handleWheelZoom = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const timelineAtPointer = (scroll.scrollLeft + pointerX) / pxPerSecRef.current;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const next = clamp(Math.round(pxPerSecRef.current * factor), MIN_PX_PER_SEC, MAX_PX_PER_SEC);
    setPxPerSec(next);
    requestAnimationFrame(() => {
      scroll.scrollLeft = Math.max(0, timelineAtPointer * next - pointerX);
    });
  }, []);

  const startPreviewResize = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = previewHeight;
    const onMove = (event: PointerEvent) => {
      setPreviewHeight(clamp(startHeight + event.clientY - startY, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT));
    };
    const onUp = (event: PointerEvent) => {
      const height = clamp(startHeight + event.clientY - startY, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT);
      setPreviewHeight(height);
      window.localStorage.setItem(PREVIEW_HEIGHT_KEY, String(height));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [previewHeight]);

  const handleDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left + el.scrollLeft;
      let index = 0;
      for (const seg of segments) {
        if (seg.itemId === dragId) continue;
        const midPx = (seg.offset + seg.duration / 2) * pxPerSec;
        if (pointerX > midPx) index += 1;
      }
      setDropIndex(index);
    },
    [dragId, segments, pxPerSec],
  );

  const handleDrop = useCallback(() => {
    if (dragId && dropIndex !== null) {
      void applyTimelineOperation('reorder', { item_id: dragId, to_index: dropIndex });
    }
    setDragId(null);
    setDropIndex(null);
  }, [applyTimelineOperation, dragId, dropIndex]);

  const startTrim = useCallback(
    (e: ReactMouseEvent, seg: Segment, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      setCanDrag(false);
      setSelectedId(seg.itemId);
      const startX = e.clientX;
      const { itemId, trimStart: origStart, trimEnd: origEnd } = seg;
      const nextBounds = { startSec: origStart, endSec: origEnd };

      const onMove = (ev: MouseEvent) => {
        const deltaSec = ((ev.clientX - startX) / pxPerSec) * seg.speed;
        if (edge === 'left') {
          nextBounds.startSec = round1(
            clamp(origStart + deltaSec, 0, origEnd - MIN_CLIP_DURATION),
          );
        } else {
          nextBounds.endSec = round1(
            clamp(origEnd + deltaSec, origStart + MIN_CLIP_DURATION, Number.POSITIVE_INFINITY),
          );
        }
        setTrimPreview({ itemId, ...nextBounds });
      };
      const onUp = () => {
        if (nextBounds.startSec !== origStart || nextBounds.endSec !== origEnd) {
          void applyTimelineOperation('set_bounds', {
            item_id: itemId,
            start_sec: nextBounds.startSec,
            end_sec: nextBounds.endSec,
          });
        }
        setTrimPreview(null);
        setCanDrag(true);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [applyTimelineOperation, pxPerSec],
  );

  if (timelineItems.length === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="6" width="7" height="5" rx="1" />
            <rect x="14" y="6" width="7" height="5" rx="1" />
            <rect x="3" y="14" width="11" height="5" rx="1" />
          </svg>
        }
        title="Your timeline is empty"
        hint="Pick the clips you want on the Review step, then arrange and trim them here."
        actionLabel="Go to Review"
        actionTo="/review"
      />
    );
  }

  const dropIndicatorPx =
    dropIndex === null
      ? null
      : segments
          .filter((seg) => seg.itemId !== dragId)
          .slice(0, dropIndex)
          .reduce((sum, seg) => sum + seg.duration, 0) * pxPerSec;

  const trackWidth = Math.max(totalDuration * pxPerSec, 1);

  return (
    <div className="timeline">
      {previewSegment && (
          <section
            className="timeline-preview"
            aria-label="Timeline video preview"
            style={{ height: previewHeight }}
          >
          <ClipPreview
            {...previewProps}
            label={previewSegment.fileName}
            scale={previewSegment.scale}
            testId="timeline-preview-video"
            muted={previewMuted}
            volume={volume}
            onAudioBlocked={() => setMuted(true)}
          />
          <div className="timeline-preview-meta">
              <SourceAudioBadge hasAudio={previewAudio.hasAudio} channels={previewAudio.channels} />
              <strong
                data-testid="timeline-preview-current-clip"
                data-timeline-active-item-id={previewSegment.itemId}
              >
                {previewSegment.fileName}
              </strong>
            <span>
              Source {formatClock(previewSegment.trimStart)} → {formatClock(previewSegment.trimEnd)}
            </span>
            <span>
              Timeline {formatClock(previewSegment.offset)} · {previewSegment.duration.toFixed(1)}s
            </span>
          </div>
        </section>
      )}
      <button
        className="timeline-resize-handle"
        type="button"
        aria-label="Resize preview and timeline"
        onPointerDown={startPreviewResize}
      />
      <div className="timeline-toolbar">
        <div className="transport">
          <button type="button"
            className="btn subtle"
            data-testid="transport-reverse"
            onClick={playReverse}
            title="Reverse (J)"
          >
            ◀◀
          </button>
          <button type="button"
            className="btn subtle"
            data-testid="transport-stop"
            onClick={stopPlayback}
            title="Stop (K)"
          >
            ■
          </button>
          <button type="button"
            className="btn subtle"
            data-testid="transport-play"
            onClick={playForward}
            title="Play (L)"
          >
            ▶
          </button>
          <PreviewAudioControl anySourceHasAudio={anySourceHasAudio} />
          <span className="timecode" ref={timecodeRef}>
            {formatClock(playhead)} / {formatClock(totalDuration)}
          </span>
          {currentSegment && (
            <span className="timeline-current" title={currentSegment.fileName}>
              {currentSegment.fileName}
            </span>
          )}
        </div>
        <div className="zoom">
          <button type="button" className="btn subtle" onClick={() => zoomBy(0.8)} title="Zoom out (-)">
            −
          </button>
          <input
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            step={1}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            aria-label="Zoom"
          />
          <button type="button" className="btn subtle" onClick={() => zoomBy(1.25)} title="Zoom in (+)">
            +
          </button>
          <span className="zoom-label">{pxPerSec} px/s</span>
        </div>
      </div>

      <div className="timeline-scroll" ref={scrollRef} onWheel={handleWheelZoom}>
        <div
          className="timeline-track"
          ref={trackRef}
          style={{ width: trackWidth }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="timeline-ruler" onPointerDown={startScrub}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * pxPerSec }}>
                <span className="tick-label">{formatClock(t)}</span>
              </div>
            ))}
          </div>

          <div className="timeline-clips" onPointerDown={startScrub}>
            {segments.map((seg, idx) => {
              const selected = seg.itemId === selectedId;
              const dragging = seg.itemId === dragId;
              const width = seg.duration * pxPerSec;
              return (
                <div
                  key={seg.itemId}
                  data-timeline-item-id={seg.itemId}
                  className={[
                    'tl-clip',
                    selected ? 'selected' : '',
                    dragging ? 'dragging' : '',
                  ]
                    .join(' ')
                    .trim()}
                  style={{
                    left: seg.offset * pxPerSec,
                    width,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(seg.itemId);
                    jumpTo(seg.offset);
                  }}
                  title={`${seg.fileName} — ${seg.duration.toFixed(1)}s`}
                >
                  <div
                    className="tl-trim-handle left"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => startTrim(e, seg, 'left')}
                    title="Trim start"
                  />
                  <div
                    className="tl-clip-body"
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) {
                        e.preventDefault();
                        return;
                      }
                      setDragId(seg.itemId);
                      setSelectedId(seg.itemId);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropIndex(null);
                    }}
                  >
                    <span className="tl-clip-rank">#{idx + 1}</span>
                    <span className="tl-clip-name">{seg.fileName}</span>
                    <span className="tl-clip-dur">{seg.duration.toFixed(1)}s</span>
                  </div>
                  <div
                    className="tl-trim-handle right"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => startTrim(e, seg, 'right')}
                    title="Trim end"
                  />
                </div>
              );
            })}
          </div>

          {dropIndicatorPx !== null && (
            <div className="timeline-drop-indicator" style={{ left: dropIndicatorPx }} />
          )}

          <div
            className="timeline-playhead"
            ref={playheadLineRef}
            style={{ left: playhead * pxPerSec }}
            onPointerDown={startScrub}
          />
        </div>
      </div>

      <p className="timeline-hint">
        Drag clips to reorder · drag edges to trim · drag playhead to scrub · wheel to zoom · <kbd>J</kbd>/<kbd>K</kbd>/
        <kbd>L</kbd> transport · <kbd>↑</kbd>/<kbd>↓</kbd> select · <kbd>Shift</kbd>+<kbd>←</kbd>/
        <kbd>→</kbd> reorder · <kbd>⌫</kbd> remove · <kbd>+</kbd>/<kbd>−</kbd> zoom
      </p>
    </div>
  );
}
