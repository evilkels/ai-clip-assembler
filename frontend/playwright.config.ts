import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
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
