import { Page } from '@playwright/test';

/**
 * Record console errors and uncaught page errors from now on. Call it BEFORE navigating so
 * errors during the initial render count too.
 *
 * A page loaded more than once counts as an error too: load the page once per test (pick its
 * settings through the URL). A second load aborts the first page's pending requests, and
 * Firefox reports aborted font downloads as console errors, so the test would fail only
 * sometimes and only in Firefox. In-app route changes are not loads.
 */
export function collectPageErrors(page: Page): { unexpected: () => string[] } {
  const errors: string[] = [];
  let loads = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('domcontentloaded', (loaded) => {
    // Firefox also reports the blank document a new page starts with
    if (loaded.url() !== 'about:blank') {
      loads += 1;
    }
  });

  return {
    /** Errors except known benign noise (missing favicon, aborted or missing requests). */
    unexpected: () => [
      ...(loads > 1 ? [`page loaded ${loads} times: load it once per test`] : []),
      ...errors.filter(
        (text) => !text.includes('favicon') && !text.includes('net::ERR_') && !text.includes('404'),
      ),
    ],
  };
}
