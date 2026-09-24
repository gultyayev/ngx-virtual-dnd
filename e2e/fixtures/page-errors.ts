import { Page } from '@playwright/test';

/**
 * Record console errors and uncaught page errors from now on. Call it BEFORE navigating so
 * errors during the initial render count too.
 */
export function collectPageErrors(page: Page): { unexpected: () => string[] } {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

  return {
    /** Errors except known benign noise (missing favicon, aborted or missing requests). */
    unexpected: () =>
      errors.filter(
        (text) => !text.includes('favicon') && !text.includes('net::ERR_') && !text.includes('404'),
      ),
  };
}
