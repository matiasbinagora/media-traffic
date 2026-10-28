import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const reportDirectory = path.resolve(process.cwd(), process.env.PLAYWRIGHT_REPORT_DIR || 'reports/per88');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/per89-global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(reportDirectory, 'playwright-results.json') }]],
  outputDir: path.join(reportDirectory, 'revalidation-artifacts'),
  webServer: [
    {
      command: 'LOCAL_DATA_DIR=.local-data/per89-playwright FFMPEG_PATH=e2e/fixtures/ffmpeg-fail-once.cjs FFMPEG_FAIL_ONCE_MARKER=.local-data/per89-ffmpeg-failed-once REAL_FFMPEG_PATH=ffmpeg PORT=8789 npm run server',
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
