import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';
import { afterInputHandled } from '../fixtures/drag-sync';

test.describe('Keyboard Drag - Arrow Navigation', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    // Use simplified API for better built-in placeholder support
    await demoPage.goto({ api: 'simplified' });
  });

  test('should move placeholder down with ArrowDown', async ({ page }) => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Get initial placeholder position
    const placeholder = demoPage.placeholder;
    await expect(placeholder).toBeVisible();
    const initialY = (await placeholder.boundingBox())!.y;

    await page.keyboard.press('ArrowDown');

    // Wait for placeholder to move (should be at a new Y position)
    await expect(async () => {
      const newY = (await placeholder.boundingBox())!.y;
      expect(newY).toBeGreaterThan(initialY);
    }).toPass({ timeout: 2000 });
  });

  test('should move placeholder up with ArrowUp', async ({ page }) => {
    await demoPage.startKeyboardDrag('list1', 1);
    await expect(demoPage.dragPreview).toBeVisible();

    const placeholder = demoPage.placeholder;
    await expect(placeholder).toBeVisible();
    const initialY = (await placeholder.boundingBox())!.y;

    await page.keyboard.press('ArrowUp');

    // Wait for placeholder position to update (uses afterNextRender internally)
    await expect(async () => {
      const newY = (await placeholder.boundingBox())!.y;
      expect(newY).toBeLessThan(initialY);
    }).toPass({ timeout: 2000 });
  });

  test('should not move past first item with ArrowUp', async ({ page }) => {
    const firstId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveUp(3);
    await page.keyboard.press('Space');

    // Dropped (not cancelled) at index 0
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '0');
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
    expect(await demoPage.getItemId('list1', 0)).toBe(firstId);
  });

  test('should handle rapid arrow key presses', async ({ page }) => {
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Five presses back to back: none may be lost
    await demoPage.keyboardMoveDown(5);
    await page.keyboard.press('Space');

    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '5');
    expect(await demoPage.getItemId('list1', 5)).toBe(draggedId);
  });

  test('should reorder item when moved down and dropped', async ({ page }) => {
    const firstId = await demoPage.getItemId('list1', 0);
    const secondId = await demoPage.getItemId('list1', 1);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');

    await expect(demoPage.dragPreview).not.toBeVisible();
    expect((await demoPage.getItemIds('list1')).slice(0, 2)).toEqual([secondId, firstId]);
  });

  test('should reorder item when moved up and dropped', async ({ page }) => {
    const firstId = await demoPage.getItemId('list1', 0);
    const secondId = await demoPage.getItemId('list1', 1);

    await demoPage.startKeyboardDrag('list1', 1);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');

    await expect(demoPage.dragPreview).not.toBeVisible();
    expect((await demoPage.getItemIds('list1')).slice(0, 2)).toEqual([secondId, firstId]);
  });

  test('should ignore arrow keys when not in drag mode', async ({ page }) => {
    // Focus an item but don't start a drag
    await demoPage.list1Items.first().focus();

    await page.keyboard.press('ArrowDown');
    await afterInputHandled(page, 'keyup', () => page.keyboard.press('ArrowUp'));

    await expect(demoPage.placeholder).not.toBeVisible();
    await expect(demoPage.dragPreview).not.toBeVisible();
  });
});

test.describe('Keyboard Drag - Arrow Navigation (short list)', () => {
  // Small lists (5 + 5 items) keep the key presses few; the clamp is the same logic.
  test('should not move past last item with ArrowDown', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ api: 'simplified', itemCount: 10 });
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    // More presses than there are items in the list
    await demoPage.keyboardMoveDown(8);
    await page.keyboard.press('Space');

    // Dropped at the last index (4 of 5), not beyond it
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '4');
    await expect(demoPage.countBadge('list1')).toHaveText('5');
    expect(await demoPage.getItemId('list1', 4)).toBe(draggedId);
  });
});
