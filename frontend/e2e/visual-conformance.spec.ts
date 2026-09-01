import { expect, test, type Page } from '@playwright/test';

type VisualFixture =
  | 'shell'
  | 'import-analyzing'
  | 'review-grid'
  | 'review-list'
  | 'timeline-selection'
  | 'export-receipt';

const PROJECT_ID = 'visual-conformance-project';
const PROJECT_FOLDER = '/tmp/ai-clip-assembler/ESTEPONA_03-05-26';
const PROJECT_NAME = 'ESTEPONA_03-05-26';

const videos = [
  {
    file_id: 'visual-source-01',
    file_name: 'estepone-coast-01.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-01',
      file_name: 'estepone-coast-01.mp4',
      duration_sec: 12.4,
      fps: 59.94,
      resolution: [3840, 2160],
      codec: 'hevc',
      size_bytes: 734_003_200,
      created_at: '2026-08-11T10:00:00Z',
      has_audio: true,
      audio_channels: 2,
      audio_sample_rate: 48_000,
      audio_codec: 'aac',
    },
  },
  {
    file_id: 'visual-source-02',
    file_name: 'estepone-cliffs-02.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-02',
      file_name: 'estepone-cliffs-02.mp4',
      duration_sec: 8.7,
      fps: 59.94,
      resolution: [3840, 2160],
      codec: 'hevc',
      size_bytes: 512_000_000,
      created_at: '2026-08-11T10:01:00Z',
      has_audio: true,
      audio_channels: 2,
      audio_sample_rate: 48_000,
      audio_codec: 'aac',
    },
  },
  {
    file_id: 'visual-source-03',
    file_name: 'estepone-water-03.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-03',
      file_name: 'estepone-water-03.mp4',
      duration_sec: 15.1,
      fps: 29.97,
      resolution: [1920, 1080],
      codec: 'h264',
      size_bytes: 401_000_000,
      created_at: '2026-08-11T10:02:00Z',
      has_audio: false,
      audio_channels: 0,
      audio_sample_rate: null,
      audio_codec: null,
    },
  },
  {
    file_id: 'visual-source-04',
    file_name: 'estepone-sunset-04.mp4',
    status: 'ready',
    metadata: {
      file_id: 'visual-source-04',
      file_name: 'estepone-sunset-04.mp4',
      duration_sec: 9.3,
      fps: 59.94,
      resolution: [3840, 2160],
      codec: 'hevc',
      size_bytes: 615_000_000,
      created_at: '2026-08-11T10:03:00Z',
      has_audio: true,
      audio_channels: 2,
      audio_sample_rate: 48_000,
      audio_codec: 'aac',
    },
  },
];

const clips = [
  {
    clip_id: 'visual-clip-01', file_id: 'visual-source-01', file_name: 'estepone-coast-01.mp4',
    scene_id: 1, start_sec: 1.2, end_sec: 5.8, duration_sec: 4.6,
    smoothness_score: 9.2, sharpness_score: 8.7, exposure_score: 8.9, contrast_score: 8.2,
    visual_interest_score: 9.1, overall_score: 9.0, ai_reason: 'Clean reveal over the coastline.',
    suggested_speed: 1, tags: ['coast', 'reveal'], source_created_at: '2026-08-11T10:00:00Z', source_duration_sec: 12.4,
  },
  {
    clip_id: 'visual-clip-02', file_id: 'visual-source-02', file_name: 'estepone-cliffs-02.mp4',
    scene_id: 2, start_sec: 0.6, end_sec: 4.9, duration_sec: 4.3,
    smoothness_score: 8.4, sharpness_score: 8.8, exposure_score: 8.1, contrast_score: 8.6,
    visual_interest_score: 8.8, overall_score: 8.6, ai_reason: 'Strong parallax along the cliffs.',
    suggested_speed: 0.8, tags: ['cliffs', 'parallax'], source_created_at: '2026-08-11T10:01:00Z', source_duration_sec: 8.7,
  },
  {
    clip_id: 'visual-clip-03', file_id: 'visual-source-03', file_name: 'estepone-water-03.mp4',
    scene_id: 3, start_sec: 3.1, end_sec: 7.4, duration_sec: 4.3,
    smoothness_score: 8.1, sharpness_score: 7.9, exposure_score: 9.0, contrast_score: 8.0,
    visual_interest_score: 8.3, overall_score: 8.2, ai_reason: 'Steady waterline tracking shot.',
    suggested_speed: 1, tags: ['water', 'tracking'], source_created_at: '2026-08-11T10:02:00Z', source_duration_sec: 15.1,
  },
  {
    clip_id: 'visual-clip-04', file_id: 'visual-source-04', file_name: 'estepone-sunset-04.mp4',
    scene_id: 4, start_sec: 2.4, end_sec: 6.7, duration_sec: 4.3,
    smoothness_score: 8.8, sharpness_score: 8.5, exposure_score: 9.4, contrast_score: 8.9,
    visual_interest_score: 9.3, overall_score: 9.1, ai_reason: 'Warm closing frame with clear horizon.',
    suggested_speed: 1, tags: ['sunset', 'closing'], source_created_at: '2026-08-11T10:03:00Z', source_duration_sec: 9.3,
  },
];

