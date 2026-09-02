import assert from 'node:assert/strict';
import test from 'node:test';
import {
  effectiveTimelineDuration,
  projectTimelineItems,
} from '../../src/renderer/src/lib/timelineProjection.js';

const clips = [
  { clip_id: 'clip-a', file_name: 'A.MP4' },
  { clip_id: 'clip-b', file_name: 'B.MP4' },
];

test('projects repeated source clips as distinct timeline placements', () => {
  const projected = projectTimelineItems(
    [
      {
        item_id: 'item-1',
        source_clip_id: 'clip-a',
        start_sec: 2,
        end_sec: 8,
        speed: 1,
        transform: { scale: 1, x: 0, y: 0 },
      },
      {
        item_id: 'item-2',
        source_clip_id: 'clip-a',
        start_sec: 10,
        end_sec: 14,
        speed: 2,
        transform: { scale: 1.25, x: 0.1, y: -0.2 },
      },
    ],
    clips,
  );

  assert.deepEqual(projected, [
    {
      itemId: 'item-1',
      sourceClipId: 'clip-a',
      fileName: 'A.MP4',
      startSec: 2,
      endSec: 8,
      speed: 1,
      durationSec: 6,
      transform: { scale: 1, x: 0, y: 0 },
      missingSource: false,
    },
    {
      itemId: 'item-2',
      sourceClipId: 'clip-a',
      fileName: 'A.MP4',
      startSec: 10,
      endSec: 14,
      speed: 2,
      durationSec: 2,
      transform: { scale: 1.25, x: 0.1, y: -0.2 },
      missingSource: false,
    },
  ]);
});

test('uses each item bounds and speed when calculating effective duration', () => {
  const items = [
    {
      item_id: 'item-a',
      source_clip_id: 'clip-a',
      start_sec: 4,
      end_sec: 10,
      speed: 1.5,
      transform: { scale: 1, x: 0, y: 0 },
    },
    {
      item_id: 'item-b',
      source_clip_id: 'clip-b',
      start_sec: 3,
      end_sec: 5,
      speed: 0.5,
      transform: { scale: 1, x: 0, y: 0 },
    },
  ];

  assert.equal(effectiveTimelineDuration(items), 8);
});

test('passes through transforms and falls back for a missing source', () => {
  const [projected] = projectTimelineItems(
    [
      {
        item_id: 'item-missing',
        source_clip_id: 'gone',
        start_sec: 1,
        end_sec: 3,
        speed: 1,
        transform: { scale: 1.1, x: -0.25, y: 0.5 },
      },
    ],
    clips,
  );

  assert.deepEqual(projected, {
    itemId: 'item-missing',
    sourceClipId: 'gone',
    fileName: 'gone',
    startSec: 1,
    endSec: 3,
    speed: 1,
    durationSec: 2,
    transform: { scale: 1.1, x: -0.25, y: 0.5 },
    missingSource: true,
  });
});
