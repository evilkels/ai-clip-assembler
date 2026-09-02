import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Specs share one local FastAPI process and its in-memory project registry.
  // Parallel workers can clear another spec's project while analysis is running.
  workers: 1,
  // A single flaky assertion previously failed a whole CI run (v0.1.6's main
  // build) with no second chance. Retries only on CI, so a local failure still
  // reports immediately, and a retried test is reported as flaky rather than
  // silently green.
  retries: process.env.CI ? 2 : 0,
  timeout: 180_000,
  // The suite bounds itself so a single wedged test cannot consume the whole
  // job budget. 103 tests at the 180s per-test limit with two CI retries is
  // ~15 hours in the worst case, which no runner timeout should have to absorb.
  // Local full runs take 9-12 minutes and CI has done it in under 3.
  globalTimeout: process.env.CI ? 20 * 60_000 : 30 * 60_000,
  expect: {
    timeout: 20_000,
    // Within a single platform the renders still jitter by up to ~27px of glyph
    // antialiasing between runs. A real layout regression moves thousands of
    // pixels, so this absorbs the noise without hiding a genuine change.
    toHaveScreenshot: { maxDiffPixels: 150 },
  },
  // Baselines are stored per platform. Screenshots are not portable across
  // macOS and Linux: the same layout renders with different font rasterization,
  // which is 14k-18k differing pixels on a 1440x1000 shot -- far more than any
  // useful tolerance. Both sets are committed so `npm run test:e2e` is green on
  // a macOS dev machine and on the Linux CI runner.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{projectName}-{platform}{ext}',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'cd ../backend && PYTHONPATH=. .venv/bin/uvicorn src.api:app --port 8000',
      url: 'http://127.0.0.1:8000/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:renderer -- --host localhost',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
