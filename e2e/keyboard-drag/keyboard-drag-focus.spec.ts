import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';

test.describe('Keyboard Drag - Focus Management', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should handle keyboard events during drag even when element is hidden', async ({
    page,
  }) => {
    // Note: The dragged element has display:none during drag, so it cannot maintain focus.
    // Keyboard events are handled via document-level listeners instead.
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Arrow keys work (handled by the document listener, not element focus)
    await page.keyboard.press('ArrowDown');
    await expect(demoPage.host).toHaveAttribute('data-placeholder-move-count', '1');
    await expect(demoPage.dragPreview).toBeVisible();

    // Can complete the drag
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '1');
  });

  test('should restore focus to the dropped item after drop', async ({ page }) => {
    const itemId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space'); // Drop

    // Focus returns to the moved item at its new position
    await expect(page.locator(':focus')).toHaveAttribute('data-draggable-id', itemId!);
    expect(await demoPage.getItemId('list1', 1)).toBe(itemId);
  });

  test('should restore focus to original position after cancel', async ({ page }) => {
    const itemId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape'); // Cancel

    // Focus should return to original item
    await expect(page.locator(':focus')).toHaveAttribute('data-draggable-id', itemId!);
  });

  test('should cancel drag if Tab is pressed', async ({ page }) => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    await page.keyboard.press('Tab');

    // Drag should be cancelled
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');
  });

  test('should maintain drag state when focus temporarily lost and regained', async ({ page }) => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Blur focus by clicking elsewhere (but not on a drop target)
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Focus should be restorable and drag should continue to work
    await demoPage.list1Items.first().focus();

    // Pressing Escape should still cancel the drag
    await page.keyboard.press('Escape');
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');
  });

  test('should handle focus on cross-list move', async ({ page }) => {
    const itemId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    await page.keyboard.press('ArrowRight'); // Move to list2
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible();

    // Drag should still be active (keyboard events work via document listener)
    await expect(demoPage.dragPreview).toBeVisible();

    await page.keyboard.press('Space'); // Drop

    // Focus follows the item into list2 (restored after Angular renders the move)
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('data-draggable-id', itemId!);
    await expect(demoPage.list2Container.locator(':focus')).toHaveCount(1);
  });

  test('should not interfere with normal Tab navigation when not dragging', async ({ page }) => {
    const firstItem = demoPage.list1Items.first();
    await firstItem.focus();

    // Tab to next item (not in drag mode)
    await page.keyboard.press('Tab');

    // Focus moved on (Tab was not consumed by a drag)...
    await expect(firstItem).not.toBeFocused();
    // ...and no drag started
    await expect(demoPage.dragPreview).not.toBeVisible();
  });
});
