import { expect, Locator, Page, test } from '@playwright/test';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

/**
 * A scroll container that loses its layout box (`display: none` on an ancestor, as an inactive
 * tab does, or removed from the page and put back, as route reuse does) reads `scrollTop` 0
 * until it is shown again, and the browser then restores or resets its offset without a `scroll`
 * event (Firefox fires one on restore, but not after a re-attach). The rendered rows must follow
 * the offset it has once it is shown.
 */
const CONTAINERS = [
  {
    name: 'vdnd-virtual-scroll',
    url: '/',
    scroller: '[data-droppable-id="list-1"] [data-item-height]',
  },
  {
    name: 'vdndScrollable',
    url: '/virtual-for-scrollable',
    scroller: '[data-droppable-id="scrollable"]',
  },
  {
    name: 'vdnd-virtual-viewport',
    url: '/virtual-viewport',
    scroller: '[data-droppable-id="viewport-a"]',
  },
];

for (const { name, url, scroller: selector } of CONTAINERS) {
  test.describe(`Hidden scroll container: ${name}`, () => {
    let scroller: Locator;

    test.beforeEach(async ({ page }) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      scroller = page.locator(selector);
      await expect(scroller.locator('[data-draggable-id]').first()).toBeVisible();
    });

    test('renders the restored rows when hidden in the frame it scrolled', async ({ page }) => {
      const target = await scrollTarget(scroller);
      // Hidden before the scroll event fires: the list handles it with the hidden scrollTop (0)
      await scroller.evaluate((element, top) => {
        element.scrollTop = top;
        element.parentElement!.style.display = 'none';
      }, target);

      await expectRowsAfterShowing(page, scroller, target);
    });

    test('renders the restored rows when hidden after the scroll event', async ({ page }) => {
      const target = await scrollTarget(scroller);
      // Hidden after the list handled the scroll event, before the frame it reads the offset in
      await scroller.evaluate(
        (element, top) =>
          new Promise<void>((resolve) => {
            element.addEventListener(
              'scroll',
              () => {
                element.parentElement!.style.display = 'none';
                resolve();
              },
              { once: true },
            );
            element.scrollTop = top;
          }),
        target,
      );

      await expectRowsAfterShowing(page, scroller, target);
    });

    test('renders the first rows when removed from the page and put back', async ({ page }) => {
      const target = await scrollTarget(scroller);
      await scroller.evaluate((element, top) => {
        element.scrollTop = top;
      }, target);
      await poll(() => coversVisibleArea(scroller)).toBe(true);

      await scroller.evaluate((element) => {
        const parent = element.parentElement!;
        const marker = document.createComment('detached');
        parent.replaceWith(marker);
        (window as unknown as { __vdndReattach: () => void }).__vdndReattach = () =>
          marker.replaceWith(parent);
      });
      await waitForFrames(page, 3);
      await page.evaluate(() =>
        (window as unknown as { __vdndReattach: () => void }).__vdndReattach(),
      );

      // A re-attached element starts scrolled to the top
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
      await poll(() => coversVisibleArea(scroller)).toBe(true);
    });
  });
}

/** A scroll offset well inside the list: far past the rows rendered at the top. */
async function scrollTarget(scroller: Locator): Promise<number> {
  const target = await scroller.evaluate((element) =>
    Math.min(1000, element.scrollHeight - element.clientHeight),
  );
  expect(target).toBeGreaterThan(600);
  return target;
}

/** Let the list handle the scroll while hidden, show it and check the rows it renders. */
async function expectRowsAfterShowing(page: Page, scroller: Locator, target: number) {
  await waitForFrames(page, 3);
  await scroller.evaluate((element) => {
    element.parentElement!.style.display = '';
  });

  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(target);
  await poll(() => coversVisibleArea(scroller)).toBe(true);
}

/** Whether the rendered rows cover the container's whole visible area (no blank band). */
function coversVisibleArea(scroller: Locator): Promise<boolean> {
  return scroller.evaluate((container) => {
    const view = container.getBoundingClientRect();
    const rects = Array.from(container.querySelectorAll('[data-draggable-id]'))
      .map((item) => item.getBoundingClientRect())
      .filter((rect) => rect.height > 0);
    if (rects.length === 0) return false;
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const contentBottom = view.top - container.scrollTop + container.scrollHeight;
    return top <= view.top + 1 && bottom >= Math.min(view.bottom, contentBottom) - 1;
  });
}
