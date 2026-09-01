import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(frontendDir, '..');
const sourceDir = join(repoRoot, 'assets');
const fontLicenseSource = join(frontendDir, 'src', 'renderer', 'src', 'assets', 'fonts', 'LICENSE.txt');
const targets = [join(frontendDir, 'build'), join(frontendDir, 'out', 'renderer', 'build')];

if (!existsSync(sourceDir)) {
  throw new Error(`Brand assets directory not found: ${sourceDir}`);
}

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const assetPath of readdirSync(sourceDir, { recursive: true })) {
    if (basename(assetPath.toString()).startsWith('.')) continue;
    const source = join(sourceDir, assetPath.toString());
    const destination = join(target, assetPath.toString());
    cpSync(source, destination, { recursive: true });
  }

  // Keep the bundled IBM Plex license beside the staged app assets. The
  // renderer's font faces are emitted by Vite into out/renderer/assets, while
  // this staged notice is included by electron-builder's existing `out/**/*`
  // and `build` extraResources rules.
  const fontLicenseDestination = join(target, 'fonts', 'LICENSE.txt');
  mkdirSync(dirname(fontLicenseDestination), { recursive: true });
  cpSync(fontLicenseSource, fontLicenseDestination);
}
