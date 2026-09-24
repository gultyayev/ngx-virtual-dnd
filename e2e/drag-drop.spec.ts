import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

for (const api of ['verbose', 'simplified'] as const) {
  test.describe(`Drag and Drop (${api} API)`, () => {
    let demoPage: DemoPage;

    test.beforeEach(async ({ page }) => {
      demoPage = new DemoPage(page);
      await demoPage.goto({ api });
    });

    test('should drag item from list1 to list2', async () => {
      const movedId = await demoPage.getItemId('list1', 0);

      await demoPage.dragItemToList('list1', 0, 'list2', 0);

      await expect(demoPage.countBadge('list1')).toHaveText('49');
      await expect(demoPage.countBadge('list2')).toHaveText('51');
      expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
    });

    test('should drag item from list2 to list1', async () => {
      const movedId = await demoPage.getItemId('list2', 0);

      await demoPage.dragItemToList('list2', 0, 'list1', 0);

      await expect(demoPage.countBadge('list1')).toHaveText('51');
      await expect(demoPage.countBadge('list2')).toHaveText('49');
      expect(await demoPage.getItemId('list1', 0)).toBe(movedId);
    });

    test('should reorder item within same list', async () => {
      const [firstId, secondId] = await demoPage.getItemIds('list1');

      // Release over the third item's slot
      await demoPage.dragItemToList('list1', 0, 'list1', 2);

      // The item lands where the drop event says, and the old second item moves up
      const destination = Number(
        await demoPage.host.getAttribute('data-last-drop-destination-index'),
      );
      expect(destination).toBeGreaterThan(0);
      const ids = await demoPage.getItemIds('list1');
      expect(ids[0]).toBe(secondId);
      expect(ids[destination]).toBe(firstId);
      await expect(demoPage.countBadge('list1')).toHaveText('50');
    });
  });
}

test.describe('Drag and Drop', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should show drag preview and hide the original element while dragging', async ({
    page,
  }) => {
    const sourceItem = demoPage.list1Items.first();
    const itemId = await sourceItem.getAttribute('data-draggable-id');

    const start = await demoPage.startDrag(sourceItem);
    await page.mouse.move(start.x, start.y + 100, { steps: 2 });

    // The original element is hidden via CSS (display: none) and the preview follows the pointer
    const originalElement = page.locator(`[data-draggable-id="${itemId}"]`);
    await expect(originalElement).toHaveCSS('display', 'none');
    await expect(demoPage.dragPreview).toBeVisible();

    await page.mouse.up();

    // After dropping, the element is visible again
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(originalElement).not.toHaveCSS('display', 'none');
  });

  test('should preserve the source index when a rapid drag activates over another list', async ({
    page,
  }) => {
    const sourceIndex = 4;
    const sourceItem = demoPage.list1Items.nth(sourceIndex);
    await sourceItem.scrollIntoViewIfNeeded();

    await expect(async () => {
      await demoPage.scrollList('list2', 500);
      expect(await demoPage.getScrollTop('list2')).toBe(500);
    }).toPass({ timeout: 2000 });

    const sourceBox = await sourceItem.boundingBox();
    const targetBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error('Could not get bounding boxes for rapid cross-list drag');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();

    // A single coalesced move crosses the threshold and lands in the destination list.
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 1 });
    await expect(demoPage.dragPreview).toBeVisible({ timeout: 2000 });
    await waitForFrames(page, 1);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    await expect(demoPage.host).toHaveAttribute('data-last-drop-source-index', String(sourceIndex));
  });

  test('emits a cross-list drop when released immediately over the target (no settle)', async ({
    page,
  }) => {
    // Guards the pointer-up flush: the release position is applied synchronously at mouseup,
    // so the destination droppable emits its drop even when no RAF frame processed the final
    // move. Without the flush the drop would resolve against the last processed frame (the
    // source list) and no drop event would fire for the target.
    const movedId = await demoPage.getItemId('list1', 0);

    const sourceItem = demoPage.list1Items.first();
    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
    const targetBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!targetBox) {
      throw new Error('Could not get the target list bounding box');
    }

    await demoPage.startDrag(sourceItem);

    // Move onto the enabled target near its top and release immediately — no RAF wait,
    // no settleDragPosition (settling would let a frame process the move and mask the flush).
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetBox.y + 25;
    await page.mouse.move(targetX, targetY, { steps: 15 });
    await page.mouse.move(targetX, targetY);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    // A drop fired: the item moved from list1 to the top of list2.
    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
  });
});

