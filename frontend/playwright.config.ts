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
  expect: {
    timeout: 20_000,
  },
  // Keep baselines portable across the macOS/Linux CI runners. The project
  // name distinguishes browser projects while the platform is intentionally
  // excluded from the path.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
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
