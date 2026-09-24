import { expect, type Locator, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

type TouchEventType = 'touchstart' | 'touchmove' | 'touchend';

async function dispatchTouch(
  locator: Locator,
  type: TouchEventType,
  clientX: number,
  clientY: number,
): Promise<boolean> {
  return locator.evaluate(
    (el, payload) => {
      const { type, clientX, clientY } = payload;

      const touch = {
        identifier: 1,
        target: el,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
        screenX: clientX,
        screenY: clientY,
      };

      const touches = type === 'touchend' ? [] : [touch];
      const changedTouches = [touch];

      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches, configurable: true });
      Object.defineProperty(event, 'targetTouches', { value: touches, configurable: true });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });

      el.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { type, clientX, clientY },
  );
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Could not get the item bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Touch Scroll with Drag Delay (Mobile)', () => {
  let demoPage: DemoPage;

  test.beforeEach(({ page }) => {
    demoPage = new DemoPage(page);
  });

  test('should not preventDefault before drag delay expires (allows native scroll gesture)', async ({
    page,
  }) => {
    // Fake timers (time still flows) let the test jump past the delay instead of sleeping
    await page.clock.install();
    await demoPage.goto({ dragDelay: 500 });

    const firstItem = demoPage.list1Items.first();
    const start = await centerOf(firstItem);

    // Critical regression guard: with a delay configured, touchstart must NOT be prevented.
    // Preventing touchstart blocks native scroll on mobile.
    expect(await dispatchTouch(firstItem, 'touchstart', start.x, start.y)).toBe(false);

    // Move past threshold before delay is satisfied -> cancels drag attempt and must NOT prevent default.
    expect(await dispatchTouch(firstItem, 'touchmove', start.x, start.y - 120)).toBe(false);
    await dispatchTouch(firstItem, 'touchend', start.x, start.y - 120);

    // The cancelled attempt must have cleared its delay timer: past the delay, nothing arms.
    await page.clock.runFor(600);
    await expect(firstItem).not.toHaveClass(/vdnd-drag-pending/);
    await expect(demoPage.dragPreview).not.toBeVisible();
  });

  test('should start drag after holding for delay duration then preventDefault on touchmove', async () => {
    await demoPage.goto({ dragDelay: 200 });

    const firstItem = demoPage.list1Items.first();
    const start = await centerOf(firstItem);

    expect(await dispatchTouch(firstItem, 'touchstart', start.x, start.y)).toBe(false);

    // Pending state should appear when the delay passes.
    await expect(firstItem).toHaveClass(/vdnd-drag-pending/);

    // Moving past the threshold after the delay should start drag and prevent native scrolling.
    expect(await dispatchTouch(firstItem, 'touchmove', start.x, start.y + 120)).toBe(true);

    await expect(firstItem).not.toHaveClass(/vdnd-drag-pending/);
    await expect(demoPage.dragPreview).toBeVisible();

    await dispatchTouch(firstItem, 'touchend', start.x, start.y + 120);
    await expect(demoPage.dragPreview).not.toBeVisible();
  });

  test('should apply pending class when delay passes and clear it on touchend without drag', async () => {
    await demoPage.goto({ dragDelay: 200 });

    const firstItem = demoPage.list1Items.first();
    const start = await centerOf(firstItem);

    expect(await dispatchTouch(firstItem, 'touchstart', start.x, start.y)).toBe(false);
    await expect(firstItem).toHaveClass(/vdnd-drag-pending/);

    await dispatchTouch(firstItem, 'touchend', start.x, start.y);

    await expect(firstItem).not.toHaveClass(/vdnd-drag-pending/);
    await expect(demoPage.dragPreview).not.toBeVisible();
  });
});
