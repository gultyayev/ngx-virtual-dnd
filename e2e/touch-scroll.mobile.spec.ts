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

interface TouchPoint {
  identifier: number;
  clientX: number;
  clientY: number;
}

/** Dispatch a touch event about `changed` while `touches` are down (several fingers). */
async function dispatchMultiTouch(
  locator: Locator,
  type: TouchEventType,
  touches: TouchPoint[],
  changed: TouchPoint[],
): Promise<void> {
  await locator.evaluate(
    (el, payload) => {
      const toTouch = (point: TouchPoint) => ({ ...point, target: el });
      const event = new Event(payload.type, { bubbles: true, cancelable: true });
      const touches = payload.touches.map(toTouch);
      Object.defineProperty(event, 'touches', { value: touches, configurable: true });
      Object.defineProperty(event, 'targetTouches', { value: touches, configurable: true });
      Object.defineProperty(event, 'changedTouches', {
        value: payload.changed.map(toTouch),
        configurable: true,
      });
      el.dispatchEvent(event);
    },
    { type, touches, changed },
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

  test('a second touch that lands before the drag starts does not replace it', async ({ page }) => {
    await demoPage.goto();

    const firstId = await demoPage.getItemId('list1', 0);
    const thirdId = await demoPage.getItemId('list1', 2);
    const first = page.locator(`[data-draggable-id="${firstId}"]`);
    const third = page.locator(`[data-draggable-id="${thirdId}"]`);
    const firstStart = await centerOf(first);
    const thirdStart = await centerOf(third);

    // Two fingers down on different items, then one move past the threshold: the first item's
    // press starts the drag, and the third item's press must give up.
    await dispatchTouch(first, 'touchstart', firstStart.x, firstStart.y);
    await dispatchTouch(third, 'touchstart', thirdStart.x, thirdStart.y);
    await dispatchTouch(first, 'touchmove', firstStart.x, firstStart.y + 20);

    await expect(demoPage.dragPreview).toBeVisible();
    await expect(first).toHaveAttribute('aria-grabbed', 'true');
    await expect(third).toHaveAttribute('aria-grabbed', 'false');
    await expect(third).toBeVisible();

    await dispatchTouch(first, 'touchend', firstStart.x, firstStart.y);
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(first).toHaveAttribute('aria-grabbed', 'false');
    await expect(third).toHaveAttribute('aria-grabbed', 'false');
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
  });

  test('a touch drag follows the finger that started it, not another finger', async () => {
    await demoPage.goto();

    const firstItem = demoPage.list1Items.first();
    const start = await centerOf(firstItem);
    const dragFinger = { identifier: 5, clientX: start.x, clientY: start.y };
    // A second finger resting elsewhere on the screen, listed first by the browser
    const otherFinger = { identifier: 2, clientX: start.x, clientY: start.y + 250 };

    await dispatchMultiTouch(firstItem, 'touchstart', [dragFinger], [dragFinger]);
    await dispatchMultiTouch(
      demoPage.page.locator('body'),
      'touchstart',
      [otherFinger, dragFinger],
      [otherFinger],
    );
    const moved = { ...dragFinger, clientY: start.y + 30 };
    await dispatchMultiTouch(firstItem, 'touchmove', [otherFinger, moved], [moved]);
    await expect(demoPage.dragPreview).toBeVisible();

    // The preview sits under the dragging finger, not the other one
    let previewTop = 0;
    await expect(async () => {
      const box = await demoPage.dragPreview.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeLessThanOrEqual(moved.clientY);
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(moved.clientY);
      previewTop = box!.y;
    }).toPass();

    // The other finger lifting does not drop the item: the drag goes on following its finger
    await dispatchMultiTouch(demoPage.page.locator('body'), 'touchend', [moved], [otherFinger]);
    const movedAgain = { ...moved, clientY: start.y + 60 };
    await dispatchMultiTouch(firstItem, 'touchmove', [movedAgain], [movedAgain]);
    await expect(async () => {
      const box = await demoPage.dragPreview.boundingBox();
      expect(box).not.toBeNull();
      // It moved down with the finger (30px), so the drag did not end at the other finger's lift
      expect(Math.abs(box!.y - previewTop - 30)).toBeLessThanOrEqual(2);
    }).toPass();

    await dispatchMultiTouch(firstItem, 'touchend', [], [movedAgain]);
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
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
