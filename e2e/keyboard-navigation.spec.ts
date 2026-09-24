import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

test.describe('Keyboard Navigation', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should have draggable items focusable with Tab key', async ({ page }) => {
    // Focus the first item
    await page.keyboard.press('Tab');

    // Keep pressing Tab until we reach a draggable item
    let attempts = 0;
    while (attempts < 20) {
      const focusedElement = page.locator(':focus');
      const isDraggable = await focusedElement.getAttribute('data-draggable-id');
      if (isDraggable) {
        break;
      }
      await page.keyboard.press('Tab');
      attempts++;
    }

    // Verify a draggable item is focused
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toHaveAttribute('data-draggable-id');
  });

  test('should have aria-grabbed attribute during drag', async ({ page }) => {
    const sourceItem = demoPage.list1Items.first();
    const itemId = await sourceItem.getAttribute('data-draggable-id');

    // Before drag
    await expect(sourceItem).not.toHaveAttribute('aria-grabbed', 'true');

    await demoPage.startDrag(sourceItem);

    // During drag - the original item has aria-grabbed (but is also hidden)
    const originalElement = page.locator(`[data-draggable-id="${itemId}"]`);
    await expect(originalElement).toHaveAttribute('aria-grabbed', 'true');

    await page.mouse.up();

    // After drag
    await expect(originalElement).not.toHaveAttribute('aria-grabbed', 'true');
  });

  test('should prevent the default Space action when starting a keyboard drag', async ({
    page,
  }) => {
    const scrollPositions = () =>
      page.evaluate(() => ({
        page: document.scrollingElement?.scrollTop ?? 0,
        list: document.querySelector('[data-droppable-id="list-1"] [data-item-height]')?.scrollTop,
      }));
    const before = await scrollPositions();

    await demoPage.list1Items.first().focus();
    // Unprevented, Space would scroll the list (or the page) by a screen.
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).toBeVisible();

    expect(await scrollPositions()).toEqual(before);

    await page.keyboard.press('Escape');
    await expect(demoPage.dragPreview).not.toBeVisible();
  });

  test('should set tabindex -1 when disabled and restore 0 when re-enabled', async ({ page }) => {
    const firstItem = demoPage.list1Items.first();
    await expect(firstItem).toHaveAttribute('tabindex', '0');

    // Toggled at runtime to cover the input change in both directions
    const checkbox = page.getByTestId('drag-enabled-checkbox');
    await checkbox.uncheck();
    await expect(firstItem).toHaveAttribute('tabindex', '-1');

    await checkbox.check();
    await expect(firstItem).toHaveAttribute('tabindex', '0');
  });
});
