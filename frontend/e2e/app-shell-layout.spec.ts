import { expect, test, type Page } from '@playwright/test';
import type { UpdateStatus } from '../src/shared/updateStatus';

/**
 * The shell is a three-row grid: banner slot, workspace, status bar. Hiding the
 * empty banner slot with `display: none` silently shifted every row up one, so
 * the status bar inherited the `1fr` row and grew to ~156px while the workspace
 * shrank to its content height. Nothing caught it — hence these measurements.
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
    const workspace = document.querySelector('.app-workspace') as HTMLElement;
    const banners = document.querySelector('.app-banners') as HTMLElement;
    const barBox = bar.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      barHeight: barBox.height,
      barBottom: barBox.bottom,
      bannerHeight: banners.getBoundingClientRect().height,
      workspaceHeight: workspace.getBoundingClientRect().height,
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
  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  // Flush with the bottom of the window, not pushed past it.
  expect(layout.barBottom).toBe(layout.viewportHeight);
  expect(layout.workspaceHeight).toBe(layout.viewportHeight - STATUS_BAR_HEIGHT);
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
  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  expect(layout.barBottom).toBe(layout.viewportHeight);
  expect(layout.workspaceHeight).toBe(
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight,
  );
});

test('the layout survives a failing update check', async ({ page }) => {
  await installBridge(page, null);
  await page.goto('/#/import');
  await page.locator('.statusbar').waitFor();

  const layout = await measure(page);

  expect(layout.barHeight).toBe(STATUS_BAR_HEIGHT);
  expect(layout.barBottom).toBe(layout.viewportHeight);
});
