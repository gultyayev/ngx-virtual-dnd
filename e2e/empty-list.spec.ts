import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';

test.describe('Empty List Edge Cases', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
  });

  test('should empty the source list when dragging its last item out', async () => {
    // 1 item per list
    await demoPage.goto({ itemCount: 2 });
    const movedId = await demoPage.getItemId('list1', 0);

    await demoPage.dragItemToList('list1', 0, 'list2', 0);

    await expect(demoPage.countBadge('list1')).toHaveText('0');
    await expect(demoPage.countBadge('list2')).toHaveText('2');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);

    // The empty list keeps its drop zone, with no rendered items
    await expect(demoPage.list1Container).toBeVisible();
    await expect(demoPage.list1Items).toHaveCount(0);
  });

  test('should drop into previously empty list', async () => {
    await demoPage.goto({ itemCount: 2 });
    const movedId = await demoPage.getItemId('list2', 0);

    // First, empty list1 by moving its item to list2
    await demoPage.dragItemToList('list1', 0, 'list2', 0);
    await expect(demoPage.countBadge('list1')).toHaveText('0');

    // Now drag an item back into the empty list1
    await demoPage.dragItemToList('list2', 1, 'list1', 0);

    await expect(demoPage.countBadge('list1')).toHaveText('1');
    await expect(demoPage.countBadge('list2')).toHaveText('1');
    expect(await demoPage.getItemId('list1', 0)).toBe(movedId);
  });

  test('should update item counts correctly during empty list operations', async () => {
    // 2 items per list
    await demoPage.goto({ itemCount: 4 });

    // Move both items from list1 to list2
    await demoPage.dragItemToList('list1', 0, 'list2', 0);
    await expect(demoPage.countBadge('list1')).toHaveText('1');
    await expect(demoPage.countBadge('list2')).toHaveText('3');

    await demoPage.dragItemToList('list1', 0, 'list2', 0);

    // List1 should be empty, list2 should have all items
    await expect(demoPage.countBadge('list1')).toHaveText('0');
    await expect(demoPage.countBadge('list2')).toHaveText('4');
  });

  test('should handle single-item list reordering gracefully', async ({ page }) => {
    await demoPage.goto({ itemCount: 2 });
    const itemId = await demoPage.getItemId('list1', 0);

    // "Reorder" within the single-item list (drag to the same position)
    const start = await demoPage.startDrag(demoPage.list1Items.first());
    await page.mouse.move(start.x, start.y + 20, { steps: 5 });
    await waitForFrames(page, 1);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();

    // A no-op drop at index 0: nothing moved
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '0');
    await expect(demoPage.countBadge('list1')).toHaveText('1');
    await expect(demoPage.countBadge('list2')).toHaveText('1');
    expect(await demoPage.getItemId('list1', 0)).toBe(itemId);
  });
});
