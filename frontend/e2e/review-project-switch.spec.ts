/**
 * Switching projects on Review must never paint the previous project's
 * conversation, not even for a single commit while the new one loads.
 */
import { expect, test } from '@playwright/test';

const PROJECTS = [
  { id: 'switch-alpha', folder: '/tmp/ai-clip-assembler/ALPHA', name: 'Alpha Project', marker: 'ALPHA-MARKER', delayMs: 0 },
  { id: 'switch-bravo', folder: '/tmp/ai-clip-assembler/BRAVO', name: 'Bravo Project', marker: 'BRAVO-MARKER', delayMs: 1_500 },
];

const sourceVideo = {
  file_id: 'switch-source',
  file_name: 'switch-source.mp4',
  status: 'ready',
  metadata: {
    file_id: 'switch-source',
    file_name: 'switch-source.mp4',
    duration_sec: 10,
    fps: 30,
    resolution: [1920, 1080],
    codec: 'h264',
    size_bytes: 10_000_000,
    created_at: '2026-08-11T10:00:00Z',
    has_audio: false,
    audio_channels: 0,
    audio_sample_rate: null,
    audio_codec: null,
  },
};

const clip = {
  clip_id: 'switch-clip',
  file_id: 'switch-source',
  file_name: 'switch-source.mp4',
  scene_id: 1,
  start_sec: 1,
  end_sec: 4,
  duration_sec: 3,
  smoothness_score: 9,
  sharpness_score: 8,
  exposure_score: 8,
  contrast_score: 8,
  visual_interest_score: 9,
  overall_score: 8.6,
  ai_reason: 'Steady push over the ridge.',
  suggested_speed: 1,
  tags: [],
  source_created_at: '2026-08-11T10:00:00Z',
  source_duration_sec: 10,
};

test('switching projects never paints the previous conversation', async ({ page }) => {
  const recents = PROJECTS.map((project) => ({
    folderPath: project.folder,
    lastOpenedAt: '2026-08-11T10:00:00Z',
    name: project.name,
  }));

  await page.addInitScript((seeded) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => seeded,
        getLastOpenedRecentProject: async () => seeded[0],
        addRecentProject: async () => seeded,
        setWindowTitle: async () => {},
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' }),
      },
    });
  }, recents);

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/projects/from-folder') {
      const { folder_path: folderPath } = route.request().postDataJSON() as { folder_path: string };
      const project = PROJECTS.find((candidate) => candidate.folder === folderPath) ?? PROJECTS[0];
      return json({
        project_id: project.id,
        project_folder: project.folder,
        project: {
          schema_version: 1,
          name: project.name,
          created_at: '2026-08-11T10:00:00Z',
          harness: 'manual',
          cloud_ai_consent: false,
          source_videos: [{ filename: sourceVideo.file_name, imported_at: '2026-08-11T10:00:00Z' }],
          settings_overrides: {},
        },
        videos: [sourceVideo],
        clips: [clip],
        timeline: null,
        generation_stats: null,
      });
    }

    const projectId = /^\/projects\/([^/]+)\//.exec(url.pathname)?.[1];
    const project = PROJECTS.find((candidate) => candidate.id === projectId);
    if (project && url.pathname.endsWith('/review/session')) {
      if (project.delayMs) await new Promise((resolve) => setTimeout(resolve, project.delayMs));
      return json({
        schema_version: 1,
        session_id: `${project.id}-session`,
        updated_at: '2026-08-11T10:00:00Z',
        messages: [
          {
            message_id: `${project.id}-message`,
            role: 'agent',
            text: `Opening note ${project.marker}`,
            created_at: '2026-08-11T10:00:00Z',
            reply_to_message_id: null,
            proposal: null,
            payload: {},
          },
        ],
      });
    }
    if (project && url.pathname.endsWith('/clips')) return json({ clips: [clip] });
    if (url.pathname.endsWith('/timeline/document')) {
      return json({
        document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
        sequence_fingerprint: '',
        review_context_fingerprint: '',
      });
    }
    if (url.pathname === '/harnesses') {
      return json({ harnesses: [{ id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true }] });
    }
    if (url.pathname === '/') return json({ version: '0.2.0' });
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/review');
  const rail = page.getByTestId('ask-ai-rail');
  await expect(rail).toContainText('ALPHA-MARKER');

  await page.evaluate(() => {
    const added: string[] = [];
    Object.assign(window, { __added: added });
    const rail = document.querySelector('[data-testid="ask-ai-rail"]');
    if (!rail) throw new Error('ask-ai-rail is not mounted');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) added.push(node.textContent ?? '');
      }
    }).observe(rail, { childList: true, subtree: true });
  });

  await page.getByRole('button', { name: 'Open Bravo Project' }).click();
  await expect(rail).toContainText('BRAVO-MARKER');

  const added = await page.evaluate(() => (window as unknown as { __added: string[] }).__added);
  expect(added.filter((text) => text.includes('ALPHA-MARKER'))).toEqual([]);
});
