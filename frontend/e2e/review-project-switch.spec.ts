/**
 * Switching projects on Review must never paint the previous project's
 * conversation, not even for a single commit while the new one loads, and a
 * request still in flight for the previous project must not touch the new one.
 */
import { expect, test, type Page } from '@playwright/test';

const PROJECTS = [
  { id: 'switch-alpha', folder: '/tmp/ai-clip-assembler/ALPHA', name: 'Alpha Project', marker: 'ALPHA-MARKER' },
  { id: 'switch-bravo', folder: '/tmp/ai-clip-assembler/BRAVO', name: 'Bravo Project', marker: 'BRAVO-MARKER' },
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

const timelineItem = (itemId: string) => ({
  item_id: itemId,
  source_clip_id: 'switch-clip',
  start_sec: 1,
  end_sec: 4,
  speed: 1,
  transform: { scale: 1, x: 0, y: 0 },
});

const snapshotOf = (revision: number, itemIds: string[]) => ({
  document: {
    version: 1,
    revision,
    items: itemIds.map(timelineItem),
    profile: null,
    target_duration_sec: null,
    decisions: {},
  },
  sequence_fingerprint: '',
  review_context_fingerprint: '',
});

/** A promise the test releases by hand, to hold a stubbed response open. */
function gate() {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

interface StubOptions {
  /** Delay Bravo's session response, so Alpha's conversation could linger on screen. */
  bravoSessionDelayMs?: number;
  /** Hold Alpha's first session GET open until released. */
  alphaSession?: ReturnType<typeof gate>;
  /** Alpha's session carries a pending Proposal; Accept applies it (one item, revision 1). */
  alphaProposal?: boolean;
  /** Hold Alpha's Accept response open until released. */
  accept?: ReturnType<typeof gate>;
  /** Hold Alpha's Undo response open until released; it resolves to an item Bravo does not have. */
  undo?: ReturnType<typeof gate>;
}

const BRAVO_ITEMS = ['bravo-item-1', 'bravo-item-2'];

async function stubTwoProjects(page: Page, options: StubOptions = {}) {
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

  let proposalStatus: 'pending' | 'accepted' = 'pending';
  let alphaItems: string[] = [];
  let alphaRevision = 0;
  let alphaSessionServed = false;

  const messageOf = (text: string, id: string, role: 'agent' | 'editor' = 'agent') => ({
    message_id: id,
    role,
    text,
    created_at: '2026-08-11T10:00:00Z',
    reply_to_message_id: null,
    proposal: null,
    payload: {},
  });
  const alphaProposal = () => ({
    proposal_id: 'alpha-proposal',
    project_id: PROJECTS[0].id,
    message: 'Add the ridge push',
    operations: [],
    summary: ['Add the ridge push'],
    before_item_count: 0,
    after_item_count: 1,
    based_on_timeline_revision: 0,
    status: proposalStatus,
  });
  const sessionOf = (project: (typeof PROJECTS)[number]) => ({
    schema_version: 1,
    session_id: `${project.id}-session`,
    updated_at: '2026-08-11T10:00:00Z',
    messages: [
      messageOf(`Opening note ${project.marker}`, `${project.id}-message`),
      ...(options.alphaProposal && project === PROJECTS[0]
        ? [{ ...messageOf('Proposal ready', 'alpha-proposal-message'), proposal: alphaProposal() }]
        : []),
    ],
  });

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
    const isAlpha = project === PROJECTS[0];
    if (project && url.pathname.endsWith('/review/session')) {
      if (isAlpha && options.alphaSession && !alphaSessionServed) {
        alphaSessionServed = true;
        await options.alphaSession.opened;
      }
      if (!isAlpha && options.bravoSessionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.bravoSessionDelayMs));
      }
      return json(sessionOf(project));
    }
    if (project && url.pathname.endsWith('/review/turn')) {
      const { message, client_message_id: id } = route.request().postDataJSON() as {
        message: string;
        client_message_id: string;
      };
      const session = sessionOf(project);
      session.messages.push(messageOf(message, id, 'editor'));
      return json({ message: '', proposal: null, agent_message: session.messages[0], session });
    }
    if (project && url.pathname.endsWith('/proposals/alpha-proposal/accept')) {
      await options.accept?.opened;
      proposalStatus = 'accepted';
      alphaItems = ['alpha-item'];
      alphaRevision = 1;
      return json(snapshotOf(alphaRevision, alphaItems));
    }
    if (project && url.pathname.endsWith('/timeline/undo')) {
      await options.undo?.opened;
      return json(snapshotOf(2, ['alpha-undone-item']));
    }
    if (project && url.pathname.endsWith('/clips')) return json({ clips: [clip] });
    if (project && url.pathname.endsWith('/timeline/document')) {
      return json(isAlpha ? snapshotOf(alphaRevision, alphaItems) : snapshotOf(5, BRAVO_ITEMS));
    }
    if (url.pathname === '/harnesses') {
      return json({ harnesses: [{ id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true }] });
    }
    if (url.pathname === '/') return json({ version: '0.2.0' });
    return route.fulfill({ status: 204, body: '' });
  });
}

/** Record every node added to the Ask the AI rail, so a one-commit flash is still seen. */
async function watchRail(page: Page) {
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
  return () => page.evaluate(() => (window as unknown as { __added: string[] }).__added);
}

test('switching projects never paints the previous conversation', async ({ page }) => {
  await stubTwoProjects(page, { bravoSessionDelayMs: 1_500 });

  await page.goto('/#/review');
  const rail = page.getByTestId('ask-ai-rail');
  await expect(rail).toContainText('ALPHA-MARKER');

  const railAdditions = await watchRail(page);

  await page.getByRole('button', { name: 'Open Bravo Project' }).click();
  await expect(rail).toContainText('BRAVO-MARKER');

  expect((await railAdditions()).filter((text) => text.includes('ALPHA-MARKER'))).toEqual([]);
});

test('a late session response for the previous project never lands', async ({ page }) => {
  const alphaSession = gate();
  await stubTwoProjects(page, { alphaSession });

  await page.goto('/#/review');
  const rail = page.getByTestId('ask-ai-rail');
  const log = page.getByTestId('review-chat-log');
  await expect(log).toHaveAttribute('aria-busy', 'true');
  const railAdditions = await watchRail(page);

  await page.getByRole('button', { name: 'Open Bravo Project' }).click();
  alphaSession.release();
  await expect(rail).toContainText('BRAVO-MARKER');

  expect((await railAdditions()).filter((text) => text.includes('ALPHA-MARKER'))).toEqual([]);
  await expect(log).toHaveAttribute('aria-busy', 'false');
});
