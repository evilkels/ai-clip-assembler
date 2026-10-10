import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const prototypeDirectory = resolve(__dirname, '../../docs/designs/remote-view/prototype');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
] as const);

function syntheticProject() {
  return {
    name: 'Synthetic Project',
    sources: [],
    uploads: [],
    clips: [
      {
        clip_id: 'synthetic-clip-a', rank: 1, duration_sec: 4.2, overall_score: 8.4,
        width: 1280, height: 720, decision: null as string | null,
      },
      {
        clip_id: 'synthetic-clip-b', rank: 2, duration_sec: 3.6, overall_score: 7.1,
        width: 1280, height: 720, decision: null as string | null,
      },
    ],
    timeline_order: [],
    exports_active: 0,
    now: { state: 'idle', analyzed_at: '2026-01-01T00:00:00Z' },
    harness: 'Synthetic Harness',
  };
}

const thumbnail = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36" viewBox="0 0 64 36"><rect width="64" height="36" fill="#777"/><circle cx="32" cy="18" r="8" fill="#bbb"/></svg>`;

test('idle polling keeps thumbnails stable and renders changed clip decisions', async ({ page }) => {
  const project = syntheticProject();
  let projectRequests = 0;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.hostname).toBe('remote-prototype.test');

    const asset = assets.get(url.pathname);
    if (asset) {
      await route.fulfill({
        status: 200,
        contentType: asset[1],
        body: readFileSync(resolve(prototypeDirectory, asset[0])),
      });
      return;
    }

    if (url.pathname === '/manifest.json') {
      await route.fulfill({ status: 200, contentType: 'application/manifest+json', body: '{}' });
      return;
    }
    if (url.pathname.startsWith('/thumb/')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: thumbnail });
      return;
    }
    if (url.pathname === '/api/me') {
      await route.fulfill({ status: 200, json: { paired: true } });
      return;
    }
    if (url.pathname === '/api/project') {
      projectRequests += 1;
      await route.fulfill({
        status: 200,
        json: { ...project, server_time: `synthetic-clock-${projectRequests}` },
      });
      return;
    }
    if (url.pathname === '/api/decision' && route.request().method() === 'POST') {
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }

    await route.abort('blockedbyclient');
  });

  await page.goto('/#/project/clips');
  const thumbnailImage = page.locator('img[src="/thumb/synthetic-clip-a.jpg"]');
  await expect(thumbnailImage).toBeVisible();
  await expect.poll(() => projectRequests).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: /Connection:/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await thumbnailImage.evaluate((image) => {
    (window as typeof window & { __initialThumbnail?: HTMLImageElement }).__initialThumbnail = image;
  });

  await page.clock.runFor(7_500);
  await expect.poll(() => projectRequests).toBeGreaterThanOrEqual(4);
  await expect(thumbnailImage).toHaveJSProperty('isConnected', true);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => {
    const initial = (window as typeof window & { __initialThumbnail?: HTMLImageElement }).__initialThumbnail;
    return initial === document.querySelector('img[src="/thumb/synthetic-clip-a.jpg"]');
  })).toBe(true);

  await page.locator('.scrim').click({ position: { x: 2, y: 2 } });
  await page.getByRole('tab', { name: /All/ }).click();

  project.clips[1].decision = 'accepted';
  await page.clock.runFor(2_500);
  await expect(page.getByRole('tab', { name: /Accepted · 1/ })).toBeVisible();
  await expect(page.locator('.cell[aria-label*="Clip 2"][aria-label*="accepted"]')).toBeVisible();
});
