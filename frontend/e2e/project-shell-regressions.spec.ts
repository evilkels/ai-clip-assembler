import { expect, test, type Page } from '@playwright/test';

const folderPath = '/Users/elvijs/Projects/' + 'x'.repeat(1_400);
const projectName = 'Long Footage';
const videos = Array.from({ length: 7 }, (_, index) => ({
  file_id: `video-${index + 1}`,
  file_name: `drone-footage-${index + 1}.MP4`,
  status: 'ready',
  metadata: {
    file_id: `video-${index + 1}`,
    file_name: `drone-footage-${index + 1}.MP4`,
    duration_sec: 12,
    fps: 59.94,
    resolution: [3840, 2160],
    codec: 'hevc',
    size_bytes: 12_000_000,
    created_at: '2026-08-11T10:00:00Z',
  },
}));

async function openFolderProject(page: Page): Promise<void> {
  await page.addInitScript(({ path, name }) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => [{ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }],
        getLastOpenedRecentProject: async () => ({ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }),
        addRecentProject: async () => [{ folderPath: path, lastOpenedAt: '2026-08-11T10:00:00Z', name }],
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, { path: folderPath, name: projectName });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'shell-regression-project',
          project_folder: folderPath,
          project: {
            schema_version: 1,
            name: projectName,
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
    if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clips: [] }) });
      return;
    }
    if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
          sequence_fingerprint: '',
          review_context_fingerprint: '',
        }),
      });
      return;
    }
    if (url.pathname === '/harnesses') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ harnesses: [] }) });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/import');
  await expect(page.getByText('7 source videos ready')).toBeVisible();
}

async function measureImportLayout(page: Page) {
  return page.evaluate(() => {
    const pageElement = document.querySelector('.page') as HTMLElement;
    const main = document.querySelector('.main') as HTMLElement;
    const table = document.querySelector('table') as HTMLElement;
    const mainBox = main.getBoundingClientRect();
    return {
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
      mainRight: mainBox.right,
      tableRight: table.getBoundingClientRect().right,
      headers: [...document.querySelectorAll('th')].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    };
  });
}

test.describe('import page horizontal geometry', () => {
  test.describe('at the 1024px minimum width', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('keeps the page and source table inside the main column', async ({ page }) => {
      await openFolderProject(page);
      const layout = await measureImportLayout(page);

      expect(layout.pageScrollWidth).toBe(layout.pageClientWidth);
      expect(layout.tableRight).toBeLessThanOrEqual(layout.mainRight);
      expect(layout.headers.every((header) => header.left >= 238 && header.right <= layout.mainRight)).toBe(true);
    });
  });

  test.describe('at 1440px', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('keeps the page and source table inside the main column', async ({ page }) => {
      await openFolderProject(page);
      const layout = await measureImportLayout(page);

      expect(layout.pageScrollWidth).toBe(layout.pageClientWidth);
      expect(layout.tableRight).toBeLessThanOrEqual(layout.mainRight);
      expect(layout.headers.every((header) => header.left >= 238 && header.right <= layout.mainRight)).toBe(true);
    });
  });
});

test('projects stay alphabetized after opening a recent project', async ({ page }) => {
  const seededProjects = [
    { folderPath: '/projects/zulu', lastOpenedAt: '2026-08-11T13:00:00Z', name: 'Zulu Project', missing: false },
    { folderPath: '/projects/alpha', lastOpenedAt: '2026-08-11T10:00:00Z', name: 'alpha Project', missing: false },
    { folderPath: '/projects/mike', lastOpenedAt: '2026-08-11T12:00:00Z', name: 'Mike Project', missing: false },
    { folderPath: '/projects/bravo', lastOpenedAt: '2026-08-11T11:00:00Z', name: 'bravo Project', missing: false },
  ];

  await page.addInitScript((projects) => {
    let recents = projects;
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => recents,
        getLastOpenedRecentProject: async () => null,
        addRecentProject: async (folderPath: string) => {
          const selected = recents.find((project) => project.folderPath === folderPath);
          recents = selected
            ? [{ ...selected, lastOpenedAt: '2026-08-11T14:00:00Z' }, ...recents.filter((project) => project.folderPath !== folderPath)]
            : recents;
          return recents;
        },
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, seededProjects);

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'ordered-project',
          project_folder: '/projects/zulu',
          project: {
            schema_version: 1,
            name: 'Zulu Project',
            created_at: '2026-08-11T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: [],
            settings_overrides: {},
          },
          videos: [],
          clips: [],
          timeline: null,
          generation_stats: null,
        }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/import');
  const rows = page.locator('.project-row-name');
  await expect(rows).toHaveText(['alpha Project', 'bravo Project', 'Mike Project', 'Zulu Project']);
  const beforeOpen = await rows.allTextContents();

  await page.getByRole('button', { name: 'Open Zulu Project' }).click();
  await expect(page.getByText('Zulu Project', { exact: true }).first()).toBeVisible();
  await expect(rows).toHaveText(beforeOpen);
});

