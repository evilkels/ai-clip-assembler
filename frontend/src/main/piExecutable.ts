import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const PI_BIN_RESOLUTION_MARKER = '__AI_CLIP_ASSEMBLER_PI_BIN__=';

async function validateExecutableFile(candidate: string): Promise<void> {
  const candidateStat = await stat(candidate);
  if (!candidateStat.isFile()) throw new Error('Pi executable candidate is not a file');
  await access(candidate, constants.X_OK);
}

export async function resolvePiExecutableFromShellOutput(
  stdout: string,
  validateExecutable: (candidate: string) => Promise<void> = validateExecutableFile,
): Promise<string | undefined> {
  const markerLine = stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith(PI_BIN_RESOLUTION_MARKER));
  const candidate = markerLine?.slice(PI_BIN_RESOLUTION_MARKER.length).trim();
  if (!candidate || !isAbsolute(candidate)) return undefined;

  try {
    await validateExecutable(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}
