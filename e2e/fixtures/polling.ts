import { expect } from '@playwright/test';

/**
 * Retry intervals for retrying assertions: re-check after about a frame, then every 100 ms.
 *
 * Playwright's default back-off ([100, 250, 500, 1000] ms, then every second) overshoots waits
 * on frame-driven state by up to a second. playwright.config.ts applies these intervals to every
 * `toPass()`; `expect.poll()` has no config default, so use `poll()` below instead.
 * (Sharing one array is safe from Playwright 1.63; older versions consumed it on first use.)
 */
export const POLL_INTERVALS = [16, 32, 50, 100];

/** `expect.poll()` with POLL_INTERVALS. */
export function poll<T>(
  actual: () => T | Promise<T>,
  options: { message?: string; timeout?: number } = {},
) {
  return expect.poll(actual, { intervals: POLL_INTERVALS, ...options });
}
