import { expect, Locator, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { poll } from './fixtures/polling';
import { TaskDemoPage } from './fixtures/task-demo.page';

/**
 * Long enough never to finish on its own during a test: the tests pause the animation and
 * seek it (WAAPI) to the moments they check, instead of waiting for them in real time.
 */
const SHIFT_MS = 60_000;

/** Running or paused (not finished/cancelled) animations on the element. */
async function activeAnimationCount(locator: Locator): Promise<number> {
  return locator.evaluate(
    (el) =>
      el
        .getAnimations()
        .filter(({ playState }) => playState === 'running' || playState === 'paused').length,
  );
}

/** Pause the element's shift animation at `progress` (0–1) of its duration. */
async function seekShiftAnimation(locator: Locator, progress: number): Promise<void> {
  await locator.evaluate((el, fraction) => {
    const [animation] = el.getAnimations();
    const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
    animation.pause();
    animation.currentTime = duration * fraction;
  }, progress);
}

/** Jump the element's shift animations to their end, as if they had played out. */
async function finishShiftAnimations(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.getAnimations().forEach((animation) => animation.finish()));
}

/** Top of the element relative to its scroll content (independent of scroll position). */
async function contentTop(locator: Locator, scrollContainer: Locator): Promise<number> {
  const containerHandle = await scrollContainer.elementHandle();
  return locator.evaluate(
    (el, container) =>
      el.getBoundingClientRect().top -
      (container!.getBoundingClientRect().top - container!.scrollTop),
    containerHandle,
  );
}

/** Count `Element.animate()` calls from now on (the shift animator's only way to animate). */
async function countAnimateCalls(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const target = window as unknown as { vdndAnimateCalls: number };
    target.vdndAnimateCalls = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      target.vdndAnimateCalls++;
      return animate.apply(this, args);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { vdndAnimateCalls: number }).vdndAnimateCalls);
}

