import { expect, test, type Page } from '@playwright/test';

const failure = {
  kind: 'usage_limit',
  provider: 'chatgpt',
  action: 'wait',
  resets_at: '2026-10-08T14:00:00Z',
  message: 'ChatGPT usage limit reached. It resets at 14:00 — your earlier suggestions are kept.',
};

async function openFailureReview(
  page: Page,
  action: 'wait' | 'retry' | 'open_providers' = 'wait',
  includeFailure = true,
) {
  const postedEditorTexts: string[] = [];
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        getLastOpenedRecentProject: async () => ({
          folderPath: '/projects/failure-review',
          lastOpenedAt: '2026-10-08T10:00:00Z',
          name: 'Failure Review',
        }),
        addRecentProject: async () => [],
      },
    });
  });
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'failure-project',
        project_folder: '/projects/failure-review',
        project: { schema_version: 2, name: 'Failure Review', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [], settings_overrides: {} },
        videos: [], selected_harness: 'ai', effective_harness: 'ai', generation_stats: null,
      } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({ json: {
        document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
        sequence_fingerprint: 'sequence', review_context_fingerprint: 'review-context',
      } });
    } else if (url.pathname.endsWith('/review/turn') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { message: string; client_message_id: string };
      postedEditorTexts.push(body.message);
      const turnFailure = { ...failure, action: 'retry' as const, kind: 'unusable_reply' };
      await route.fulfill({ json: {
        message: failure.message,
        proposal: null,
        agent_message: {
          message_id: 'turn-failure', role: 'agent', text: failure.message, created_at: '2026-10-08T10:03:00Z',
          reply_to_message_id: body.client_message_id, proposal: null, payload: { failure: turnFailure },
        },
        session: { schema_version: 1, session_id: 'session', updated_at: '2026-10-08T10:03:00Z', messages: [
          { message_id: body.client_message_id, role: 'editor', text: body.message, created_at: '2026-10-08T10:03:00Z', reply_to_message_id: null, proposal: null, payload: {} },
          { message_id: 'turn-failure', role: 'agent', text: failure.message, created_at: '2026-10-08T10:03:01Z', reply_to_message_id: body.client_message_id, proposal: null, payload: { failure: turnFailure } },
        ] },
      } });
    } else if (url.pathname.endsWith('/review/session')) {
      await route.fulfill({ json: {
        schema_version: 1,
        session_id: 'session',
        updated_at: '2026-10-08T10:00:00Z',
        messages: [
          {
            message_id: 'agent-versions', role: 'agent', text: 'Here are two edits.', created_at: '2026-10-08T10:00:00Z', reply_to_message_id: null, proposal: null,
            payload: { version_set: {
              version_set_id: 'versions', created_at: '2026-10-08T10:00:00Z', based_on_timeline_revision: 0, based_on_sequence_fingerprint: 'sequence', based_on_review_context_fingerprint: 'review-context',
              versions: [
                { version_id: 'version-1', title: 'First cut', vibe: 'balanced', rationale: 'A first cut.', profile: 'cinematic_highlight', total_duration_sec: 20, sequence_fingerprint: 'one', items: [] },
                { version_id: 'version-2', title: 'Second cut', vibe: 'energetic', rationale: 'A second cut.', profile: 'cinematic_highlight', total_duration_sec: 20, sequence_fingerprint: 'two', items: [] },
              ],
            } },
          },
          { message_id: 'editor-1', role: 'editor', text: 'Make a tighter edit.', created_at: '2026-10-08T10:01:00Z', reply_to_message_id: null, proposal: null, payload: {} },
            ...(includeFailure ? [{ message_id: 'agent-failure', role: 'agent', text: failure.message, created_at: '2026-10-08T10:02:00Z', reply_to_message_id: 'editor-1', proposal: null, payload: { failure: { ...failure, action } } }] : []),
        ],
      } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  await page.goto('/#/review');
  return { getPostedEditorTexts: () => postedEditorTexts };
}

test('keeps earlier suggestions visible with a calm usage-limit message', async ({ page }) => {
  await openFailureReview(page);

  const card = page.getByTestId('chat-failure');
  await expect(card).toContainText('ChatGPT usage limit reached');
  await expect(card).toContainText('resets at 14:00');
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  const gallery = page.getByTestId('version-gallery');
  await expect(gallery.locator('strong', { hasText: 'First cut' })).toBeVisible();
  await expect(gallery.locator('strong', { hasText: 'Second cut' })).toBeVisible();
});

test('retries a failed turn with the Editor message it answered', async ({ page }) => {
  const requests = await openFailureReview(page, 'retry', false);
  await page.getByRole('textbox', { name: 'Message the AI' }).fill('Try a different opening.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const card = page.getByTestId('chat-failure');
  await expect(card).toContainText('ChatGPT usage limit reached');
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(requests.getPostedEditorTexts).toEqual(['Try a different opening.', 'Try a different opening.']);
});

test('opens AI settings from a provider failure', async ({ page }) => {
  await openFailureReview(page, 'open_providers');
  await page.getByTestId('chat-failure').getByRole('button', { name: 'Open AI settings' }).click();
  await expect(page.getByRole('tab', { name: 'AI assistance' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'General' }).click();
  await page.locator('[data-testid="chat-failure"] .chat-failure-action').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('tab', { name: 'AI assistance' })).toHaveAttribute('aria-selected', 'true');
});

test('retries a failed automatic opening turn through kickoff', async ({ page }) => {
  let kickoffCalls = 0;
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000', platform: 'darwin',
        getLastOpenedRecentProject: async () => ({ folderPath: '/projects/kickoff', lastOpenedAt: '2026-10-08T10:00:00Z', name: 'Kickoff' }),
        addRecentProject: async () => [],
      },
    });
  });
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'kickoff-project', project_folder: '/projects/kickoff',
        project: { schema_version: 2, name: 'Kickoff', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [], settings_overrides: {} },
        videos: [], selected_harness: 'ai', effective_harness: 'ai', generation_stats: null,
      } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({ json: { document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} }, sequence_fingerprint: '', review_context_fingerprint: '' } });
    } else if (url.pathname.endsWith('/review/session')) {
      await route.fulfill({ json: { schema_version: 1, session_id: 'kickoff-session', updated_at: '2026-10-08T10:00:00Z', messages: [] } });
    } else if (url.pathname.endsWith('/review/kickoff') && route.request().method() === 'POST') {
      kickoffCalls += 1;
      const kickoffFailure = { ...failure, kind: 'unusable_reply', action: 'retry' };
      await route.fulfill({ json: {
        message: kickoffFailure.message,
        agent_message: { message_id: `kickoff-failure-${kickoffCalls}`, role: 'agent', text: kickoffFailure.message, created_at: '2026-10-08T10:00:01Z', reply_to_message_id: null, proposal: null, payload: { failure: kickoffFailure } },
        session: { schema_version: 1, session_id: 'kickoff-session', updated_at: '2026-10-08T10:00:01Z', messages: [
          { message_id: `kickoff-failure-${kickoffCalls}`, role: 'agent', text: kickoffFailure.message, created_at: '2026-10-08T10:00:01Z', reply_to_message_id: null, proposal: null, payload: { failure: kickoffFailure } },
        ] },
      } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/#/review');
  const card = page.getByTestId('chat-failure');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => kickoffCalls).toBe(2);
});

