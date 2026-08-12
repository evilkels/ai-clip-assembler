import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProjectDisplayName, sortRecentProjects } from '../../src/renderer/src/lib/projectSort.js';
import type { RecentProject } from '../../src/renderer/src/types/clip.js';

function project(folderPath: string, name?: string, lastOpenedAt = '2026-08-11T10:00:00Z'): RecentProject {
  return { folderPath, name, lastOpenedAt };
}

test('sortRecentProjects orders display names case-insensitively', () => {
  const input = [
    project('/projects/zebra', 'zebra'),
    project('/projects/Alpha', 'Alpha'),
    project('/projects/bravo', 'BRAVO'),
  ];

  assert.deepEqual(
    sortRecentProjects(input).map((item) => item.name),
    ['Alpha', 'BRAVO', 'zebra'],
  );
  assert.deepEqual(input.map((item) => item.folderPath), [
    '/projects/zebra',
    '/projects/Alpha',
    '/projects/bravo',
  ]);
});

test('sortRecentProjects uses folderPath as a deterministic tie-breaker', () => {
  const sorted = sortRecentProjects([
    project('/projects/second', 'Same'),
    project('/projects/first', 'same'),
  ]);

  assert.deepEqual(sorted.map((item) => item.folderPath), ['/projects/first', '/projects/second']);
});

test('sortRecentProjects falls back to the folder basename when name is absent', () => {
  const sorted = sortRecentProjects([
    project('/projects/Bravo'),
    project('/projects/alpha'),
  ]);

  assert.deepEqual(sorted.map((item) => item.folderPath), ['/projects/alpha', '/projects/Bravo']);
});

test('currentProjectDisplayName keeps an unnamed recent aligned with its project row', () => {
  const recentProject = project('/projects/older-recent');

  assert.equal(
    currentProjectDisplayName({
      recentProject,
      projectName: 'Manifest project name',
      projectFolder: recentProject.folderPath,
    }),
    'older-recent',
  );
});
