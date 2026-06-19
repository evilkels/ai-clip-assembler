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
import { buildVideoMediaUrl } from '../api/client';
import { useReview } from '../state/ReviewContext';
import type { ClipCandidate } from '../types/clip';
import { ClipPreview } from './ClipPreview';

const MIN_PX_PER_SEC = 6;
const MAX_PX_PER_SEC = 160;
const MIN_CLIP_DURATION = 0.1;
const TICK_TARGET_PX = 80;
const NICE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const PLAYHEAD_THROTTLE_MS = 150;
const REVERSE_SEEK_HZ = 4;
const SEGMENT_END_EPSILON = 0.05;
const SNAP_DISTANCE_PX = 10;
const PREVIEW_HEIGHT_KEY = 'ai-clip-assembler:timeline-preview-height:v1';
const MIN_PREVIEW_HEIGHT = 220;
const MAX_PREVIEW_HEIGHT = 720;

interface Segment {
  clip: ClipCandidate;
  trimStart: number;
  trimEnd: number;
  duration: number;
  offset: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatTime(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = (safe - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function niceStep(pxPerSec: number): number {
  const raw = TICK_TARGET_PX / pxPerSec;
  return NICE_STEPS.find((step) => step >= raw) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

export function Timeline() {
  const { projectId, clips, acceptedOrder, trims, reorderAccepted, moveAccepted, setTrim, resetDecision } =
    useReview();

  const [pxPerSec, setPxPerSec] = useState(40);
  const [playhead, setPlayhead] = useState(0);
  const [direction, setDirection] = useState<-1 | 0 | 1>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [canDrag, setCanDrag] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [seek, setSeek] = useState<{ time: number; epoch: number }>({ time: 0, epoch: 0 });
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
  const advanceLockRef = useRef(false);
  const didInitialSeekRef = useRef(false);

  const acceptedClips = useMemo(() => {
    const byId = new Map(clips.map((clip) => [clip.clip_id, clip]));
    return acceptedOrder
      .map((id) => byId.get(id))
      .filter((c): c is ClipCandidate => Boolean(c));
  }, [acceptedOrder, clips]);

  const segments = useMemo<Segment[]>(() => {
    let offset = 0;
    return acceptedClips.map((clip) => {
      const trim = trims[clip.clip_id];
      const trimStart = trim?.start_sec ?? clip.start_sec;
      const trimEnd = trim?.end_sec ?? clip.end_sec;
      const duration = Math.max(MIN_CLIP_DURATION, trimEnd - trimStart);
      const seg: Segment = { clip, trimStart, trimEnd, duration, offset };
      offset += duration;
      return seg;
    });
  }, [acceptedClips, trims]);

  const totalDuration = segments.length
    ? segments[segments.length - 1].offset + segments[segments.length - 1].duration
    : 0;

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
    ? segments.find((seg) => seg.clip.clip_id === selectedId)
    : undefined;
  const previewSegment = segments[currentIndex] ?? selectedSegment ?? segments[0];
  const previewMediaUrl =
    projectId && previewSegment
      ? buildVideoMediaUrl(projectId, previewSegment.clip.file_id)
      : undefined;

  // Keep the playhead inside the timeline when durations change.
  useEffect(() => {
    setPlayhead((p) => {
      const clamped = clamp(p, 0, totalDuration);
      playheadRef.current = clamped;
      return clamped;
    });
  }, [totalDuration]);

  // Keep currentIndex valid when clips are removed.
  useEffect(() => {
    if (segments.length > 0 && currentIndex >= segments.length) {
      setCurrentIndex(segments.length - 1);
    }
  }, [segments.length, currentIndex]);

  const paintPlayhead = useCallback((timelineSec: number) => {
    playheadRef.current = timelineSec;
    if (playheadLineRef.current) {
      playheadLineRef.current.style.left = `${timelineSec * pxPerSecRef.current}px`;
    }
    if (timecodeRef.current) {
      timecodeRef.current.textContent = `${formatTime(timelineSec)} / ${formatTime(totalDurationRef.current)}`;
    }
    const now = performance.now();
    if (now - lastPlayheadSetRef.current > PLAYHEAD_THROTTLE_MS) {
      lastPlayheadSetRef.current = now;
      setPlayhead(timelineSec);
    }
  }, []);

  // Explicit jump: position playhead and command the video to the same spot.
  const jumpTo = useCallback((timelineSec: number) => {
    const segs = segmentsRef.current;
    const clamped = clamp(timelineSec, 0, totalDurationRef.current);
    playheadRef.current = clamped;
    advanceLockRef.current = false;
    setPlayhead(clamped);
    let idx = segs.findIndex((seg) => clamped >= seg.offset && clamped < seg.offset + seg.duration);
    if (idx < 0) idx = Math.max(0, segs.length - 1);
    const seg = segs[idx];
    if (!seg) return;
    setCurrentIndex(idx);
    setSeek((prev) => ({ time: seg.trimStart + (clamped - seg.offset), epoch: prev.epoch + 1 }));
  }, []);

  // Show the first clip's trimmed start frame instead of the source's frame 0.
  useEffect(() => {
    if (didInitialSeekRef.current || segments.length === 0) return;
    didInitialSeekRef.current = true;
    jumpTo(playheadRef.current);
  }, [segments.length, jumpTo]);

  // Settle React state on the engine's last position when playback stops.
  useEffect(() => {
    if (direction === 0) setPlayhead(playheadRef.current);
  }, [direction]);

  // Forward play: the video drives the playhead; at a segment's trim end,
  // advance to the next segment (same file → cheap seek; different file →
  // src swap + seek, resumed by the playing prop).
  const onPlaybackTime = useCallback(
    (sourceTimeSec: number) => {
      if (directionRef.current !== 1) return;
      const segs = segmentsRef.current;
      const seg = segs[currentIndex];
      if (!seg) return;

      if (sourceTimeSec >= seg.trimEnd - SEGMENT_END_EPSILON) {
        // Advance once per boundary; the lock swallows RAF ticks that land
        // before the commanded seek does.
        if (advanceLockRef.current) return;
        advanceLockRef.current = true;
        const nextIdx = currentIndex + 1;
        if (nextIdx >= segs.length) {
          playheadRef.current = totalDurationRef.current;
          setPlayhead(totalDurationRef.current);
          setDirection(0);
          return;
        }
        setCurrentIndex(nextIdx);
        setSeek((prev) => ({ time: segs[nextIdx].trimStart, epoch: prev.epoch + 1 }));
        return;
      }
      advanceLockRef.current = false;

      // Clamp so a not-yet-seeked video (e.g. a cross-file load still at 0)
      // cannot drag the playhead outside the current segment.
      paintPlayhead(
        clamp(seg.offset + (sourceTimeSec - seg.trimStart), seg.offset, seg.offset + seg.duration),
      );
    },
    [currentIndex, paintPlayhead],
  );

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
          setCurrentIndex(idx);
          setSeek((prev) => ({ time: seg.trimStart + (next - seg.offset), epoch: prev.epoch + 1 }));
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
  }, [direction, totalDuration, paintPlayhead]);

  const zoomBy = useCallback((factor: number) => {
    setPxPerSec((p) => clamp(Math.round(p * factor), MIN_PX_PER_SEC, MAX_PX_PER_SEC));
  }, []);

  const selectRelative = useCallback(
    (delta: number) => {
      setSelectedId((cur) => {
        if (acceptedOrder.length === 0) return cur;
        const i = cur ? acceptedOrder.indexOf(cur) : -1;
        const ni = clamp(i < 0 ? 0 : i + delta, 0, acceptedOrder.length - 1);
        return acceptedOrder[ni];
      });
    },
    [acceptedOrder],
  );

  // Keyboard transport, scrubbing, selection, and reordering.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (acceptedClips.length === 0) return;

      switch (e.key) {
        case 'l':
        case 'L':
          setDirection(1);
          break;
        case 'k':
        case 'K':
          setDirection(0);
          break;
        case 'j':
        case 'J':
          setDirection(-1);
          break;
        case ' ':
          e.preventDefault();
          setDirection((d) => (d === 0 ? 1 : 0));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey && selectedId) moveAccepted(selectedId, -1);
          else jumpTo(playheadRef.current - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey && selectedId) moveAccepted(selectedId, 1);
          else jumpTo(playheadRef.current + 1);
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
            resetDecision(selectedId);
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
    acceptedClips.length,
    selectedId,
    moveAccepted,
    resetDecision,
    selectRelative,
    zoomBy,
    jumpTo,
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
      setDirection(0);
      scrub(e.clientX);
      const onMove = (event: PointerEvent) => scrub(event.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [scrub],
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
        if (seg.clip.clip_id === dragId) continue;
        const midPx = (seg.offset + seg.duration / 2) * pxPerSec;
        if (pointerX > midPx) index += 1;
      }
      setDropIndex(index);
    },
    [dragId, segments, pxPerSec],
  );

