import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRecentProjectName } from '../../src/main/projectRecents.js';

test('normalizeRecentProjectName trims and strips control characters', () => {
  assert.equal(normalizeRecentProjectName('  Sunday\n\u0000 biking\t  '), 'Sunday biking');
});

test('normalizeRecentProjectName rejects empty, whitespace-only, and non-string values', () => {
  assert.equal(normalizeRecentProjectName(''), null);
  assert.equal(normalizeRecentProjectName(' \n\t '), null);
  assert.equal(normalizeRecentProjectName('\u0000\u007F'), null);
  assert.equal(normalizeRecentProjectName(null), null);
  assert.equal(normalizeRecentProjectName(42), null);
});

test('normalizeRecentProjectName caps a valid label at 80 characters', () => {
  const normalized = normalizeRecentProjectName('x'.repeat(100));

  assert.equal(normalized?.length, 80);
});
