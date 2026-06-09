import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
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

  const trackRef = useRef<HTMLDivElement>(null);

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
  const previewSegment = currentSegment ?? selectedSegment ?? segments[0];
  const previewRelativeTime =
    previewSegment && currentSegment?.clip.clip_id === previewSegment.clip.clip_id
      ? clamp(playhead - previewSegment.offset, 0, previewSegment.duration)
      : 0;
  const previewSourceTime = previewSegment
    ? previewSegment.trimStart + previewRelativeTime
    : 0;
  const previewMediaUrl =
    projectId && previewSegment
      ? buildVideoMediaUrl(projectId, previewSegment.clip.file_id)
      : undefined;

  // Keep the playhead inside the timeline when durations change.
  useEffect(() => {
    setPlayhead((p) => clamp(p, 0, totalDuration));
  }, [totalDuration]);

  // Transport: advance the playhead while playing.
  useEffect(() => {
    if (direction === 0 || totalDuration === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((p) => {
        const next = p + dt * direction;
        if (next <= 0) {
          setDirection(0);
          return 0;
        }
        if (next >= totalDuration) {
          setDirection(0);
          return totalDuration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [direction, totalDuration]);

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
          else setPlayhead((p) => clamp(p - 1, 0, totalDuration));
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey && selectedId) moveAccepted(selectedId, 1);
          else setPlayhead((p) => clamp(p + 1, 0, totalDuration));
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
    totalDuration,
    moveAccepted,
    resetDecision,
    selectRelative,
    zoomBy,
  ]);

  const scrub = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      setPlayhead(clamp(x / pxPerSec, 0, totalDuration));
    },
    [pxPerSec, totalDuration],
  );

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
    (e: ReactPointerEvent, seg: Segment, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      setCanDrag(false);
      setSelectedId(seg.clip.clip_id);
      const startX = e.clientX;
      const { clip, trimStart: origStart, trimEnd: origEnd } = seg;

      const onMove = (ev: PointerEvent) => {
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
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
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
        <section className="timeline-preview" aria-label="Timeline video preview">
          <ClipPreview
            mediaUrl={previewMediaUrl}
            startSec={previewSegment.trimStart}
            endSec={previewSegment.trimEnd}
            currentTimeSec={previewSourceTime}
            playing={direction === 1 && currentSegment?.clip.clip_id === previewSegment.clip.clip_id}
            loop={false}
            label={previewSegment.clip.file_name}
            testId="timeline-preview-video"
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
      <div className="timeline-toolbar">
        <div className="transport">
          <button className="btn subtle" onClick={() => setDirection(-1)} title="Reverse (J)">
            ◀◀
          </button>
          <button className="btn subtle" onClick={() => setDirection(0)} title="Stop (K)">
            ■
          </button>
          <button className="btn subtle" onClick={() => setDirection(1)} title="Play (L)">
            ▶
          </button>
          <span className="timecode">
            {formatTime(playhead)} / {formatTime(totalDuration)}
          </span>
          {currentSegment && (
            <span className="timeline-current" title={currentSegment.clip.file_name}>
              {currentSegment.clip.file_name}
            </span>
          )}
        </div>
        <div className="zoom">
          <button className="btn subtle" onClick={() => zoomBy(0.8)} title="Zoom out (-)">
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
          <button className="btn subtle" onClick={() => zoomBy(1.25)} title="Zoom in (+)">
            +
          </button>
          <span className="zoom-label">{pxPerSec} px/s</span>
        </div>
      </div>

      <div className="timeline-scroll">
        <div
          className="timeline-track"
          ref={trackRef}
          style={{ width: trackWidth }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="timeline-ruler" onPointerDown={(e) => scrub(e.clientX)}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * pxPerSec }}>
                <span className="tick-label">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          <div className="timeline-clips" onPointerDown={(e) => scrub(e.clientX)}>
            {segments.map((seg, idx) => {
              const selected = seg.clip.clip_id === selectedId;
              const dragging = seg.clip.clip_id === dragId;
              const width = seg.duration * pxPerSec;
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
                  style={{ width }}
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
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(seg.clip.clip_id);
                    setPlayhead(seg.offset);
                  }}
                  title={`${seg.clip.file_name} — ${seg.duration.toFixed(1)}s`}
                >
                  <div
                    className="tl-trim-handle left"
                    onPointerDown={(e) => startTrim(e, seg, 'left')}
                    title="Trim start"
                  />
                  <div className="tl-clip-body">
                    <span className="tl-clip-rank">#{idx + 1}</span>
                    <span className="tl-clip-name">{seg.clip.file_name}</span>
                    <span className="tl-clip-dur">{seg.duration.toFixed(1)}s</span>
                  </div>
                  <div
                    className="tl-trim-handle right"
                    onPointerDown={(e) => startTrim(e, seg, 'right')}
                    title="Trim end"
                  />
                </div>
              );
            })}
          </div>

          {dropIndicatorPx !== null && (
            <div className="timeline-drop-indicator" style={{ left: dropIndicatorPx }} />
          )}

          <div className="timeline-playhead" style={{ left: playhead * pxPerSec }} />
        </div>
      </div>

      <p className="timeline-hint">
        Drag clips to reorder · drag edges to trim · click to scrub · <kbd>J</kbd>/<kbd>K</kbd>/
        <kbd>L</kbd> transport · <kbd>↑</kbd>/<kbd>↓</kbd> select · <kbd>Shift</kbd>+<kbd>←</kbd>/
        <kbd>→</kbd> reorder · <kbd>⌫</kbd> remove · <kbd>+</kbd>/<kbd>−</kbd> zoom
      </p>
    </div>
  );
}