test('finishes the clips left by a failed analysis', async ({ page }) => {
  let resumeRequested = false;
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        getLastOpenedRecentProject: async () => ({ folderPath: '/projects/scoring', lastOpenedAt: '2026-10-08T10:00:00Z', name: 'Scoring' }),
        addRecentProject: async () => [],
      },
    });
  });
  const metadata = {
    failure: { ...failure, action: 'wait' },
    clips_left: 7,
    per_video: [{ file_id: 'source-1', file_name: 'drone.mp4', failure: { ...failure, action: 'wait' } }],
  };
  const resumedClip = {
    clip_id: 'resumed-clip', file_id: 'source-1', file_name: 'resumed-only.mp4', scene_id: 1,
    start_sec: 2, end_sec: 8, duration_sec: 6, smoothness_score: 8, sharpness_score: 8,
    exposure_score: 8, contrast_score: 8, visual_interest_score: 9, overall_score: 9,
    ai_reason: 'Only returned after resume.', suggested_speed: 1, tags: ['resumed'],
  };
  const analysis = (failed: boolean) => ({
    project_id: 'scoring-project', harness_id: 'ai', selected_harness: 'ai', effective_harness: 'manual', status: 'complete',
    clips: failed ? [] : [resumedClip], sequence: { total_duration_sec: failed ? 0 : 6, clips: failed ? [] : [resumedClip] },
    recommendation: { profile: 'cinematic_highlight', target_duration_sec: 120, reason: 'Default' },
    generation_stats: null,
    metadata: failed ? metadata : { per_video: [] },
    notices: [],
  });
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'scoring-project', project_folder: '/projects/scoring',
        project: { schema_version: 2, name: 'Scoring', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [{ filename: 'drone.mp4', imported_at: '2026-10-08T10:00:00Z' }], settings_overrides: {} },
        videos: [{ file_id: 'source-1', file_name: 'drone.mp4', status: 'ready', metadata: { file_id: 'source-1', file_name: 'drone.mp4', duration_sec: 24, fps: 30, resolution: [1920, 1080], codec: 'h264' } }],
        selected_harness: 'ai', effective_harness: null, generation_stats: null,
      } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      const resumed = resumeRequested;
      await route.fulfill({ json: { document: { version: 1, revision: resumed ? 1 : 0, items: resumed ? [{ item_id: 'resumed-item', source_clip_id: 'resumed-clip', start_sec: 2, end_sec: 8, speed: 1, transform: { scale: 1, x: 0, y: 0 } }] : [], profile: null, target_duration_sec: null, decisions: {} }, sequence_fingerprint: '', review_context_fingerprint: '' } });
    } else if (url.pathname.endsWith('/analyze')) {
      await route.fulfill({ json: analysis(true) });
    } else if (url.pathname.endsWith('/ai-scoring/resume')) {
      resumeRequested = true;
      await route.fulfill({ json: analysis(false) });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/#/import');
  await page.getByTestId('source-video-selection-bar').getByRole('button', { name: /Analyze/ }).click();
  await expect(page.getByText('ChatGPT usage limit reached. It resets at 14:00')).toBeVisible();
  const finish = page.getByRole('button', { name: 'Finish AI scoring (7 clips left)' });
  await expect(finish).toBeVisible();
  await finish.click();
  await expect.poll(() => resumeRequested).toBe(true);
  await expect(page.getByText('ChatGPT usage limit reached. It resets at 14:00')).toHaveCount(0);
  await page.goto('/#/review');
  await expect(page.getByTestId('harness-fallback-notice')).toHaveCount(0);
  await expect(page.getByText('resumed-only.mp4')).toBeVisible();
});

