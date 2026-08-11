import { expect, test, type Page } from '@playwright/test';
import type { UpdateStatus } from '../src/shared/updateStatus';

async function installUpdateBridge(page: Page, initial: UpdateStatus) {
  await page.addInitScript((config) => {
    let current = config;
    Object.assign(window, {
      __updateTest: {
        opened: 0,
        dismissed: [] as string[],
      },
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        checkForAppUpdate: async () => current,
        dismissAppUpdate: async (version: string) => {
          const probe = (window as unknown as { __updateTest: { dismissed: string[] } }).__updateTest;
          probe.dismissed.push(version);
          current = {
            state: 'dismissed',
            currentVersion: current.currentVersion,
            latestVersion: version,
          };
          return current;
        },
        openAppReleasePage: async () => {
          const probe = (window as unknown as { __updateTest: { opened: number } }).__updateTest;
          probe.opened += 1;
          return { opened: true };
        },
      },
    });
  }, initial);
}

const availableUpdate: UpdateStatus = {
  state: 'update-available',
  currentVersion: '0.1.0',
  latestVersion: '0.1.4',
  releaseUrl: 'https://github.com/evilkels/ai-clip-assembler/releases/tag/v0.1.4',
};

test('announces a newer release and opens the release page', async ({ page }) => {
  await installUpdateBridge(page, availableUpdate);
  await page.goto('/#/import');

  const banner = page.getByTestId('update-banner');
  await expect(banner).toContainText('Version 0.1.4 is available');
  await expect(banner).toContainText('you have 0.1.0');

  await page.getByTestId('update-banner-download').click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __updateTest: { opened: number } }).__updateTest.opened))
    .toBe(1);
});

test('dismissing the notice hides the banner', async ({ page }) => {
  await installUpdateBridge(page, availableUpdate);
  await page.goto('/#/import');

  await page.getByTestId('update-banner-dismiss').click();

  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __updateTest: { dismissed: string[] } }).__updateTest.dismissed),
  ).toEqual(['0.1.4']);
});

test('stays silent when the app is already up to date', async ({ page }) => {
  await installUpdateBridge(page, {
    state: 'up-to-date',
    currentVersion: '0.1.4',
    latestVersion: '0.1.4',
  });
  await page.goto('/#/import');

  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
});
