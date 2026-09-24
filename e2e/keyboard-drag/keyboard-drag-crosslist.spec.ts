import { expect, test } from '@playwright/test';
import { DemoPage } from '../fixtures/demo.page';

test.describe('Keyboard Drag - Cross-List Movement', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should move item to adjacent list with ArrowRight', async ({ page }) => {
    const movedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowRight'); // Move to list2
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible({
      timeout: 2000,
    });
    await page.keyboard.press('Space'); // Drop
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
  });

  test('should move item back with ArrowLeft', async ({ page }) => {
    const movedId = await demoPage.getItemId('list2', 0);

    await demoPage.startKeyboardDrag('list2', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowLeft'); // Move to list1
    await expect(demoPage.list1Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible({
      timeout: 2000,
    });
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.countBadge('list1')).toHaveText('51');
    await expect(demoPage.countBadge('list2')).toHaveText('49');
    expect(await demoPage.getItemId('list1', 0)).toBe(movedId);
  });

  test('should maintain approximate vertical position when changing lists', async ({ page }) => {
    const movedId = await demoPage.getItemId('list1', 2);
    const list2Before = (await demoPage.getItemIds('list2')).slice(0, 3);

    // Start from 3rd item in list1, move to list2 and drop.
    await demoPage.startKeyboardDrag('list1', 2);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible({
      timeout: 2000,
    });
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    // The moved item lands at the same visual slot (index 2) in list2.
    expect((await demoPage.getItemIds('list2')).slice(0, 4)).toEqual([
      list2Before[0],
      list2Before[1],
      movedId,
      list2Before[2],
    ]);
  });

  for (const { list, key, side } of [
    { list: 'list1', key: 'ArrowLeft', side: 'leftmost' },
    { list: 'list2', key: 'ArrowRight', side: 'rightmost' },
  ] as const) {
    test(`should stay in list when ${key} at ${side} list`, async ({ page }) => {
      const draggedId = await demoPage.getItemId(list, 0);

      await demoPage.startKeyboardDrag(list, 0);
      await expect(demoPage.dragPreview).toBeVisible();
      await page.keyboard.press(key);
      await page.keyboard.press(key);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
      await expect(demoPage.dragPreview).not.toBeVisible();

      // Dropped one slot down in the same list: the sideways presses were ignored
      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '1');
      await expect(demoPage.countBadge('list1')).toHaveText('50');
      await expect(demoPage.countBadge('list2')).toHaveText('50');
      expect(await demoPage.getItemId(list, 1)).toBe(draggedId);
    });
  }

  test('should allow vertical and horizontal movement combination', async ({ page }) => {
    const movedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    // Move down 2 positions, then right to list2
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible({
      timeout: 2000,
    });
    await page.keyboard.press('Space');
    await expect(demoPage.dragPreview).not.toBeVisible();

    // The item keeps its index (2) in list2
    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 2)).toBe(movedId);
  });

  test('should cancel cross-list move and return to original list', async ({ page }) => {
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await page.keyboard.press('ArrowRight'); // Move to list2
    await expect(demoPage.list2Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible();
    await page.keyboard.press('Escape'); // Cancel
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');
    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(demoPage.countBadge('list2')).toHaveText('50');
    expect(await demoPage.getItemId('list1', 0)).toBe(draggedId);
  });
});
