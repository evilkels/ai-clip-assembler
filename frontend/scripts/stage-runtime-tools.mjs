import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(process.env.CLIP_ASSEMBLER_RUNTIME_TOOLS_OUT ?? join(frontendDir, 'build', 'runtime-tools'));
const ffmpegPath = resolve(process.env.CLIP_ASSEMBLER_FFMPEG_BIN ?? '');

if (!process.env.CLIP_ASSEMBLER_FFMPEG_BIN) {
  throw new Error('CLIP_ASSEMBLER_FFMPEG_BIN must point to the vetted FFmpeg binary staged by CI.');
}

const ffprobePath = join(dirname(ffmpegPath), 'ffprobe');
if (!existsSync(ffmpegPath) || !existsSync(ffprobePath)) {
  throw new Error(`Expected ffmpeg and ffprobe beside ${ffmpegPath}.`);
}
const vettedFfmpegPath = realpathSync(ffmpegPath);
const vettedFfprobePath = realpathSync(ffprobePath);

function command(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function dylibDependencies(file) {
  return command('/usr/bin/otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^(\S+)/)?.[1])
    .filter((path) => path && (path.startsWith('/opt/homebrew/') || path.startsWith('/usr/local/')));
}

function runtimeDylibClosure(entries) {
  const queue = [...entries];
  const seen = new Set();
  while (queue.length > 0) {
    const path = queue.pop();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    for (const dependency of dylibDependencies(path)) queue.push(dependency);
  }
  return [...seen];
}

function replaceDependency(target, original, replacement) {
  execFileSync('/usr/bin/install_name_tool', ['-change', original, replacement, target]);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(join(outputDir, 'lib'), { recursive: true });
cpSync(vettedFfmpegPath, join(outputDir, 'ffmpeg'));
cpSync(vettedFfprobePath, join(outputDir, 'ffprobe'));

const binaries = [join(outputDir, 'ffmpeg'), join(outputDir, 'ffprobe')];
const dependencies = runtimeDylibClosure([vettedFfmpegPath, vettedFfprobePath]);
for (const dependency of dependencies) {
  const destination = join(outputDir, 'lib', basename(dependency));
  if (!existsSync(destination)) cpSync(realpathSync(dependency), destination);
}

const stagedLibraries = readdirSync(join(outputDir, 'lib'))
  .map((name) => join(outputDir, 'lib', name))
  .filter((path) => statSync(path).isFile());

for (const binary of binaries) {
  for (const dependency of dylibDependencies(binary)) {
    replaceDependency(binary, dependency, `@loader_path/lib/${basename(dependency)}`);
  }
}
for (const library of stagedLibraries) {
  const originalPath = dependencies.find((path) => basename(path) === basename(library));
  if (originalPath) execFileSync('/usr/bin/install_name_tool', ['-id', `@loader_path/${basename(library)}`, library]);
  for (const dependency of dylibDependencies(library)) {
    replaceDependency(library, dependency, `@loader_path/${basename(dependency)}`);
  }
}

for (const file of [...stagedLibraries, ...binaries]) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', file]);
}

const filters = command(join(outputDir, 'ffmpeg'), ['-hide_banner', '-filters']);
if (!filters.includes('vidstabdetect')) {
  throw new Error('The staged FFmpeg does not include vidstabdetect. Refusing to package it.');
}

console.log(`Staged ${dependencies.length} third-party dylibs with vetted FFmpeg tools at ${outputDir}.`);
