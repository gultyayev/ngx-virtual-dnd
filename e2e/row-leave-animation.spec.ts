import { expect, test } from '@playwright/test';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

/**
 * A list with `recycleRows` whose rows play a leave animation (`animate.leave`): Angular removes
 * a leaving row's element when that animation ends, so the view must not render another row.
 */
test.describe('Row recycling with a row leave animation', () => {
  test('keeps the rows that scroll in once the rows that scrolled out animated out', async ({
    page,
  }) => {
    await page.goto('/row-leave-animation', { waitUntil: 'domcontentloaded' });
    const list = page.locator('vdnd-virtual-scroll');
    await expect(page.locator('[data-draggable-id="row-0"]')).toBeVisible();

    // Row 20 at the top: rows 0-11 leave the range and fade out, rows 17-31 render
    await list.evaluate((element) => {
      element.scrollTop = 1000;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator('[data-draggable-id="row-20"]')).toBeAttached();

    // The leave animations start after the next render, and run for 300ms
    await waitForFrames(page, 5);
    await poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    await waitForFrames(page, 2);

    const ids = await list.evaluate((element) =>
      Array.from(element.querySelectorAll('[data-draggable-id]')).map((row) =>
        row.getAttribute('data-draggable-id'),
      ),
    );
    expect(ids).toEqual(Array.from({ length: 15 }, (_, i) => `row-${17 + i}`));
  });
});
