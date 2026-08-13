import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceAudioLabel, sourceAudioState } from '../../src/renderer/src/lib/sourceAudio.js';
import type { UploadedVideo } from '../../src/renderer/src/types/clip.js';

function video(file_id: string, metadata?: Record<string, unknown>): UploadedVideo {
  return {
    file_id,
    file_name: `${file_id}.MP4`,
    status: 'ready',
    metadata: metadata
      ? ({
          file_id,
          file_name: `${file_id}.MP4`,
          duration_sec: 10,
          fps: 30,
          resolution: [1920, 1080],
          codec: 'h264',
          ...metadata,
        } as UploadedVideo['metadata'])
      : undefined,
  };
}

const videos = [
  video('stereo', { has_audio: true, audio_channels: 2 }),
  video('mono', { has_audio: true, audio_channels: 1 }),
  video('unknown-count', { has_audio: true }),
  video('silent', { has_audio: false }),
  video('legacy', {}),
];

test('reports channel counts for audio-bearing sources', () => {
  assert.deepEqual(sourceAudioState('stereo', videos), { hasAudio: true, channels: 2 });
  assert.equal(sourceAudioLabel(sourceAudioState('stereo', videos)), 'Audio · 2ch');
  assert.equal(sourceAudioLabel(sourceAudioState('mono', videos)), 'Audio · 1ch');
  assert.equal(sourceAudioLabel(sourceAudioState('unknown-count', videos)), 'Audio');
});

test('reports a known-silent source as silent', () => {
  assert.deepEqual(sourceAudioState('silent', videos), { hasAudio: false, channels: undefined });
  assert.equal(sourceAudioLabel(sourceAudioState('silent', videos)), 'Silent');
});

test('claims nothing for metadata without audio fields', () => {
  // Projects probed before audio metadata existed: unknown, not silent.
  assert.equal(sourceAudioState('legacy', videos).hasAudio, undefined);
  assert.equal(sourceAudioLabel(sourceAudioState('legacy', videos)), null);
});

test('claims nothing for an unmatched or missing file id', () => {
  assert.equal(sourceAudioLabel(sourceAudioState('absent', videos)), null);
  assert.equal(sourceAudioLabel(sourceAudioState(undefined, videos)), null);
});