test('the selected project receives the studio active treatment', async ({ page }) => {
  await openFolderProject(page);
  const row = page.locator('.project-row-wrap').filter({ hasText: projectName });
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(row).toHaveClass(/project-row-active/);
});

test('project cards expose labelled actions and locate only for missing folders', async ({ page }) => {
  const seededProjects = [
    { folderPath: '/projects/visible', lastOpenedAt: '2026-08-11T10:00:00Z', name: 'Visible Project', missing: false },
    { folderPath: '/projects/missing', lastOpenedAt: '2026-08-11T11:00:00Z', name: 'Missing Project', missing: true },
  ];

  await page.addInitScript((projects) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => projects,
        getLastOpenedRecentProject: async () => null,
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, seededProjects);
  await page.route('http://127.0.0.1:8000/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.goto('/#/import');
  const missingRow = page.locator('.project-row-wrap').filter({ hasText: 'Missing Project' });
  const visibleRow = page.locator('.project-row-wrap').filter({ hasText: 'Visible Project' });

  await expect(missingRow.getByText('missing', { exact: true })).toBeVisible();
  await expect(missingRow.getByRole('button', { name: 'Locate Missing Project' })).toBeVisible();
  // Healthy projects carry no state chip; only the exceptional "missing" state is labelled.
  await expect(visibleRow.getByText('missing', { exact: true })).toHaveCount(0);
  await expect(visibleRow.getByRole('button', { name: 'Locate Visible Project' })).toHaveCount(0);
  await expect(visibleRow.getByRole('button', { name: 'Open Visible Project' })).toBeVisible();
  await expect(visibleRow.getByRole('button', { name: 'Rename Visible Project' })).toBeVisible();
  await expect(visibleRow.getByRole('button', { name: 'Remove Visible Project' })).toBeVisible();

  const buttonGeometry = await missingRow.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { height: box.height, ariaLabel: button.getAttribute('aria-label') };
    }),
  );
  expect(buttonGeometry.every(({ height, ariaLabel }) => height >= 24 && ariaLabel?.includes('Missing Project'))).toBe(true);
});

