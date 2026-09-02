import { expect, test, type Page } from '@playwright/test';
import type { UpdateStatus } from '../src/shared/updateStatus';

/**
 * The shell keeps one grid item for each row: project header, banner slot,
 * workspace, and status bar. Hiding an empty row with `display: none` silently
 * shifts every later row and makes the fixed status row inherit the `1fr` track.
 * These tests measure the geometry instead of only asserting visibility.
 */
const STATUS_BAR_HEIGHT = 34;
const WORKFLOW_FOOTER_MIN_HEIGHT = 64;

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
      footerHeight: document.querySelector('.workflow-footer')?.getBoundingClientRect().height ?? 0,
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
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight - layout.footerHeight,
  );
  expect(layout.footerHeight).toBeGreaterThanOrEqual(WORKFLOW_FOOTER_MIN_HEIGHT);
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
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight - layout.footerHeight,
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
    layout.viewportHeight - STATUS_BAR_HEIGHT - layout.bannerHeight - layout.headerHeight - layout.footerHeight,
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
  const status = page.locator('.statusbar');
  await expect(status).toHaveAttribute('data-surface', 'status');

  const shellBounds = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      sidebar: box('.sidebar'),
      rail: box('.workflow-rail'),
      workspace: box('.app-workspace'),
      main: box('.main'),
      status: box('.statusbar'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      statusStyle: (() => {
        const style = getComputedStyle(document.querySelector('.statusbar')!);
        return { background: style.backgroundColor, shadow: style.boxShadow };
      })(),
    };
  });

  expect(shellBounds.rail.left).toBeGreaterThanOrEqual(shellBounds.sidebar.left);
  expect(shellBounds.rail.right).toBeLessThanOrEqual(shellBounds.sidebar.right);
  expect(shellBounds.rail.top).toBeGreaterThanOrEqual(shellBounds.sidebar.top);
  expect(shellBounds.rail.bottom).toBeLessThanOrEqual(shellBounds.sidebar.bottom);
  expect(shellBounds.main.left).toBeGreaterThanOrEqual(shellBounds.workspace.left);
  expect(shellBounds.main.right).toBeLessThanOrEqual(shellBounds.workspace.right);
  expect(shellBounds.main.top).toBeGreaterThanOrEqual(shellBounds.workspace.top);
  expect(shellBounds.main.bottom).toBeLessThanOrEqual(shellBounds.workspace.bottom);
  expect(shellBounds.status.left).toBeGreaterThanOrEqual(0);
  expect(shellBounds.status.right).toBeLessThanOrEqual(shellBounds.viewport.width);
  expect(shellBounds.status.top).toBeGreaterThanOrEqual(0);
  expect(shellBounds.status.bottom).toBe(shellBounds.viewport.height);
  expect(shellBounds.statusStyle.background).not.toBe('rgb(13, 15, 18)');
  expect(shellBounds.statusStyle.shadow).not.toBe('none');

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

test('studio shell exposes counts, metadata, a real logo, and a collapsible rail', async ({ page }) => {
  await installBridge(page, {
    state: 'up-to-date',
    currentVersion: '0.1.4',
    latestVersion: '0.1.4',
  });
  await page.goto('/#/review');

  await expect(page.locator('.workflow-footer')).toBeVisible();
  await expect(page.locator('.project-row-count, .step-count').first()).toBeVisible();
  const shellDimensions = await page.evaluate(() => ({
    sidebar: document.querySelector<HTMLElement>('.sidebar')?.getBoundingClientRect().width ?? 0,
    header: document.querySelector<HTMLElement>('.project-header')?.getBoundingClientRect().height ?? 0,
  }));
  expect(shellDimensions.sidebar).toBeGreaterThanOrEqual(260);
  expect(shellDimensions.sidebar).toBeLessThanOrEqual(268);
  expect(shellDimensions.header).toBeGreaterThanOrEqual(60);
  await expect.poll(async () => page.locator('.sidebar-brand-logo').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await expect(page.locator('.step-link.active')).not.toHaveCSS('box-shadow', /inset 2px 0/);

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Diagnostics', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload files instead', exact: true })).toBeVisible();
  const collapsedRail = await page.locator('.sidebar').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(collapsedRail.width).toBeLessThanOrEqual(64);
  expect(collapsedRail.scrollWidth).toBeLessThanOrEqual(collapsedRail.clientWidth);
});
