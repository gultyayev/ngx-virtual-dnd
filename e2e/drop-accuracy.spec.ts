import { expect, test } from '@playwright/test';
import { DemoPage, ListName } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';

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

  test.describe('drop into a list scrolled to its bottom (#117)', () => {
    /** Scroll a list to its bottom and return that scrollTop. */
    const scrollToBottom = async (list: ListName): Promise<number> => {
      let bottom = 0;
      await expect(async () => {
        await demoPage.scrollList(list, 1_000_000);
        bottom = await demoPage
          .virtualScroll(list)
          .evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(bottom).toBeGreaterThan(0);
        expect(await demoPage.getScrollTop(list)).toBe(bottom);
      }).toPass({ timeout: 2000 });
      return bottom;
    };

    /** Top and bottom of an element of list2, relative to its visible scroll area. */
    const rectInList2 = (selector: string): Promise<{ top: number; bottom: number } | null> =>
      demoPage.list2VirtualScroll.evaluate((container, sel) => {
        const element = container.querySelector(sel);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const view = container.getBoundingClientRect();
        return { top: rect.top - view.top, bottom: rect.bottom - view.top };
      }, selector);

    /**
     * Drag list1's first item over list2 at `offsetY` px into its visible area, wait until the
     * placeholder resolved there, and return its position before releasing.
     */
    const dragFromList1IntoList2 = async (
      offsetY: (viewHeight: number) => number,
    ): Promise<{ movedId: string; placeholder: { top: number; bottom: number } }> => {
      const source = demoPage.list1Items.first();
      const movedId = (await source.getAttribute('data-draggable-id')) ?? '';
      await demoPage.startDrag(source);
      const view = await demoPage.list2VirtualScroll.boundingBox();
      if (!view) throw new Error('Could not get the list2 bounding box');
      const x = view.x + view.width / 2;
      const y = view.y + offsetY(view.height);
      await demoPage.page.mouse.move(x, y, { steps: 15 });
      await demoPage.settleDragPosition(x, y);
      await demoPage.waitForActiveDroppable('list2');
      let placeholder: { top: number; bottom: number } | null = null;
      await expect(async () => {
        placeholder = await rectInList2('.vdnd-drag-placeholder-visible');
        expect(placeholder).not.toBeNull();
      }).toPass({ timeout: 2000 });
      await demoPage.page.mouse.up();
      await expect(demoPage.dragPreview).not.toBeVisible();
      return { movedId, placeholder: placeholder! };
    };

    test('keeps its scroll position: the dropped row renders where the placeholder was', async ({
      page,
    }) => {
      const bottom = await scrollToBottom('list2');
      // Row 45 starts 45 * 50 - bottom px into the visible area: hold over its center
      const rowTop = 45 * 50 - bottom;
      const { movedId, placeholder } = await dragFromList1IntoList2(() => rowTop + 25);

      expect(placeholder.top).toBeCloseTo(rowTop, 0);
      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '45');
      await expect(demoPage.countBadge('list2')).toHaveText('51');
      await waitForFrames(page, 10);

      expect(await demoPage.getScrollTop('list2')).toBe(bottom);
      const dropped = await rectInList2(`[data-draggable-id="${movedId}"]`);
      expect(dropped?.top).toBeCloseTo(placeholder.top, 0);
    });

    test('scrolls a row dropped after the last item fully into view', async ({ page }) => {
      const bottom = await scrollToBottom('list2');
      // Below the last row: the placeholder goes after it, at the end of the list
      const { movedId } = await dragFromList1IntoList2((viewHeight) => viewHeight - 10);

      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '50');
      await expect(demoPage.countBadge('list2')).toHaveText('51');
      await waitForFrames(page, 10);

      // Scrolled by exactly the new row's height
      expect(await demoPage.getScrollTop('list2')).toBe(bottom + 50);
      const viewHeight = await demoPage.list2VirtualScroll.evaluate((el) => el.clientHeight);
      const dropped = await rectInList2(`[data-draggable-id="${movedId}"]`);
      expect(dropped).not.toBeNull();
      expect(dropped!.top).toBeGreaterThanOrEqual(-1);
      expect(dropped!.bottom).toBeLessThanOrEqual(viewHeight + 1);
    });
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
