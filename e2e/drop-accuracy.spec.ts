import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

test.describe('Drop Position Accuracy', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should drop at correct position (middle of list)', async () => {
    const movedId = await demoPage.getItemId('list1', 2);
    const list2Before = await demoPage.getItemIds('list2');

    // Drag to position 2 in list2 (after first two items)
    await demoPage.dragItemToList('list1', 2, 'list2', 2);

    expect((await demoPage.getItemIds('list2')).slice(0, 4)).toEqual([
      list2Before[0],
      list2Before[1],
      movedId,
      list2Before[2],
    ]);
  });

  test('should drop at end of list when dragging past last item', async () => {
    const movedId = await demoPage.getItemId('list1', 0);

    // First scroll list2 to the end so we can drop at the actual end
    // Wrap write+read in toPass so scroll re-applies if content isn't ready
    await expect(async () => {
      await demoPage.scrollList('list2', 49 * 50);
      expect(await demoPage.getScrollTop('list2')).toBeGreaterThan(0);
    }).toPass({ timeout: 2000 });

    // Now drag to the end of the visible area (which is now the actual end)
    await demoPage.dragItemToList('list1', 0, 'list2', 999);

    await expect(demoPage.countBadge('list2')).toHaveText('51');
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '50');

    // Scroll to the very end: the moved item is the last one
    await expect(async () => {
      await demoPage.scrollList('list2', 50 * 50);
      expect(await demoPage.getScrollTop('list2')).toBeGreaterThan(0);
      expect(await demoPage.list2Items.last().getAttribute('data-draggable-id')).toBe(movedId);
    }).toPass({ timeout: 2000 });
  });

  test('should cancel a pointer drag with Escape without dropping', async ({ page }) => {
    const sourceItem = demoPage.list1Items.first();
    const sourceId = await sourceItem.getAttribute('data-draggable-id');
    const targetBox = await demoPage.list2Container.boundingBox();
    if (!targetBox) throw new Error('Could not get the target list bounding box');

    await demoPage.startDrag(sourceItem);
    await page.mouse.move(targetBox.x + 100, targetBox.y + 100, { steps: 5 });

    // Escape cancels (document-level keydown listener)
    await page.keyboard.press('Escape');
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');

    // Releasing the mouse afterwards must not drop either
    await page.mouse.up();

    await expect(sourceItem).not.toHaveCSS('display', 'none');
    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(demoPage.countBadge('list2')).toHaveText('50');
    expect(await demoPage.getItemId('list1', 0)).toBe(sourceId);
  });

  test('should maintain item order after multiple drags', async () => {
    const [id0, id1, id2] = await demoPage.getItemIds('list1');

    // Move first item to list2
    await demoPage.dragItemToList('list1', 0, 'list2', 0);
    expect(await demoPage.getItemId('list2', 0)).toBe(id0);

    // Move it back to list1 at position 2
    await demoPage.dragItemToList('list2', 0, 'list1', 2);

    // Verify the order: item1, item2, item0
    expect((await demoPage.getItemIds('list1')).slice(0, 3)).toEqual([id1, id2, id0]);
  });
});
