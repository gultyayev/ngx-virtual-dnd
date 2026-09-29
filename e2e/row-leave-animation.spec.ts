import { expect, Locator, Page, test } from '@playwright/test';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

/**
 * Rows with a leave animation (`animate.leave`): Angular removes a leaving row's element when that
 * animation ends, so a view whose row left the range must not be recycled for a row that comes in.
 * Fixture: /row-leave-animation. "Rows" (`row-0`…`row-99`) is a `vdnd-sortable-list` with
 * `recycleRows`, "Viewport rows" (`vrow-0`…`vrow-99`) renders with `*vdndVirtualFor`. Both are
 * 400px tall, with 50px rows.
 */
test.describe('Rows with a leave animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/row-leave-animation', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-draggable-id="row-0"]')).toBeVisible();
    await expect(page.locator('[data-draggable-id="vrow-0"]')).toBeVisible();
  });

  test.describe('in vdnd-virtual-scroll', () => {
    test('keeps the rows that scroll in once the rows that scrolled out animated out', async ({
      page,
    }) => {
      const list = page.locator('vdnd-virtual-scroll');

      // Row 20 at the top: rows 0-11 leave the range and fade out, rows 17-31 render
      await scrollTo(list, 1000);
      await expect(page.locator('[data-draggable-id="row-20"]')).toBeAttached();
      await settleAnimations(page);

      expect(await renderedIds(list)).toEqual(range('row', 17, 31));
    });
  });

  test.describe('in *vdndVirtualFor', () => {
    test('keeps the rows that scroll in in recycled views', async ({ page }) => {
      const list = page.locator('vdnd-virtual-viewport');

      // Row 20 at the top: the views of the rows that leave the range render the rows that come in
      await scrollTo(list, 1000);
      await expect(page.locator('[data-draggable-id="vrow-20"]')).toBeAttached();
      await settleAnimations(page);

      const ids = await renderedIds(list);
      const first = Number(ids[0]?.replace('vrow-', ''));
      expect(ids).toEqual(range('vrow', first, first + ids.length - 1));
      // Rows 20-27 fill the viewport
      expect(ids).toEqual(expect.arrayContaining(range('vrow', 20, 27)));
    });
  });
});

async function scrollTo(list: Locator, scrollTop: number): Promise<void> {
  await list.evaluate((element, top) => {
    element.scrollTop = top;
    element.dispatchEvent(new Event('scroll'));
  }, scrollTop);
}

/**
 * Wait for the leave, shift and drop animations to end. Leave animations start after the next
 * render, and Angular removes a row once its leave animation has ended.
 */
async function settleAnimations(page: Page): Promise<void> {
  await waitForFrames(page, 5);
  await poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await waitForFrames(page, 2);
}

async function renderedIds(list: Locator): Promise<(string | null)[]> {
  return list.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-draggable-id]')).map((row) =>
      row.getAttribute('data-draggable-id'),
    ),
  );
}

/** `${prefix}-${from}` to `${prefix}-${to}`, both included. */
function range(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`);
}
