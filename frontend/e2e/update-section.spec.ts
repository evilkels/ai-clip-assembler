import { expect, test, type Page } from '@playwright/test';
import type { UpdateStatus } from '../src/shared/updateStatus';

async function installBridge(page: Page, initial: UpdateStatus, forced?: UpdateStatus) {
  await page.addInitScript((config) => {
    Object.assign(window, {
      __updateSectionTest: { checks: [] as boolean[], opened: 0 },
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        checkForAppUpdate: async (force?: boolean) => {
          const probe = (window as unknown as { __updateSectionTest: { checks: boolean[] } })
            .__updateSectionTest;
          probe.checks.push(force === true);
          return force && config.forced ? config.forced : config.initial;
        },
        dismissAppUpdate: async () => config.initial,
        openAppReleasePage: async () => {
          const probe = (window as unknown as { __updateSectionTest: { opened: number } })
            .__updateSectionTest;
          probe.opened += 1;
          return { opened: true };
        },
      },
    });
  }, { initial, forced });
}

async function openSettings(page: Page) {
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('update-section')).toBeVisible();
}

test('shows the installed version and up-to-date state when there is no update', async ({ page }) => {
  await installBridge(page, { state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' });
  await openSettings(page);

  await expect(page.getByTestId('update-current-version')).toHaveText('0.1.4');
  await expect(page.getByTestId('update-state')).toHaveText('Up to date');
  // The banner is for updates only; this section is how you confirm you're current.
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
});

test('Check now forces a fresh check and reflects a newly published release', async ({ page }) => {
  await installBridge(
    page,
    { state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' },
    {
      state: 'update-available',
      currentVersion: '0.1.4',
      latestVersion: '0.1.5',
      releaseUrl: 'https://github.com/evilkels/ai-clip-assembler/releases/tag/v0.1.5',
    },
  );
  await openSettings(page);
  await expect(page.getByTestId('update-state')).toHaveText('Up to date');

  await page.getByTestId('update-check-now').click();

  await expect(page.getByTestId('update-state')).toHaveText('Version 0.1.5 is available');
  // The mount check is passive; only the button forces a refresh. Call count is
  // not asserted: the banner and this section both check on mount, and the
  // main process (not this stub) is what collapses concurrent checks.
  const checks = await page.evaluate(
    () => (window as unknown as { __updateSectionTest: { checks: boolean[] } }).__updateSectionTest.checks,
  );
  expect(checks.at(-1)).toBe(true);
  expect(checks.slice(0, -1).every((forced) => forced === false)).toBe(true);
});

test('reports a failed check instead of claiming to be up to date', async ({ page }) => {
  await installBridge(page, {
    state: 'unknown',
    currentVersion: '0.1.4',
    detail: 'GitHub returned HTTP 403',
  });
  await openSettings(page);

  await expect(page.getByTestId('update-state')).toContainText('Latest release unknown');
  await expect(page.getByTestId('update-state')).toContainText('HTTP 403');
});

test('opens the releases page from Settings', async ({ page }) => {
  await installBridge(page, { state: 'up-to-date', currentVersion: '0.1.4', latestVersion: '0.1.4' });
  await openSettings(page);

  await page.getByTestId('update-open-releases').click();

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __updateSectionTest: { opened: number } }).__updateSectionTest.opened,
      ),
    )
    .toBe(1);
});
