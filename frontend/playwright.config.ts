import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Specs share one local FastAPI process and its in-memory project registry.
  // Parallel workers can clear another spec's project while analysis is running.
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
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
