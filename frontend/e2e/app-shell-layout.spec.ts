import { expect, test, type Page } from '@playwright/test';
import type { UpdateStatus } from '../src/shared/updateStatus';

/**
 * The shell keeps one grid item for each row: project header, banner slot,
 * workspace, and status bar. Hiding an empty row with `display: none` silently
 * shifts every later row and makes the fixed status row inherit the `1fr` track.
 * These tests measure the geometry instead of only asserting visibility.
 */
const STATUS_BAR_HEIGHT = 28;

async function installBridge(page: Page, status: UpdateStatus | null) {
  await page.addInitScript((config) => {
    Object.assign(window, {
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        checkForAppUpdate: async () => {
          if (!config) throw new Error('no update bridge');
          return config;
        },
        dismissAppUpdate: async () => config,
        openAppReleasePage: async () => ({ opened: true }),
      },
    });
  }, status);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.statusbar') as HTMLElement;
    const header = document.querySelector('.project-header') as HTMLElement | null;
    const workspace = document.querySelector('.app-workspace') as HTMLElement;
    const banners = document.querySelector('.app-banners') as HTMLElement;
    const barBox = bar.getBoundingClientRect();
    const headerBox = header?.getBoundingClientRect();
    const workspaceBox = workspace.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      headerHeight: headerBox?.height ?? 0,
      headerBottom: headerBox?.bottom ?? 0,
      barHeight: barBox.height,
      barBottom: barBox.bottom,
      bannerHeight: banners.getBoundingClientRect().height,
      workspaceTop: workspaceBox.top,
      workspaceHeight: workspaceBox.height,
    };
  });
}

test('status bar keeps its own row when there is no banner to show', async ({ page }) => {
  await installBridge(page, {
    state: 'up-to-date',
    currentVersion: '0.1.4',
    latestVersion: '0.1.4',
  });
  await page.goto('/#/import');
  await page.locator('.statusbar').waitFor();

  const layout = await measure(page);

  expect(layout.bannerHeight).toBe(0);
  expect(layout.headerHeight).toBeGreaterThan(0);
  expect(layout.workspaceTop).toBe(layout.headerBottom);
  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  // Flush with the bottom of the window, not pushed past it.
  expect(layout.barBottom).toBe(layout.viewportHeight);
  expect(layout.workspaceHeight).toBe(
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight,
  );
});

test('a visible banner takes its own row without displacing the status bar', async ({ page }) => {
  await installBridge(page, {
    state: 'update-available',
    currentVersion: '0.1.0',
    latestVersion: '0.1.4',
    releaseUrl: 'https://github.com/evilkels/ai-clip-assembler/releases/tag/v0.1.4',
  });
  await page.goto('/#/import');
  await page.getByTestId('update-banner').waitFor();

  const layout = await measure(page);

  expect(layout.bannerHeight).toBeGreaterThan(0);
  expect(layout.headerHeight).toBeGreaterThan(0);
  expect(layout.workspaceTop).toBe(layout.headerBottom + layout.bannerHeight);
  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  expect(layout.barBottom).toBe(layout.viewportHeight);
  expect(layout.workspaceHeight).toBe(
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight,
  );
});

test('the layout survives a failing update check', async ({ page }) => {
  await installBridge(page, null);
  await page.goto('/#/import');
  await page.locator('.statusbar').waitFor();

  const layout = await measure(page);

  expect(layout.headerHeight).toBeGreaterThan(0);
  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  expect(layout.barBottom).toBe(layout.viewportHeight);
  expect(layout.workspaceHeight).toBe(
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight,
  );
});

test('studio shell exposes an active workflow rail and themed surfaces', async ({ page }) => {
  await installBridge(page, {
    state: 'up-to-date',
    currentVersion: '0.1.4',
    latestVersion: '0.1.4',
  });
  await page.goto('/#/review');

  const rail = page.locator('.workflow-rail');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('link', { name: /Review/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.statusbar')).toHaveAttribute('data-surface', 'status');

  const themes = await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    const dark = getComputedStyle(root).getPropertyValue('--bg-0').trim();
    root.setAttribute('data-theme', 'light');
    const light = getComputedStyle(root).getPropertyValue('--bg-0').trim();
    return { dark, light };
  });

  expect(themes.dark).toBe('#08090b');
  expect(themes.light).toBe('#e9eaec');
});
