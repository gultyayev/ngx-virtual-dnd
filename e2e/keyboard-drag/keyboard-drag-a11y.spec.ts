import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';

test.describe('Keyboard Drag - Accessibility', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should have correct aria-grabbed during keyboard drag', async ({ page }) => {
    const sourceItem = demoPage.list1Items.first();

    // Before drag - should have aria-grabbed="false"
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'false');

    await sourceItem.focus();
    await page.keyboard.press('Space');

    // During drag - should have aria-grabbed="true"
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');

    await page.keyboard.press('Space');

    // After drag - should return to aria-grabbed="false"
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'false');
  });

  test('should have aria-dropeffect on droppable areas', async () => {
    // Droppable containers should have aria-dropeffect="move"
    await expect(demoPage.list1Container).toHaveAttribute('aria-dropeffect', 'move');
    await expect(demoPage.list2Container).toHaveAttribute('aria-dropeffect', 'move');
  });

  test('should restore aria-grabbed to false when drag is cancelled', async ({ page }) => {
    const sourceItem = demoPage.list1Items.first();

    await sourceItem.focus();
    await page.keyboard.press('Space');

    // During drag
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');

    // Cancel with Escape
    await page.keyboard.press('Escape');

    // After cancel - should be false
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'false');
  });

  test('should update aria-grabbed when crossing lists', async ({ page }) => {
    const sourceItem = demoPage.list1Items.first();
    const itemId = await sourceItem.getAttribute('data-draggable-id');

    await sourceItem.focus();
    await page.keyboard.press('Space');

    // During drag in original list
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');

    // Move to other list
    await page.keyboard.press('ArrowRight');
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible();

    // Still grabbed during cross-list movement
    await expect(sourceItem).toHaveAttribute('aria-grabbed', 'true');

    await page.keyboard.press('Space');

    // The item now lives in list2 and is no longer grabbed
    const movedItem = demoPage.list2Items.first();
    await expect(movedItem).toHaveAttribute('data-draggable-id', itemId!);
    await expect(movedItem).toHaveAttribute('aria-grabbed', 'false');
  });

  test('should keep draggable items focusable', async () => {
    const firstItem = demoPage.list1Items.first();

    // Draggable items should be in the tab order
    await expect(firstItem).toHaveAttribute('tabindex', '0');

    // Focus should work
    await firstItem.focus();
    await expect(firstItem).toBeFocused();
  });
});
