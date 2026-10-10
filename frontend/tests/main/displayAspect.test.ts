import assert from 'node:assert/strict';
import test from 'node:test';
import { sequenceAspect, sourceDisplayAspect } from '../../src/renderer/src/lib/displayAspect.js';
import type { UploadedVideo, VideoMetadata } from '../../src/renderer/src/types/clip.js';

function metadata(overrides: Partial<VideoMetadata>): VideoMetadata {
  return {
    file_id: 'src',
    file_name: 'src.mov',
    duration_sec: 10,
    fps: 30,
    resolution: [1920, 1080],
    codec: 'hevc',
    ...overrides,
  };
}

function video(file_id: string, overrides: Partial<VideoMetadata>): UploadedVideo {
  return {
    file_id,
    file_name: `${file_id}.mov`,
    status: 'ready',
    metadata: metadata({ file_id, ...overrides }),
  };
}

test('display_resolution wins over the encoded resolution', () => {
  const aspect = sourceDisplayAspect(
    metadata({ resolution: [1920, 1080], display_resolution: [1080, 1920], rotation_degrees: 90 }),
  );
  assert.equal(aspect, 1080 / 1920);
});

test('falls back to the encoded resolution, swapped for a quarter-turn rotation', () => {
  assert.equal(sourceDisplayAspect(metadata({})), 16 / 9);
  assert.equal(sourceDisplayAspect(metadata({ rotation_degrees: 180 })), 16 / 9);
  assert.equal(sourceDisplayAspect(metadata({ rotation_degrees: 90 })), 9 / 16);
  assert.equal(sourceDisplayAspect(metadata({ rotation_degrees: -90 })), 9 / 16);
});

test('an unusable display_resolution falls through to the encoded resolution', () => {
  assert.equal(sourceDisplayAspect(metadata({ display_resolution: [0, 1920] })), 16 / 9);
});

test('returns null when nothing usable is known', () => {
  assert.equal(sourceDisplayAspect(undefined), null);
  assert.equal(sourceDisplayAspect(metadata({ resolution: [0, 0] })), null);
});

test('the sequence takes the first clip source aspect, or 16:9', () => {
  const videos = [
    video('portrait', { display_resolution: [1080, 1920] }),
    video('landscape', {}),
  ];
  assert.equal(sequenceAspect('portrait', videos), 1080 / 1920);
  assert.equal(sequenceAspect('landscape', videos), 16 / 9);
  assert.equal(sequenceAspect('unknown', videos), 16 / 9);
  assert.equal(sequenceAspect(undefined, videos), 16 / 9);
});
