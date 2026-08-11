/**
 * Update availability check against GitHub Releases.
 *
 * The DMGs are unsigned and un-notarized, so electron-updater's silent install
 * path cannot work on macOS. This module only *notices* that a newer release
 * exists and lets the app point the user at the release page; the download and
 * install stay a deliberate human step (see `scripts/app-wizard.sh`).
 *
 * Everything that touches the network or disk is injected so the decision logic
 * stays unit-testable.
 */

import type { UpdateStatus } from '../shared/updateStatus.js';

export type { UpdateStatus };

export const UPDATE_REPO = 'evilkels/ai-clip-assembler';
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;

/** Only URLs matching this prefix are ever handed to `shell.openExternal`. */
export const RELEASE_URL_PREFIX = `https://github.com/${UPDATE_REPO}/releases`;

const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

export interface ReleaseSummary {
  /** Release tag, e.g. `v0.1.4`. */
  tag: string;
  /** Human-facing release page. */
  url: string;
  publishedAt?: string;
}

export interface UpdateCheckState {
  lastCheckedAt?: string;
  dismissedVersion?: string;
  release?: ReleaseSummary;
}

interface ParsedVersion {
  numbers: number[];
  /** Prerelease identifier (`-beta.1`), absent for final releases. */
  prerelease?: string;
}

/**
 * Parses `v0.1.4`, `0.1.4`, `0.2` and `1.0.0-beta.2`. Returns null for anything
 * else so callers can degrade to `unknown` rather than guess.
 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  const numbers = match[1].split('.').map((part) => Number.parseInt(part, 10));
  if (numbers.some((part) => Number.isNaN(part))) return null;
  return match[2] ? { numbers, prerelease: match[2] } : { numbers };
}

/** Returns a negative number when `a` is older than `b`, 0 when equal. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.numbers[index] ?? 0;
    const right = b.numbers[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  // A prerelease precedes the final release of the same numbers (semver rule).
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease && a.prerelease !== b.prerelease) {
    return a.prerelease < b.prerelease ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const parsedCandidate = parseVersion(candidate);
  const parsedCurrent = parseVersion(current);
  if (!parsedCandidate || !parsedCurrent) return false;
  return compareVersions(parsedCurrent, parsedCandidate) < 0;
}

/** Strips the leading `v` so tags and `app.getVersion()` compare like for like. */
export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, '');
}

export function evaluateRelease(input: {
  currentVersion: string;
  release?: ReleaseSummary;
  dismissedVersion?: string;
}): UpdateStatus {
  const { currentVersion, release, dismissedVersion } = input;
  if (!release) {
    return { state: 'unknown', currentVersion, detail: 'No release information available yet.' };
  }
  const latestVersion = normalizeVersion(release.tag);
  if (!parseVersion(latestVersion)) {
    return { state: 'unknown', currentVersion, detail: `Unrecognized release tag "${release.tag}".` };
  }
  if (!isNewerVersion(latestVersion, currentVersion)) {
    return { state: 'up-to-date', currentVersion, latestVersion };
  }
  if (dismissedVersion && normalizeVersion(dismissedVersion) === latestVersion) {
    return { state: 'dismissed', currentVersion, latestVersion };
  }
  return {
    state: 'update-available',
    currentVersion,
    latestVersion,
    releaseUrl: release.url,
  };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Reads the newest published release. Draft and prerelease entries are excluded
 * by GitHub's `releases/latest` endpoint, which is what we want here.
 */
export async function fetchLatestRelease(fetchImpl: FetchLike): Promise<ReleaseSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-clip-assembler',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      published_at?: unknown;
    };
    if (typeof payload.tag_name !== 'string' || payload.tag_name.length === 0) {
      throw new Error('Release payload had no tag_name');
    }
    const url =
      typeof payload.html_url === 'string' && payload.html_url.startsWith(RELEASE_URL_PREFIX)
        ? payload.html_url
        : RELEASES_PAGE_URL;
    return {
      tag: payload.tag_name,
      url,
      ...(typeof payload.published_at === 'string' ? { publishedAt: payload.published_at } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface UpdateChecker {
  check(options?: { force?: boolean }): Promise<UpdateStatus>;
  dismiss(version: string): Promise<UpdateStatus>;
  /** Release URL from the last successful check, or the generic releases page. */
  releaseUrl(): Promise<string>;
}

export interface UpdateCheckerDeps {
  currentVersion: string;
  readState: () => Promise<UpdateCheckState>;
  writeState: (state: UpdateCheckState) => Promise<void>;
  fetchRelease: () => Promise<ReleaseSummary>;
  now?: () => number;
  checkIntervalMs?: number;
}

export function createUpdateChecker(deps: UpdateCheckerDeps): UpdateChecker {
  const {
    currentVersion,
    readState,
    writeState,
    fetchRelease,
    now = () => Date.now(),
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  } = deps;

  const isCacheFresh = (state: UpdateCheckState): boolean => {
    if (!state.release || !state.lastCheckedAt) return false;
    const checkedAt = Date.parse(state.lastCheckedAt);
    if (Number.isNaN(checkedAt)) return false;
    return now() - checkedAt < checkIntervalMs;
  };

  return {
    async check(options) {
      const state = await readState();
      if (!options?.force && isCacheFresh(state)) {
        return evaluateRelease({
          currentVersion,
          release: state.release,
          dismissedVersion: state.dismissedVersion,
        });
      }

      let release: ReleaseSummary;
      try {
        release = await fetchRelease();
      } catch (error) {
        // Offline or rate-limited: fall back to whatever we last saw rather
        // than surfacing an error the user can do nothing about.
        if (state.release) {
          return evaluateRelease({
            currentVersion,
            release: state.release,
            dismissedVersion: state.dismissedVersion,
          });
        }
        return {
          state: 'unknown',
          currentVersion,
          detail: error instanceof Error ? error.message : String(error),
        };
      }

      // A dismissal only silences the version it was made against.
      const dismissedVersion =
        state.dismissedVersion && normalizeVersion(state.dismissedVersion) === normalizeVersion(release.tag)
          ? state.dismissedVersion
          : undefined;

      await writeState({
        lastCheckedAt: new Date(now()).toISOString(),
        release,
        ...(dismissedVersion ? { dismissedVersion } : {}),
      });

      return evaluateRelease({ currentVersion, release, dismissedVersion });
    },

    async dismiss(version) {
      const state = await readState();
      const next: UpdateCheckState = { ...state, dismissedVersion: normalizeVersion(version) };
      await writeState(next);
      return evaluateRelease({
        currentVersion,
        release: next.release,
        dismissedVersion: next.dismissedVersion,
      });
    },

    async releaseUrl() {
      const state = await readState();
      const url = state.release?.url;
      return url && url.startsWith(RELEASE_URL_PREFIX) ? url : RELEASES_PAGE_URL;
    },
  };
}
