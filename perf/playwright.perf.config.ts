import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './scenarios',
  testMatch: '**/*.perf.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Scenarios run 6 iterations under 4x CPU throttling, some reloading the page
  // and holding autoscroll for seconds each — well beyond a normal E2E test.
  timeout: 240_000,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env['PERF_RESULT_PATH'] ?? 'results/latest.json' }],
  ],
  use: {
    baseURL: process.env['PERF_BASE_URL'] ?? 'http://127.0.0.1:4200',
    ...devices['Desktop Chrome'],
    headless: true,
    video: 'off',
    screenshot: 'off',
    trace: 'off',
  },
  webServer:
    process.env['PERF_MANAGED_SERVER'] === '1'
      ? undefined
      : {
          command: 'node scripts/serve-dist.js',
          cwd: resolve(import.meta.dirname, '..'),
          url: 'http://127.0.0.1:4200',
          reuseExistingServer: false,
          timeout: 120_000,
        },
});
