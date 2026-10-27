import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// A functional smoke run against the candidate demo, never statistical timing evidence.
process.env['PERF_ITERATIONS'] = '1';
process.env['PERF_WARMUP_ITERATIONS'] = '0';

export default defineConfig({
  testDir: '.',
  testMatch: ['contracts/*.spec.ts', 'scenarios/*.perf.ts'],
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'results/check.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4200',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/serve-dist.js',
      cwd: resolve(import.meta.dirname, '..'),
      url: 'http://127.0.0.1:4200',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/serve-dist.js',
      cwd: resolve(import.meta.dirname, '..'),
      env: { PORT: '4302', PERF_BUILD_DIR: 'dist/perf-contracts/browser' },
      url: 'http://127.0.0.1:4302',
      reuseExistingServer: false,
    },
  ],
});