test.describe('Drag and Drop - Simplified API Mode', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto({ api: 'simplified' });
  });

  test('should drop at exact preview position during cross-list drag', async ({ page }) => {
    // Regression: in simplified mode the drop landed one slot earlier than the preview showed
    const movedId = await demoPage.getItemId('list1', 0);
    const list2Before = await demoPage.getItemIds('list2');

    const targetContainer = demoPage.list2VirtualScroll;
    await targetContainer.scrollIntoViewIfNeeded();
    const targetBox = await targetContainer.boundingBox();
    if (!targetBox) {
      throw new Error('Could not get the target list bounding box');
    }

    // Target index 2: between the second (index 1) and third (index 2) items
    const itemHeight = 50;
    const targetIndex = 2;
    const targetY = targetBox.y + targetIndex * itemHeight + itemHeight / 2;
    const targetX = targetBox.x + targetBox.width / 2;

    await demoPage.startDrag(demoPage.list1Items.first());
    await page.mouse.move(targetX, targetY, { steps: 10 });
    // The test asserts an exact drop slot, so the placeholder index must be computed from the
    // exact release coordinates — wait for the scheduler to process them, then confirm the
    // release point resolved to list2 (the source list shows a placeholder too, so placeholder
    // visibility alone cannot prove the target list is active).
    await demoPage.settleDragPosition(targetX, targetY);
    await demoPage.waitForActiveDroppable('list2');

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    // List 2 is now [item 0, item 1, DROPPED ITEM, item 2, ...]
    expect((await demoPage.getItemIds('list2')).slice(0, 4)).toEqual([
      list2Before[0],
      list2Before[1],
      movedId,
      list2Before[2],
    ]);
  });

  test('should drop at exact preview position when target list is scrolled', async ({ page }) => {
    // Regression: the drop landed one slot off when the target list was scrolled.
    // Verified by checking which item is under the release point after the drop.
    const itemHeight = 50;
    const scrollAmount = 20 * itemHeight; // Scroll down 20 items (1000px)
    const targetVisibleSlot = 3; // Target the 4th visible slot (0-indexed)
    const movedId = await demoPage.getItemId('list1', 0);

    // Retry the scroll write with the read: it clips to 0 if content height isn't ready yet
    await expect(async () => {
      await demoPage.scrollList('list2', scrollAmount);
      expect(await demoPage.getScrollTop('list2')).toBe(scrollAmount);
    }).toPass({ timeout: 2000 });

    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
    const targetBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!targetBox) {
      throw new Error('Could not get the target list bounding box');
    }

    // Target visual slot 3 (center of the slot)
    const targetY = targetBox.y + targetVisibleSlot * itemHeight + itemHeight / 2;
    const targetX = targetBox.x + targetBox.width / 2;

    await demoPage.startDrag(demoPage.list1Items.first());
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await demoPage.settleDragPosition(targetX, targetY);
    await demoPage.waitForActiveDroppable('list2');

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    // Re-apply scrollTop and verify the dropped item is at the release point.
    // This avoids relying on virtual overscan DOM positions (which can differ across browsers).
    await expect(async () => {
      await demoPage.scrollList('list2', scrollAmount);
      expect(await demoPage.getScrollTop('list2')).toBe(scrollAmount);
    }).toPass({ timeout: 2000 });

    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
    const verifyBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!verifyBox) throw new Error('Could not get list2 bounding box for verification');

    const verifyX = verifyBox.x + verifyBox.width / 2;
    const verifyY = verifyBox.y + targetVisibleSlot * itemHeight + itemHeight / 2;

    await poll(() =>
      page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-draggable-id]')
            ?.getAttribute('data-draggable-id') ?? null,
        { x: verifyX, y: verifyY },
      ),
    ).toBe(movedId);
  });

  test('should reorder item with autoscroll in simplified mode', async ({ page }) => {
    const [firstId, secondId] = await demoPage.getItemIds('list2');

    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
    const containerBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!containerBox) {
      throw new Error('Could not get container bounding box');
    }

    // Move from first item directly to bottom edge (single move exceeds drag threshold)
    await demoPage.list2Items.first().hover();
    await page.mouse.down();
    const nearBottomY = containerBox.y + containerBox.height - 25;
    const edgeX = containerBox.x + containerBox.width / 2;
    await page.mouse.move(edgeX, nearBottomY, { steps: 10 });
    await page.mouse.move(edgeX, nearBottomY); // Firefox: direct follow-up after stepped move
    await expect(demoPage.dragPreview).toBeVisible({ timeout: 2000 });
    await expect(demoPage.placeholder).toBeVisible({ timeout: 2000 });

    // Wait for autoscroll to move significantly
    await poll(() => demoPage.getScrollTop('list2'), { timeout: 10000 }).toBeGreaterThan(200);

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    // Dropped below the autoscrolled distance (> 200px = 4 items)
    const destination = Number(
      await demoPage.host.getAttribute('data-last-drop-destination-index'),
    );
    expect(destination).toBeGreaterThanOrEqual(4);

    // Scroll back to top: the old second item now leads the list...
    await expect(async () => {
      await demoPage.scrollList('list2', 0);
      expect(await demoPage.getScrollTop('list2')).toBe(0);
    }).toPass({ timeout: 2000 });
    await poll(() => demoPage.getItemId('list2', 0), { timeout: 5000 }).toBe(secondId);

    // ...and the moved item renders where the drop event put it
    await expect(async () => {
      await demoPage.scrollList('list2', destination * 50);
      expect(await demoPage.getRenderedIndexOf('list2', firstId!)).toBe(destination);
    }).toPass({ timeout: 2000 });
  });
});
