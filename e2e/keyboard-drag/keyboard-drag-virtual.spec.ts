import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';
import { poll } from '../fixtures/polling';

test.describe('Keyboard Drag - Virtual Scroll Integration', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should auto-scroll when navigating to item below visible range', async () => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Navigate far past the visible items (8 fit in the 400px list)
    await demoPage.keyboardMoveDown(20);

    // The list follows the placeholder so it stays in view
    await poll(() => demoPage.getScrollTop('list1')).toBeGreaterThan(0);
    await poll(() => demoPage.isPlaceholderInView('list1')).toBe(true);
  });

  test('should auto-scroll when navigating to item above visible range', async ({ page }) => {
    // Retry the scroll write with the read: it clips to 0 if content height isn't ready yet
    await expect(async () => {
      await demoPage.scrollList('list1', 500);
      expect(await demoPage.getScrollTop('list1')).toBe(500);
    }).toPass({ timeout: 2000 });

    // Focus the item at the top of the scrolled viewport without scrolling it (a plain focus()
    // would scroll the list itself and satisfy the assertion below on its own).
    const topItem = page.locator('[data-draggable-id="list1-10"]');
    await topItem.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).toBeVisible();
    expect(await demoPage.getScrollTop('list1')).toBe(500);

    await demoPage.keyboardMoveUp(10);

    await poll(() => demoPage.getScrollTop('list1')).toBeLessThan(500);
    await poll(() => demoPage.isPlaceholderInView('list1')).toBe(true);
  });

  test('should complete drag after navigating through virtual scroll boundary', async ({
    page,
  }) => {
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Navigate past the visible area, then drop
    await demoPage.keyboardMoveDown(15);
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '15');
    await poll(() => demoPage.getRenderedIndexOf('list1', draggedId!)).toBe(15);
    // Arrow keys scroll synchronously, so an immediate drop still lands in view with focus
    await expect(page.locator(':focus')).toHaveAttribute('data-draggable-id', draggedId!);
  });

  test('should scroll smoothly without jumps during continuous navigation', async ({ page }) => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    const scrollPositions: number[] = [];

    // Navigate and track scroll positions
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowDown');
      scrollPositions.push(await demoPage.getScrollTop('list1'));
    }

    // Verify scroll positions are monotonically non-decreasing
    // (may stay same if still in visible area, but never decrease)
    for (let i = 1; i < scrollPositions.length; i++) {
      expect(scrollPositions[i]).toBeGreaterThanOrEqual(scrollPositions[i - 1]);
    }

    await page.keyboard.press('Space');
  });

  test('should handle rapid navigation without missing items', async ({ page }) => {
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Back-to-back presses, no waiting for renders in between: every one must count
    await demoPage.keyboardMoveDown(10);
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '10');
    await poll(() => demoPage.getRenderedIndexOf('list1', draggedId!)).toBe(10);
  });
});