const timelineItems = [
  { item_id: 'visual-item-01', source_clip_id: 'visual-clip-01', start_sec: 1.2, end_sec: 5.8, speed: 1, transform: { scale: 1, x: 0, y: 0 } },
  { item_id: 'visual-item-02', source_clip_id: 'visual-clip-02', start_sec: 0.6, end_sec: 4.9, speed: 0.8, transform: { scale: 1.05, x: 0, y: 0 } },
  { item_id: 'visual-item-03', source_clip_id: 'visual-clip-04', start_sec: 2.4, end_sec: 6.7, speed: 1, transform: { scale: 1, x: 0, y: 0 } },
];

const analysisStatus = {
  phase: 'analyzing' as const,
  harness_id: 'manual',
  step: 'scoring_clips',
  video_index: 2,
  video_total: 4,
  file_name: 'estepone-cliffs-02.mp4',
  clip_index: 3,
  clip_total: 4,
  message: 'Scoring candidate clips',
  elapsed_sec: 12,
  started_at: 1_755_000_000_000,
  updated_at: 1_755_000_012_000,
};

function fixtureInHash(fixture: VisualFixture): string {
  return `/#/playwriter?fixture=${fixture}`;
}

async function installFixtureBackend(page: Page, fixture: VisualFixture): Promise<void> {
  await page.addInitScript(({ folderPath, projectName }) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath, lastOpenedAt: '2026-08-11T10:00:00Z', name: projectName }],
        getLastOpenedRecentProject: async () => null,
        addRecentProject: async () => [{ folderPath, lastOpenedAt: '2026-08-11T10:00:00Z', name: projectName }],
        setWindowTitle: async () => {},
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.6', latestVersion: '0.1.6' }),
        revealExportFile: async () => {},
        openInDaVinci: async () => ({ opened: true }),
      },
    });
    localStorage.setItem('aca:theme', 'dark');
  }, { folderPath: PROJECT_FOLDER, projectName: PROJECT_NAME });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: PROJECT_ID,
          project_folder: PROJECT_FOLDER,
          project: {
            schema_version: 1,
            name: PROJECT_NAME,
            created_at: '2026-08-11T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: videos.map((video) => ({ filename: video.file_name, imported_at: '2026-08-11T10:00:00Z' })),
            settings_overrides: {},
          },
          videos,
          clips: [],
          timeline: null,
          generation_stats: null,
        }),
      });
      return;
    }
    if (url.pathname === `/projects/${PROJECT_ID}/analyze/status`) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(analysisStatus) });
      return;
    }
    if (url.pathname === `/projects/${PROJECT_ID}/clips`) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clips }) });
      return;
    }
    if (url.pathname === '/harnesses') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ harnesses: [
        { id: 'manual', name: 'Manual / Rule-based', type: 'rule', enabled: true },
        { id: 'pi_agent', name: 'Pi Agent', type: 'agent', enabled: true },
      ] }) });
      return;
    }
    if (url.pathname.endsWith('/timeline/document')) {
      const hasTimeline = ['review-grid', 'review-list', 'timeline-selection', 'export-receipt'].includes(fixture);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          document: {
            version: 1,
            revision: hasTimeline ? 4 : 0,
            items: hasTimeline ? timelineItems : [],
            profile: hasTimeline ? 'cinematic_highlight' : null,
            target_duration_sec: hasTimeline ? 15 : null,
            decisions: hasTimeline ? Object.fromEntries(clips.map((clip) => [clip.clip_id, 'included'])) : {},
          },
          sequence_fingerprint: hasTimeline ? 'visual-sequence-fingerprint' : '',
          review_context_fingerprint: hasTimeline ? 'visual-review-fingerprint' : '',
        }),
      });
      return;
    }
    if (url.pathname === `/projects/${PROJECT_ID}/export`) {
      const format = url.searchParams.get('format') ?? 'edl';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: PROJECT_ID,
          format,
          status: 'exported',
          file_path: `${PROJECT_FOLDER}/exports/ESTEPONA_03-05-26.${format === 'edl' ? 'edl' : format === 'fcpxml' ? 'fcpxml' : 'xml'}`,
          clip_count: timelineItems.length,
          total_duration_sec: 13.2,
          warnings: [],
        }),
      });
      return;
    }
    if (url.pathname === '/') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '0.1.6' }) });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
}

