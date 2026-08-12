// These are the characters this boundary deliberately removes from labels.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const MAX_RECENT_PROJECT_NAME_LENGTH = 80;

export function normalizeRecentProjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.replace(CONTROL_CHARACTERS, '').trim();
  if (!normalized) return null;

  return Array.from(normalized).slice(0, MAX_RECENT_PROJECT_NAME_LENGTH).join('');
}