test('shows a saved scoring failure when reopening a project without analyzing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000', platform: 'darwin',
        getLastOpenedRecentProject: async () => ({ folderPath: '/projects/reopened', lastOpenedAt: '2026-10-08T10:00:00Z', name: 'Reopened' }),
        addRecentProject: async () => [],
      },
    });
  });
  let analyzeCalls = 0;
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'reopened-project', project_folder: '/projects/reopened',
        project: { schema_version: 2, name: 'Reopened', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [{ filename: 'drone.mp4', imported_at: '2026-10-08T10:00:00Z' }], settings_overrides: {} },
        videos: [{ file_id: 'source-1', file_name: 'drone.mp4', status: 'ready', metadata: { file_id: 'source-1', file_name: 'drone.mp4', duration_sec: 24, fps: 30, resolution: [1920, 1080], codec: 'h264' } }],
        selected_harness: 'ai', effective_harness: 'manual', generation_stats: null,
        metadata: { failure: { ...failure, action: 'wait' }, clips_left: 3, per_video: [{ file_id: 'source-1', file_name: 'drone.mp4', failure: { ...failure, action: 'wait' } }] },
      } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({ json: { document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} }, sequence_fingerprint: '', review_context_fingerprint: '' } });
    } else if (url.pathname.endsWith('/analyze')) {
      analyzeCalls += 1;
      await route.fulfill({ status: 500, json: { detail: 'Unexpected analysis' } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/#/import');
  await expect(page.getByText(failure.message)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish AI scoring (3 clips left)' })).toBeVisible();
  expect(analyzeCalls).toBe(0);
});

test('shows resume failure text and enables another attempt', async ({ page }) => {
  // Exercise the same completed Import surface as the scoring test, but reject resume.
  let resumeCalls = 0;
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: { backendUrl: 'http://127.0.0.1:8000', platform: 'darwin', getLastOpenedRecentProject: async () => ({ folderPath: '/projects/retry-resume', lastOpenedAt: '2026-10-08T10:00:00Z', name: 'Retry resume' }), addRecentProject: async () => [] },
    });
  });
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'retry-resume', project_folder: '/projects/retry-resume',
        project: { schema_version: 2, name: 'Retry resume', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [], settings_overrides: {} },
        videos: [], selected_harness: 'ai', effective_harness: 'manual', generation_stats: null,
        metadata: { failure: { ...failure, action: 'wait' }, clips_left: 2, per_video: [] },
      } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({ json: { document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} }, sequence_fingerprint: '', review_context_fingerprint: '' } });
    } else if (url.pathname.endsWith('/ai-scoring/resume')) {
      resumeCalls += 1;
      await route.fulfill({ status: 409, json: { detail: 'Scoring cannot resume yet (409).' } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/#/import');
  const finish = page.getByRole('button', { name: 'Finish AI scoring (2 clips left)' });
  await finish.click();
  await expect(page.getByText('Scoring cannot resume yet (409).')).toBeVisible();
  await expect(finish).toBeEnabled();
  expect(resumeCalls).toBe(1);
  await page.goto('/#/review');
  await expect(page.getByTestId('harness-fallback-notice').getByText('Scoring cannot resume yet (409).')).toBeVisible();
  await expect(page.getByTestId('harness-fallback-notice').getByRole('button', { name: 'Finish AI scoring (2 clips left)' })).toBeEnabled();
});

test('keeps resume busy across Import and Review', async ({ page }) => {
  let resumeCalls = 0;
  let releaseResume!: () => void;
  await page.addInitScript(() => {
    Object.assign(window, {
      clipAssembler: { backendUrl: 'http://127.0.0.1:8000', platform: 'darwin', getLastOpenedRecentProject: async () => ({ folderPath: '/projects/pending-resume', lastOpenedAt: '2026-10-08T10:00:00Z', name: 'Pending resume' }), addRecentProject: async () => [] },
    });
  });
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({ json: {
        project_id: 'pending-resume', project_folder: '/projects/pending-resume',
        project: { schema_version: 2, name: 'Pending resume', created_at: '2026-10-08T10:00:00Z', harness: 'ai', ai_enabled: true, source_videos: [], settings_overrides: {} },
        videos: [], selected_harness: 'ai', effective_harness: 'manual', generation_stats: null,
        metadata: { failure: { ...failure, action: 'wait' }, clips_left: 2, per_video: [] },
      } });
    } else if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ json: { clips: [] } });
    } else if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({ json: { document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} }, sequence_fingerprint: '', review_context_fingerprint: '' } });
    } else if (url.pathname.endsWith('/ai-scoring/resume')) {
      resumeCalls += 1;
      await new Promise<void>((resolve) => { releaseResume = resolve; });
      await route.fulfill({ json: {
        project_id: 'pending-resume', harness_id: 'ai', selected_harness: 'ai', effective_harness: 'manual', status: 'complete',
        clips: [], sequence: { total_duration_sec: 0, clips: [] },
        recommendation: { profile: 'cinematic_highlight', target_duration_sec: 120, reason: 'Default' },
        generation_stats: null, metadata: { per_video: [] }, notices: [],
      } });
    } else if (url.pathname === '/harnesses') {
      await route.fulfill({ json: { harnesses: [] } });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });

  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Finish AI scoring (2 clips left)' }).click();
  await expect.poll(() => resumeCalls).toBe(1);
  await expect(page.getByRole('button', { name: 'Scoring…' })).toBeDisabled();
  await page.goto('/#/review');
  await expect(page.getByRole('button', { name: 'Scoring…' })).toBeDisabled();
  expect(resumeCalls).toBe(1);
  releaseResume();
  await expect(page.getByTestId('harness-fallback-notice')).toHaveCount(0);
});