async function seedFixture(page: Page, fixture: VisualFixture): Promise<void> {
  await installFixtureBackend(page, fixture);
  await page.goto(fixtureInHash(fixture));
  await expect(page.getByTestId('playwriter-qa-panel')).toBeVisible();
  await expect(page.getByTestId('qa-fixture-ready')).toHaveText(fixture);
  await expect(page.getByTestId('qa-fixture-source-count')).toHaveText('4 fixed source videos');
}

async function openFixtureRoute(page: Page, fixture: VisualFixture, path: string): Promise<void> {
  await seedFixture(page, fixture);
  await page.goto(`/#${path}?fixture=${fixture}`);
  await expect(page.locator('.page')).toBeVisible();
  if (fixture.startsWith('review')) {
    const panel = page.getByTestId('source-clips-panel');
    if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await panel.locator('summary').click();
    }
  }
  if (fixture === 'review-list') {
    await page.getByRole('button', { name: 'List', exact: true }).click();
  }
  if (fixture === 'import-analyzing') {
    await expect(page.locator('[data-analysis-rail]')).toBeVisible();
    await expect(page.getByText('Scoring candidate clips', { exact: true })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(5);
  }
  if (fixture === 'review-grid') {
    await expect(page.getByTestId('candidate-browser-zone')).toBeVisible();
    await expect(page.locator('[data-review-grid]')).toBeVisible();
    await expect(page.locator('[data-review-grid] .clip-card')).toHaveCount(4);
  }
  if (fixture === 'review-list') {
    await expect(page.getByTestId('candidate-browser-zone')).toBeVisible();
    await expect(page.locator('[data-review-list]')).toBeVisible();
    await expect(page.locator('[data-review-list] > *')).toHaveCount(4);
  }
  if (fixture === 'timeline-selection') {
    await expect(page.getByTestId('timeline-items-table')).toBeVisible();
    await page.getByTestId('timeline-clip').first().click();
    await expect(page.getByTestId('timeline-inspector')).toBeVisible();
    await expect(page.getByTestId('timeline-summary')).toContainText('3 items');
  }
  if (fixture === 'export-receipt') {
    await page.getByTestId('export-selected').click();
    await expect(page.getByTestId('export-result-edl')).toBeVisible();
    await expect(page.getByTestId('export-result-edl')).toContainText('CMX 3600 EDL exported');
    await expect(page.getByTestId('export-result-edl')).toContainText('/tmp/ai-clip-assembler/');
  }
}

type FooterExpectation = {
  selector: string;
  state: 'required' | 'expected-missing';
};

const footerExpectations: Record<VisualFixture, FooterExpectation> = {
  shell: { selector: '.workflow-footer', state: 'required' },
  'import-analyzing': { selector: '.workflow-footer', state: 'required' },
  'review-grid': { selector: '.workflow-footer', state: 'required' },
  'review-list': { selector: '.workflow-footer', state: 'required' },
  'timeline-selection': { selector: '.workflow-footer', state: 'required' },
  'export-receipt': { selector: '.workflow-footer', state: 'required' },
};

