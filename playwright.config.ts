import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'reports/per88/playwright-results.json' }]],
  outputDir: 'reports/per88/revalidation-artifacts',
  webServer: [
    {
      command: 'LOCAL_DATA_DIR=.local-data/per88-revalidation PORT=8789 npm run server',
      url: 'http://127.0.0.1:8789/api/uploads/limits',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'API_PROXY_TARGET=http://127.0.0.1:8789 npm run dev -- --host 127.0.0.1 --port 5188 --strictPort',
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5188',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
