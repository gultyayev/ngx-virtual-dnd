import { expect, Locator, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { TaskDemoPage } from './fixtures/task-demo.page';

/** Long enough that assertions made right after a move reliably observe the animation. */
const SLOW_SHIFT_MS = 1500;

/** Running (not finished/cancelled) animations on the element. */
async function runningAnimationCount(locator: Locator): Promise<number> {
  return locator.evaluate(
    (el) => el.getAnimations().filter((animation) => animation.playState === 'running').length,
  );
}

/** Top of the element relative to its scroll content (independent of scroll position). */
async function contentTop(locator: Locator, scrollContainer: Locator): Promise<number> {
  const [box, containerTop] = await Promise.all([
    locator.evaluate((el) => el.getBoundingClientRect().top),
    scrollContainer.evaluate((el) => el.getBoundingClientRect().top - el.scrollTop),
  ]);
  return box - containerTop;
}

async function gotoDemo(page: Page, query = ''): Promise<DemoPage> {
  const demoPage = new DemoPage(page);
  await demoPage.goto(`/${query}`);
  return demoPage;
}

test.describe('Shift animation', () => {
  test('displaced items jump without animation by default', async ({ page }) => {
    const demoPage = await gotoDemo(page);
    const secondItem = demoPage.list1Items.nth(1);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    await expect(page.locator('app-demo')).toHaveAttribute('data-placeholder-move-count', '1');

    expect(await runningAnimationCount(secondItem)).toBe(0);

    await demoPage.keyboardCancel();
  });

  test('the settings toggle enables sliding displaced items', async ({ page }) => {
    const demoPage = await gotoDemo(page);
    await page.getByTestId('shift-animation-checkbox').check();
    const secondItem = demoPage.list1Items.nth(1);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();

    await expect.poll(() => runningAnimationCount(secondItem)).toBe(1);
    await demoPage.keyboardCancel();
  });

  test('a displaced item slides from its old slot to its new one (virtual scroll component)', async ({
    page,
  }) => {
    const demoPage = await gotoDemo(page, `?shiftAnimation=${SLOW_SHIFT_MS}`);
    const secondItem = demoPage.list1Items.nth(1);
    const scroll = demoPage.list1VirtualScroll;
    const itemHeight = 50;
    const initialTop = await contentTop(secondItem, scroll);

    // Keyboard drag: the placeholder takes item 0's slot, then moves below item 1,
    // which is displaced upwards by one item height.
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    const topAtDragStart = await contentTop(secondItem, scroll);
    expect(topAtDragStart).toBeCloseTo(initialTop, 0);

    await demoPage.keyboardMoveDown();

    // Mid-animation the item is still on its way up — not yet at its final slot.
    await expect.poll(() => runningAnimationCount(secondItem)).toBe(1);
    const midTop = await contentTop(secondItem, scroll);
    expect(midTop).toBeGreaterThan(initialTop - itemHeight + 1);
    expect(midTop).toBeLessThanOrEqual(initialTop + 0.5);

    // It settles exactly one item height up, with no leftover transform.
    await expect.poll(() => runningAnimationCount(secondItem), { timeout: 5000 }).toBe(0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop - itemHeight, 0);

    await demoPage.keyboardCancel();
  });

  test('reversing mid-animation continues from the current position', async ({ page }) => {
    const demoPage = await gotoDemo(page, `?shiftAnimation=${SLOW_SHIFT_MS}`);
    const secondItem = demoPage.list1Items.nth(1);
    const scroll = demoPage.list1VirtualScroll;
    const initialTop = await contentTop(secondItem, scroll);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    await expect.poll(() => runningAnimationCount(secondItem)).toBe(1);
    // Let it travel part of the way before reversing
    await expect.poll(() => contentTop(secondItem, scroll)).toBeLessThan(initialTop - 5);

    await demoPage.keyboardMoveUp();
    await expect(page.locator('app-demo')).toHaveAttribute('data-placeholder-move-count', '2');

    // No jump: right after reversing, the item is still between the two slots and heading
    // back through a single (retargeted, not stacked) animation.
    const topAfterReverse = await contentTop(secondItem, scroll);
    expect(topAfterReverse).toBeLessThan(initialTop);
    expect(topAfterReverse).toBeGreaterThan(initialTop - 50);
    expect(await runningAnimationCount(secondItem)).toBe(1);

    await expect.poll(() => runningAnimationCount(secondItem), { timeout: 5000 }).toBe(0);
    expect(await contentTop(secondItem, scroll)).toBeCloseTo(initialTop, 0);

    await demoPage.keyboardCancel();
  });

  test('drops land in the right order with animation enabled', async ({ page }) => {
    const demoPage = await gotoDemo(page, '?shiftAnimation=200');
    const firstText = await demoPage.getItemText('list1', 0);

    await demoPage.dragItemToList('list1', 0, 'list1', 3);

    await expect(page.locator('app-demo')).toHaveAttribute('data-last-drop-destination-index', '3');
    await expect(demoPage.list1Items.nth(3)).toHaveText(firstText);
    // Drag end cancels in-flight shifts so the committed order renders immediately.
    expect(await runningAnimationCount(demoPage.list1Items.nth(2))).toBe(0);
  });

  test('a displaced item slides in a vdndVirtualFor list', async ({ page }) => {
    const taskPage = new TaskDemoPage(page);
    await page.goto(`/dynamic-height?shiftAnimation=${SLOW_SHIFT_MS}`, {
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

    await expect.poll(() => runningAnimationCount(secondItem)).toBe(1);
    expect(await contentTop(secondItem, taskPage.scrollContainer)).toBeGreaterThan(
      initialTop - firstHeight + 1,
    );

    await expect.poll(() => runningAnimationCount(secondItem), { timeout: 5000 }).toBe(0);
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
    const demoPage = await gotoDemo(page);
    const host = page.locator('app-demo');

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
    const demoPage = await gotoDemo(page);
    const host = page.locator('app-demo');

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