  const handleDrop = useCallback(() => {
    if (dragId && dropIndex !== null) reorderAccepted(dragId, dropIndex);
    setDragId(null);
    setDropIndex(null);
  }, [dragId, dropIndex, reorderAccepted]);

  const startTrim = useCallback(
    (e: ReactMouseEvent, seg: Segment, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      setCanDrag(false);
      setSelectedId(seg.clip.clip_id);
      const startX = e.clientX;
      const { clip, trimStart: origStart, trimEnd: origEnd } = seg;

      const onMove = (ev: MouseEvent) => {
        const deltaSec = (ev.clientX - startX) / pxPerSec;
        if (edge === 'left') {
          const next = clamp(origStart + deltaSec, clip.start_sec, origEnd - MIN_CLIP_DURATION);
          setTrim(clip.clip_id, { start_sec: round1(next), end_sec: origEnd });
        } else {
          const next = clamp(origEnd + deltaSec, origStart + MIN_CLIP_DURATION, clip.end_sec);
          setTrim(clip.clip_id, { start_sec: origStart, end_sec: round1(next) });
        }
      };
      const onUp = () => {
        setCanDrag(true);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [pxPerSec, setTrim],
  );

  if (acceptedClips.length === 0) {
    return (
      <div className="empty-state">
        No clips on the timeline yet. Accept keepers on the Review tab to assemble a sequence.
      </div>
    );
  }

  const dropIndicatorPx =
    dropIndex === null
      ? null
      : segments
          .filter((seg) => seg.clip.clip_id !== dragId)
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
            mediaUrl={previewMediaUrl}
            startSec={previewSegment.trimStart}
            endSec={previewSegment.trimEnd}
            playing={direction === 1}
            loop={false}
            label={previewSegment.clip.file_name}
            testId="timeline-preview-video"
            controls={false}
            seek={seek}
            onPlaybackTime={onPlaybackTime}
          />
          <div className="timeline-preview-meta">
            <strong data-testid="timeline-preview-current-clip">
              {previewSegment.clip.file_name}
            </strong>
            <span>
              Source {formatTime(previewSegment.trimStart)} → {formatTime(previewSegment.trimEnd)}
            </span>
            <span>
              Timeline {formatTime(previewSegment.offset)} · {previewSegment.duration.toFixed(1)}s
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
            onClick={() => setDirection(-1)}
            title="Reverse (J)"
          >
            ◀◀
          </button>
          <button type="button"
            className="btn subtle"
            data-testid="transport-stop"
            onClick={() => setDirection(0)}
            title="Stop (K)"
          >
            ■
          </button>
          <button type="button"
            className="btn subtle"
            data-testid="transport-play"
            onClick={() => setDirection(1)}
            title="Play (L)"
          >
            ▶
          </button>
          <span className="timecode" ref={timecodeRef}>
            {formatTime(playhead)} / {formatTime(totalDuration)}
          </span>
          {currentSegment && (
            <span className="timeline-current" title={currentSegment.clip.file_name}>
              {currentSegment.clip.file_name}
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
                <span className="tick-label">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          <div className="timeline-clips" onPointerDown={startScrub}>
            {segments.map((seg, idx) => {
              const selected = seg.clip.clip_id === selectedId;
              const dragging = seg.clip.clip_id === dragId;
              const width = seg.duration * pxPerSec;
              const leftTrimPx = Math.max(0, seg.trimStart - seg.clip.start_sec) * pxPerSec;
              return (
                <div
                  key={seg.clip.clip_id}
                  className={[
                    'tl-clip',
                    selected ? 'selected' : '',
                    dragging ? 'dragging' : '',
                  ]
                    .join(' ')
                    .trim()}
                  style={{
                    width,
                    transform: `translateX(${leftTrimPx}px)`,
                    marginRight: leftTrimPx,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(seg.clip.clip_id);
                    jumpTo(seg.offset);
                  }}
                  title={`${seg.clip.file_name} — ${seg.duration.toFixed(1)}s`}
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
                      setDragId(seg.clip.clip_id);
                      setSelectedId(seg.clip.clip_id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropIndex(null);
                    }}
                  >
                    <span className="tl-clip-rank">#{idx + 1}</span>
                    <span className="tl-clip-name">{seg.clip.file_name}</span>
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
