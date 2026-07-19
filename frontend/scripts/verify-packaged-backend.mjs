import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontendDir = join(import.meta.dirname, '..');
const repoRoot = join(frontendDir, '..');

const requiredFiles = [
  join(repoRoot, 'backend', 'packaging', 'entry.py'),
  join(repoRoot, 'backend', 'packaging', 'backend.spec'),
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing packaged backend file: ${file}`);
  }
}

const packageJson = JSON.parse(readFileSync(join(frontendDir, 'package.json'), 'utf-8'));
const requiredPiDependencies = [
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
];
for (const packageName of requiredPiDependencies) {
  if (packageJson.dependencies?.[packageName] !== '0.80.10') {
    throw new Error(`frontend/package.json must pin ${packageName} to exactly 0.80.10`);
  }
}

const resources = packageJson.build?.extraResources ?? [];
const hasBackendResource = resources.some(
  (resource) => resource.from === '../backend/dist/ai-clip-backend' && resource.to === 'backend',
);

if (!hasBackendResource) {
  throw new Error('frontend/package.json must ship ../backend/dist/ai-clip-backend as resources/backend');
}

const mainSource = readFileSync(join(frontendDir, 'src', 'main', 'index.ts'), 'utf-8');
for (const snippet of [
  'startPackagedBackend',
  'CLIP_ASSEMBLER_PORT',
  'resolvePiBinFromLoginShell',
  'whence -p pi',
  'PI_BIN',
  'process.resourcesPath',
  "app.getPath('userData')",
  'additionalArguments',
  'clip-assembler-backend-url',
]) {
  if (!mainSource.includes(snippet)) {
    throw new Error(`Electron main process is missing packaged backend support: ${snippet}`);
  }
}

const preloadSource = readFileSync(join(frontendDir, 'src', 'preload', 'index.ts'), 'utf-8');
if (!preloadSource.includes('clip-assembler-backend-url')) {
  throw new Error('preload must read the packaged backend URL from BrowserWindow additionalArguments');
}

const mainBundlePath = join(frontendDir, 'out', 'main', 'index.js');
if (!existsSync(mainBundlePath)) {
  throw new Error('Missing built Electron main bundle: out/main/index.js');
}
const mainBundle = readFileSync(mainBundlePath, 'utf-8');
for (const marker of ['@earendil-works/pi-coding-agent', 'ReviewModelAuthController']) {
  if (!mainBundle.includes(marker)) {
    throw new Error(`Built Electron main bundle is missing review-model auth marker: ${marker}`);
  }
}

const rendererHtml = readFileSync(join(frontendDir, 'src', 'renderer', 'index.html'), 'utf-8');
for (const snippet of ['connect-src', 'http://127.0.0.1:*', 'http://localhost:*']) {
  if (!rendererHtml.includes(snippet)) {
    throw new Error(`renderer CSP must allow packaged backend connections: ${snippet}`);
  }
}