test.describe('Shift animation', () => {
  test('displaced items jump without animation by default', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto();
    const animateCalls = await countAnimateCalls(page);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    // The displacement rendered (and would have started its animation in the same pass)
    await expect(demoPage.host).toHaveAttribute('data-placeholder-move-count', '1');

    expect(await animateCalls()).toBe(0);

    await demoPage.keyboardCancel();
  });

  test('the settings toggle enables sliding displaced items', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto();
    await page.getByTestId('shift-animation-checkbox').check();
    const animateCalls = await countAnimateCalls(page);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();

    await poll(animateCalls).toBeGreaterThan(0);
    await demoPage.keyboardCancel();
  });

  test('a displaced item slides from its old slot to its new one (virtual scroll component)', async ({
    page,
  }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ shiftAnimation: SHIFT_MS });
    const secondItem = demoPage.list1Items.nth(1);
    const scroll = demoPage.list1VirtualScroll;
    const itemHeight = 50;
    const initialTop = await contentTop(secondItem, scroll);

    // Keyboard drag: the placeholder takes item 0's slot, then moves below item 1,
    // which is displaced upwards by one item height.
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop, 0);

    await demoPage.keyboardMoveDown();
    await poll(() => activeAnimationCount(secondItem)).toBe(1);

    // It starts from the old slot...
    await seekShiftAnimation(secondItem, 0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop, 0);
    // ...is between the slots mid-way...
    await seekShiftAnimation(secondItem, 0.5);
    const midTop = await contentTop(secondItem, scroll);
    expect(midTop).toBeLessThan(initialTop - 1);
    expect(midTop).toBeGreaterThan(initialTop - itemHeight + 1);
    // ...and settles exactly one item height up, with no leftover transform.
    await finishShiftAnimations(secondItem);
    expect(await activeAnimationCount(secondItem)).toBe(0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop - itemHeight, 0);

    await demoPage.keyboardCancel();
  });

  test('reversing mid-animation continues from the current position', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ shiftAnimation: SHIFT_MS });
    const secondItem = demoPage.list1Items.nth(1);
    const scroll = demoPage.list1VirtualScroll;
    const initialTop = await contentTop(secondItem, scroll);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    await poll(() => activeAnimationCount(secondItem)).toBe(1);
    // Hold it part of the way up before reversing
    await seekShiftAnimation(secondItem, 0.5);
    const topBeforeReverse = await contentTop(secondItem, scroll);
    expect(topBeforeReverse).toBeLessThan(initialTop - 1);

    await demoPage.keyboardMoveUp();
    await expect(demoPage.host).toHaveAttribute('data-placeholder-move-count', '2');

    // No jump: the new (retargeted, not stacked) animation starts where the item was
    expect(await activeAnimationCount(secondItem)).toBe(1);
    await seekShiftAnimation(secondItem, 0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(topBeforeReverse, 0);

    // ...and ends back in the original slot
    await finishShiftAnimations(secondItem);
    expect(await activeAnimationCount(secondItem)).toBe(0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop, 0);

    await demoPage.keyboardCancel();
  });

  test('drops land in the right order with animation enabled', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ shiftAnimation: SHIFT_MS });
    const firstId = await demoPage.getItemId('list1', 0);

    await demoPage.dragItemToList('list1', 0, 'list1', 3);

    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '3');
    expect(await demoPage.getItemId('list1', 3)).toBe(firstId);
    // Drag end cancels in-flight shifts so the committed order renders immediately.
    expect(await activeAnimationCount(demoPage.list1Items.nth(2))).toBe(0);
  });

  test('a displaced item slides in a vdndVirtualFor list', async ({ page }) => {
    const taskPage = new TaskDemoPage(page);
    await page.goto(`/dynamic-height?shiftAnimation=${SHIFT_MS}`, {
      waitUntil: 'domcontentloaded',
    });
    await taskPage.waitUntilReady();
    const firstItem = taskPage.items.nth(0);
    const secondItem = taskPage.items.nth(1);
    const firstHeight = (await firstItem.boundingBox())!.height;
    const initialTop = await contentTop(secondItem, taskPage.scrollContainer);

    await firstItem.focus();
    await page.keyboard.press('Space');
    await expect(taskPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowDown');

    await poll(() => activeAnimationCount(secondItem)).toBe(1);
    await seekShiftAnimation(secondItem, 0);
    expect(await contentTop(secondItem, taskPage.scrollContainer)).toBeCloseTo(initialTop, 0);

    await finishShiftAnimations(secondItem);
    expect(await contentTop(secondItem, taskPage.scrollContainer)).toBeCloseTo(
      initialTop - firstHeight,
      0,
    );

    await page.keyboard.press('Escape');
    await expect(taskPage.dragPreview).toBeHidden();
  });
});

test.describe('placeholderMove event', () => {
  test('fires once per displacement with drop-convention indexes', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto();
    const host = demoPage.host;

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    // Picking the item up displaces nothing
    await expect(host).toHaveAttribute('data-placeholder-move-count', '0');

    await demoPage.keyboardMoveDown();
    await expect(host).toHaveAttribute('data-last-placeholder-move', 'list-1:0->1');
    await demoPage.keyboardMoveDown();
    await expect(host).toHaveAttribute('data-last-placeholder-move', 'list-1:1->2');
    await expect(host).toHaveAttribute('data-placeholder-move-count', '2');

    await demoPage.keyboardMoveToList('right');
    await expect(host).toHaveAttribute('data-last-placeholder-move', /^list-2:null->\d+$/);
    await expect(host).toHaveAttribute('data-placeholder-move-count', '3');

    await demoPage.keyboardCancel();
    await expect(demoPage.dragPreview).toBeHidden();
    await expect(host).toHaveAttribute('data-placeholder-move-count', '3');
  });

  test('fires during pointer drags', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto();
    const host = demoPage.host;

    await demoPage.dragItemToList('list1', 0, 'list1', 2);

    // The last reported position is where the item was dropped
    const destination = await host.getAttribute('data-last-drop-destination-index');
    expect(Number(destination)).toBeGreaterThan(0);
    await expect(host).toHaveAttribute(
      'data-last-placeholder-move',
      new RegExp(`^list-1:\\d+->${destination}$`),
    );
  });
});
