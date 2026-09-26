import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';
import { afterInputHandled } from '../fixtures/drag-sync';

test.describe('Keyboard Drag - Basic Operations', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
  });

  test('should start keyboard drag with Space key', async ({ page }) => {
    await demoPage.goto();
    // Find the item by its ID afterwards: display:none shifts DOM order during the drag
    const itemId = await demoPage.getItemId('list1', 0);
    await demoPage.startKeyboardDrag('list1', 0);

    const sourceItem = page.locator(`[data-draggable-id="${itemId}"]`);
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');
    await expect(demoPage.dragPreview).toBeVisible();
    await expect(demoPage.placeholder).toBeVisible();
  });

  test('Space on another item during a mouse drag does not start a keyboard drag', async ({
    page,
  }) => {
    await demoPage.goto();
    const firstId = await demoPage.getItemId('list1', 0);
    const thirdId = await demoPage.getItemId('list1', 2);
    const first = page.locator(`[data-draggable-id="${firstId}"]`);
    const third = page.locator(`[data-draggable-id="${thirdId}"]`);

    const start = await demoPage.startDrag(first);
    await third.focus();
    await afterInputHandled(page, 'keyup', () => page.keyboard.press('Space'));

    await expect(third).toHaveAttribute('aria-grabbed', 'false');
    await expect(first).toHaveAttribute('aria-grabbed', 'true');

    // The mouse drag still owns the drag: releasing drops the first item where it started
    await page.mouse.move(start.x, start.y);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '0');
    await expect(third).toHaveAttribute('aria-grabbed', 'false');
    expect(await demoPage.getItemId('list1', 0)).toBe(firstId);
  });

  for (const dropKey of ['Space', 'Enter'] as const) {
    test(`should drop item with ${dropKey} key during keyboard drag`, async ({ page }) => {
      await demoPage.goto();
      const firstId = await demoPage.getItemId('list1', 0);
      const secondId = await demoPage.getItemId('list1', 1);

      await demoPage.startKeyboardDrag('list1', 0);
      await expect(demoPage.dragPreview).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press(dropKey);
      await expect(demoPage.dragPreview).not.toBeVisible();

      // A drop (not a cancel) one slot down
      await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '1');
      expect(await demoPage.getItemId('list1', 0)).toBe(secondId);
      expect(await demoPage.getItemId('list1', 1)).toBe(firstId);
      await expect(demoPage.countBadge('list1')).toHaveText('50');
    });
  }

  test('should cancel keyboard drag with Escape key', async ({ page }) => {
    await demoPage.goto();
    const originalId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');

    // Wait for drag to be fully cancelled (preview hidden, item restored)
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');

    // Item should be back at original position
    expect(await demoPage.getItemId('list1', 0)).toBe(originalId);
  });

  test('should not start drag on disabled item', async ({ page }) => {
    await demoPage.goto({ dragEnabled: false });
    const firstItem = demoPage.list1Items.first();
    await expect(firstItem).toHaveClass(/vdnd-draggable-disabled/);

    await firstItem.focus();
    await afterInputHandled(page, 'keyup', () => page.keyboard.press('Space'));

    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(firstItem).not.toHaveAttribute('aria-grabbed', 'true');
  });

  // Note: Focus cannot be maintained on the dragged element during keyboard drag
  // because the element is hidden with display:none. Keyboard events are captured
  // via a document-level listener instead. See CLAUDE.md "Keyboard Drag Accessibility"

  test('should toggle drag state with repeated Space presses', async ({ page }) => {
    await demoPage.goto();
    const itemId = await demoPage.getItemId('list1', 0);

    // First Space starts drag
    await demoPage.startKeyboardDrag('list1', 0);
    const sourceItem = page.locator(`[data-draggable-id="${itemId}"]`);
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');
    await expect(demoPage.dragPreview).toBeVisible();

    // Second Space drops
    await page.keyboard.press('Space');
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'false');
    await expect(demoPage.dragPreview).not.toBeVisible();
  });
});

test.describe('Keyboard Drag - Event Consistency', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should emit matching dragEnd and drop destination indexes for same-list no-op drops', async ({
    page,
  }) => {
    await demoPage.startKeyboardDrag('list1', 3);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('Space');

    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-destination-index', '3');
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '3');
  });

  test('should emit matching dragEnd and drop destination indexes for same-list move-down drops', async ({
    page,
  }) => {
    const sourceId = await demoPage.getItemId('list1', 1);
    const targetId = await demoPage.getItemId('list1', 2);

    await demoPage.startKeyboardDrag('list1', 1);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');

    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-destination-index', '2');
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '2');
    await expect(demoPage.dragPreview).not.toBeVisible();
    expect((await demoPage.getItemIds('list1')).slice(1, 3)).toEqual([targetId, sourceId]);
  });
});