async function assertShellGeometry(page: Page, fixture: VisualFixture): Promise<void> {
  const footerExpectation = footerExpectations[fixture];
  const region = page.locator(footerExpectation.selector);
  if (footerExpectation.state === 'required') {
    await expect(region, `Missing required region: ${footerExpectation.selector}`).toBeVisible();
  } else {
    await expect(region, `Unexpected pre-Task-2 region: ${footerExpectation.selector}`).toHaveCount(0);
  }
  const geometry = await page.evaluate(({ footerSelector }) => {
    const selectors = ['.sidebar', '[data-surface="project-header"]', '.main', '.statusbar'];
    const boxes = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing shell region: ${selector}`);
      const rect = element.getBoundingClientRect();
      return [selector, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
    }));
    const workspace = document.querySelector('.app-workspace')?.getBoundingClientRect();
    const footer = document.querySelector(footerSelector)?.getBoundingClientRect() ?? null;
    if (!workspace) throw new Error('Missing workspace region');
    return { boxes, workspace, footer, viewport: { width: innerWidth, height: innerHeight } };
  }, { footerSelector: footerExpectation.selector });
  const box = (selector: string) => geometry.boxes[selector] as { left: number; right: number; top: number; bottom: number };
  const header = box('[data-surface="project-header"]');
  const main = box('.main');
  const status = box('.statusbar');
  expect(header.left).toBeGreaterThanOrEqual(0);
  expect(main.left).toBeGreaterThanOrEqual(geometry.workspace.left);
  expect(main.right).toBeLessThanOrEqual(geometry.workspace.right);
  expect(status.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(status.bottom).toBe(geometry.viewport.height);
  if (footerExpectation.state === 'required') {
    expect(geometry.footer, `Missing required region: ${footerExpectation.selector}`).not.toBeNull();
    expect(geometry.footer!.left).toBeGreaterThanOrEqual(geometry.workspace.left - 1);
    expect(geometry.footer!.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  } else {
    expect(geometry.footer, `Unexpected pre-Task-2 region: ${footerExpectation.selector}`).toBeNull();
  }
}

const fixtureRoutes: Array<{ fixture: VisualFixture; path: string }> = [
  { fixture: 'shell', path: '/import' },
  { fixture: 'import-analyzing', path: '/import' },
  { fixture: 'review-grid', path: '/review' },
  { fixture: 'review-list', path: '/review' },
  { fixture: 'timeline-selection', path: '/timeline' },
  { fixture: 'export-receipt', path: '/export' },
];

test.describe('deterministic visual fixture setup', () => {
  for (const { fixture, path } of fixtureRoutes) {
    test(`${fixture} exposes fixed representative data`, async ({ page }) => {
      await openFixtureRoute(page, fixture, path);
      await expect(page.getByText(PROJECT_NAME, { exact: true }).first()).toBeVisible();
      await assertShellGeometry(page, fixture);
      if (fixture === 'import-analyzing') {
        await expect(page.locator('[data-analysis-rail]')).toBeVisible();
        const workstation = page.locator('[data-import-workstation]');
        await expect(workstation.locator('[data-source-aggregates]')).toContainText('4 files');
        await expect(workstation.locator('[data-source-toolbar]')).toBeVisible();
        await expect(workstation.locator('[data-selection-action-rail]')).toBeVisible();
        await expect(workstation.locator('[data-analysis-dock]')).toBeVisible();
        await expect(workstation.locator('[data-rules-region]')).toBeVisible();
        await expect(page.locator('.workflow-footer .workflow-footer-actions')).toContainText('Continue to Review');
      }
      if (fixture.startsWith('review')) {
        await expect(page.getByTestId('candidate-browser-zone')).toBeVisible();
        await expect(page.getByTestId('ask-ai-rail')).toBeVisible();
        await expect(page.getByTestId('suggested-versions-zone')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Your clips' })).toBeVisible();
        await expect(page.getByTestId('source-clips-panel')).toHaveAttribute('data-open', 'true');
      }
      if (fixture === 'timeline-selection') await expect(page.getByTestId('timeline-inspector')).toBeVisible();
      if (fixture === 'export-receipt') await expect(page.getByTestId('export-result-edl')).toContainText('CMX 3600 EDL exported');
    });
  }
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    for (const theme of ['light', 'dark'] as const) {
      for (const { fixture, path } of fixtureRoutes) {
        test(`${fixture} · ${theme}`, async ({ page }) => {
          await openFixtureRoute(page, fixture, path);
          await page.evaluate((nextTheme) => document.documentElement.setAttribute('data-theme', nextTheme), theme);
          await assertShellGeometry(page, fixture);
          await expect(page).toHaveScreenshot(`${fixture}-${viewport.width}x${viewport.height}-${theme}.png`, {
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            mask: [page.locator('video'), page.locator('[data-testid="qa-clock"]')],
          });
        });
      }
    }
  });
}
