/**
 * One preview-audio preference for the whole app (plan 026).
 *
 * Review cards and the Timeline player must never disagree about whether sound
 * is on, so the state lives in a module-level store rather than in per-component
 * `useState` seeded from storage.
 */
import { useCallback, useSyncExternalStore } from 'react';

const PREVIEW_AUDIO_KEY = 'ai-clip-assembler:preview-audio:v1';
const DEFAULT_STATE: PreviewAudioState = { muted: true, volume: 0.8 };

export interface PreviewAudioState {
  muted: boolean;
  volume: number;
}

function clampVolume(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STATE.volume;
  return Math.max(0, Math.min(1, numeric));
}

function readStoredState(): PreviewAudioState {
  // Corrupt or absent storage must degrade to the default, never throw: this
  // runs during the first render of every preview surface.
  try {
    const raw = window.localStorage.getItem(PREVIEW_AUDIO_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE;
    const candidate = parsed as Partial<PreviewAudioState>;
    return {
      muted: typeof candidate.muted === 'boolean' ? candidate.muted : DEFAULT_STATE.muted,
      volume: clampVolume(candidate.volume),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

let state: PreviewAudioState = readStoredState();
const listeners = new Set<() => void>();

function setState(next: PreviewAudioState) {
  if (next.muted === state.muted && next.volume === state.volume) return;
  state = next;
  try {
    window.localStorage.setItem(PREVIEW_AUDIO_KEY, JSON.stringify(state));
  } catch {
    // A full or unavailable store costs persistence, not this session's audio.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewAudio() {
  const current = useSyncExternalStore(subscribe, () => state);
  const setMuted = useCallback((muted: boolean) => setState({ ...state, muted }), []);
  const setVolume = useCallback(
    (volume: number) => setState({ ...state, volume: clampVolume(volume) }),
    [],
  );
  return { muted: current.muted, volume: current.volume, setMuted, setVolume };
}

export const previewAudioStorageKey = PREVIEW_AUDIO_KEY;