test('removing a recent project is gated behind a confirmation dialog', async ({ page }) => {
  const seededProjects = [
    { folderPath: '/projects/alpha', lastOpenedAt: '2026-08-11T10:00:00Z', name: 'Alpha Project', missing: false },
    { folderPath: '/projects/bravo', lastOpenedAt: '2026-08-11T11:00:00Z', name: 'Bravo Project', missing: false },
  ];

  await page.addInitScript((projects) => {
    let recents = projects;
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => recents,
        getLastOpenedRecentProject: async () => null,
        removeRecentProject: async (folderPath: string) => {
          recents = recents.filter((project) => project.folderPath !== folderPath);
          return recents;
        },
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, seededProjects);
  await page.route('http://127.0.0.1:8000/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.goto('/#/import');
  const rows = page.locator('.project-row-name');
  await expect(rows).toHaveText(['Alpha Project', 'Bravo Project']);

  // Cancelling leaves the project in place.
  await page.getByRole('button', { name: 'Remove Alpha Project' }).click();
  const dialog = page.getByRole('dialog', { name: /Remove Alpha Project\?/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveText(['Alpha Project', 'Bravo Project']);

  // Confirming drops it from the list.
  await page.getByRole('button', { name: 'Remove Alpha Project' }).click();
  await page.getByRole('button', { name: 'Remove from list' }).click();
  await expect(rows).toHaveText(['Bravo Project']);
});

test('renaming a recent project updates its row and header without changing the folder', async ({ page }) => {
  const folderPath = '/projects/bravo';
  const seededProjects = [
    { folderPath: '/projects/zulu', lastOpenedAt: '2026-08-11T13:00:00Z', name: 'zulu Project', missing: false },
    { folderPath: '/projects/alpha', lastOpenedAt: '2026-08-11T10:00:00Z', name: 'alpha Project', missing: false },
    { folderPath, lastOpenedAt: '2026-08-11T11:00:00Z', name: 'bravo Project', missing: false },
    { folderPath: '/projects/mike', lastOpenedAt: '2026-08-11T12:00:00Z', name: 'Mike Project', missing: false },
  ];

  await page.addInitScript(({ projects, openPath }) => {
    let recents = projects;
    const find = (path: string) => recents.find((project) => project.folderPath === path);
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        listRecentProjects: async () => recents,
        getLastOpenedRecentProject: async () => find(openPath) ?? null,
        addRecentProject: async (path: string) => {
          const selected = find(path);
          recents = selected
            ? [{ ...selected, lastOpenedAt: '2026-08-11T14:00:00Z' }, ...recents.filter((project) => project.folderPath !== path)]
            : recents;
          return recents;
        },
        renameRecentProject: async (path: string, name: string) => {
          const normalized = name.trim();
          if (!normalized) throw new Error('Project name must contain at least one non-whitespace character');
          recents = recents.map((project) =>
            project.folderPath === path ? { ...project, name: Array.from(normalized).slice(0, 80).join('') } : project,
          );
          return recents;
        },
        checkForAppUpdate: async () => ({ state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' }),
      },
    });
  }, { projects: seededProjects, openPath: folderPath });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'rename-project',
          project_folder: folderPath,
          project: {
            schema_version: 1,
            name: 'bravo Project',
            created_at: '2026-08-11T10:00:00Z',
            harness: 'manual',
            cloud_ai_consent: false,
            source_videos: [],
            settings_overrides: {},
          },
          videos: [],
          clips: [],
          timeline: null,
          generation_stats: null,
        }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/import');
  await expect(page.locator('.project-header-name')).toHaveText('bravo Project');
  const rows = page.locator('.project-row-name');
  await expect(rows).toHaveText(['alpha Project', 'bravo Project', 'Mike Project', 'zulu Project']);

  const originalRow = page.locator('.project-row-wrap').filter({ hasText: 'bravo Project' });
  await originalRow.getByRole('button', { name: 'Rename bravo Project' }).click();
  const input = page.getByLabel('Project name');
  await expect(input).toBeFocused();
  await input.fill('Aardvark Project');
  await input.press('Enter');

  await expect(page.locator('.project-header-name')).toHaveText('Aardvark Project');
  await expect(rows).toHaveText(['Aardvark Project', 'alpha Project', 'Mike Project', 'zulu Project']);
  const renamedRow = page.locator('.project-row-wrap').filter({ hasText: 'Aardvark Project' });
  await expect(renamedRow.getByRole('button', { name: 'Rename Aardvark Project' })).toBeFocused();

  await renamedRow.getByRole('button', { name: 'Rename Aardvark Project' }).click();
  await page.getByLabel('Project name').fill('Discarded Project');
  await page.getByLabel('Project name').press('Escape');
  await expect(page.locator('.project-header-name')).toHaveText('Aardvark Project');
  await expect(page.locator('.project-row-wrap').filter({ hasText: 'Aardvark Project' })).toBeVisible();

  await page
    .locator('.project-row-wrap')
    .filter({ hasText: 'Aardvark Project' })
    .getByRole('button', { name: 'Rename Aardvark Project' })
    .click();
  await page.getByLabel('Project name').fill('   ');
  await page.getByLabel('Project name').press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Project name must contain at least one non-whitespace character');
  await expect(page.locator('.project-header-name')).toHaveText('Aardvark Project');
  // The row survives the rejected rename — while editing it is the row holding the editor.
  const preservedRow = page
    .locator('.project-row-wrap')
    .filter({ has: page.locator('.project-rename-editor') });
  await expect(preservedRow).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  const header = page.locator('.project-header');
  await header.getByRole('button', { name: 'Rename Aardvark Project' }).click();
  await expect(page.getByLabel('Project name')).toBeFocused();
  await page.getByLabel('Project name').fill('Header Project');
  await page.getByLabel('Project name').press('Enter');
  await expect(header.locator('.project-header-name')).toHaveText('Header Project');
  await expect(rows).toHaveText(['alpha Project', 'Header Project', 'Mike Project', 'zulu Project']);
  await expect(header.locator('.project-header-path')).toHaveAttribute('title', folderPath);
  await expect(header.getByRole('button', { name: 'Rename Header Project' })).toBeFocused();
});
