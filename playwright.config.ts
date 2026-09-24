import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLL_INTERVALS } from './e2e/fixtures/polling';

// macOS 27 TCC-protects ~/Library/Application Support/Firefox, and Playwright's Firefox reads
// its app-data dir at startup even with an explicit -profile, so launch exits with
// "Could not find profile folder". Point CoreFoundation's home at a scratch dir instead.
// See https://github.com/microsoft/playwright/issues/42768
const firefoxEnv =
  process.platform === 'darwin'
    ? (() => {
        const cfHome = join(tmpdir(), 'playwright-firefox-cf-home');
        mkdirSync(cfHome, { recursive: true });
        return { env: { ...process.env, CFFIXED_USER_HOME: cfHome } };
      })()
    : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Keep local runs single-shot so flakes are visible; CI still retries for browser variance.
  retries: process.env.CI ? 2 : 0,
  // GitHub runners have 4 vCPUs: two workers (one browser each) halve the wall time, while more
  // workers starve the time-based autoscroll tests of frames.
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }]],
  // Poll toPass() about once a frame at first instead of Playwright's 100/250/500/1000 ms
  // back-off, which overshoots frame-driven waits by up to a second (see e2e/fixtures/polling.ts).
  expect: { toPass: { intervals: POLL_INTERVALS } },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Firefox routes even localhost through an HTTP(S)_PROXY env var and ignores
        // NO_PROXY/bypass entries for it, so page.goto('127.0.0.1:4200') hangs in proxied
        // environments (e.g. Claude Code on the web). Chromium/WebKit honor the bypass and
        // are unaffected. E2E only ever hits the local dev server, so force a direct
        // connection (network.proxy.type = 0 = no proxy) for Firefox.
        launchOptions: { firefoxUserPrefs: { 'network.proxy.type': 0 }, ...firefoxEnv },
      },
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /.*\.mobile\.spec\.ts/,
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      testMatch: /.*\.mobile\.spec\.ts/,
    },
  ],
  // CI serves the production build from the build job's artifact: its optimized bundles load
  // ~2x faster than the dev server's, and every test starts with a page load. Local runs keep
  // `ng serve` (live library rebuilds, Angular dev-mode checks). To reproduce CI locally:
  // `npm run build:lib && npm run build && CI=1 npx playwright test`.
  webServer: {
    command: process.env.CI
      ? 'node scripts/serve-dist.js'
      : 'npm start -- --host 127.0.0.1 --port 4200',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
