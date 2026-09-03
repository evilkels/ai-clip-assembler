import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const PI_BIN_RESOLUTION_MARKER = '__AI_CLIP_ASSEMBLER_PI_BIN__=';

// `whence -p` skips shell functions and aliases, so the marker only ever
// carries a real executable path.
export const PI_SHELL_PROBE_COMMAND =
  `printf '\\n${PI_BIN_RESOLUTION_MARKER}%s\\n' "$(whence -p pi 2>/dev/null)"`;

// Finder and Dock launches start the app with a minimal PATH, so we ask the
// user's shell where `pi` lives. Version managers (nvm, volta, asdf) export
// their PATH entry from ~/.zshrc, which a *non-interactive* login shell never
// sources — so the interactive login probe comes first, with the plain login
// shell kept as a retry for setups whose interactive rc files fail or hang.
export const PI_SHELL_PROBE_ARGUMENTS: readonly (readonly string[])[] = [
  ['-lic', PI_SHELL_PROBE_COMMAND],
  ['-lc', PI_SHELL_PROBE_COMMAND],
];

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

/** Well-known install locations to try when the shell probe comes back empty. */
export async function piExecutableCandidates(
  home: string,
  readDirectory: (path: string) => Promise<string[]> = readdir,
): Promise<string[]> {
  const candidates = [
    join(home, '.local', 'bin', 'pi'),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi',
    join(home, '.bun', 'bin', 'pi'),
    join(home, '.volta', 'bin', 'pi'),
  ];
  // nvm keeps one bin directory per installed Node version and puts none of
  // them on a GUI app's PATH. Newest version first so a current install wins.
  const nvmVersions = join(home, '.nvm', 'versions', 'node');
  try {
    const versions = await readDirectory(nvmVersions);
    // Numeric-aware compare: a plain lexicographic sort puts v9 above v24,
    // which is the opposite of "newest first".
    const newestFirst = [...versions].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    for (const version of newestFirst) {
      candidates.push(join(nvmVersions, version, 'bin', 'pi'));
    }
  } catch {
    // No nvm installation — nothing to add.
  }
  return candidates;
}

export async function firstExecutableCandidate(
  candidates: readonly string[],
  validateExecutable: (candidate: string) => Promise<void> = validateExecutableFile,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await validateExecutable(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}
