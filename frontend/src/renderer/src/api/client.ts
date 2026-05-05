/**
 * Typed frontend API boundary.
 *
 * For the MVP we read mock clip JSON. Once backend #5 lands, swap `getClips`
 * to fetch from `${backendUrl}/projects/:id/clips` — the response shape is
 * already typed via `ClipCandidate` / `ProjectClipsResponse`.
 */

import type { ProjectClipsResponse, ClipCandidate } from '../types/clip';
import { mockClips } from './mockClips';

declare global {
  interface Window {
    clipAssembler?: {
      backendUrl: string;
      platform: string;
    };
  }
}

const backendUrl = (): string =>
  window.clipAssembler?.backendUrl ?? 'http://127.0.0.1:8000';

export interface BackendStatus {
  online: boolean;
  version?: string;
}

export async function pingBackend(): Promise<BackendStatus> {
  try {
    const res = await fetch(`${backendUrl()}/`, { cache: 'no-store' });
    if (!res.ok) return { online: false };
    const data = (await res.json()) as { version?: string };
    return { online: true, version: data.version };
  } catch {
    return { online: false };
  }
}

export interface GetClipsOptions {
  projectId?: string;
  useMock?: boolean;
}

export async function getClips(
  options: GetClipsOptions = {},
): Promise<ClipCandidate[]> {
  const { projectId, useMock = true } = options;

  if (useMock || !projectId) {
    return mockClips;
  }

  const res = await fetch(`${backendUrl()}/projects/${projectId}/clips`);
  if (!res.ok) {
    throw new Error(`Failed to load clips: ${res.status}`);
  }
  const data = (await res.json()) as ProjectClipsResponse;
  return data.clips;
}
