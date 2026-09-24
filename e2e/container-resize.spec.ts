import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

/**
 * The default (verbose API) lists size themselves from CSS: the virtual scroll measures its
 * height with a ResizeObserver, so these tests resize the element and check the rendering.
 */
test.describe('Container Resize', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  async function setListHeight(height: number): Promise<void> {
    await demoPage.list1VirtualScroll.evaluate((el, h) => {
      el.style.height = `${h}px`;
    }, height);
    await poll(async () => (await demoPage.list1VirtualScroll.boundingBox())?.height).toBe(height);
  }

  test('should render more items when the container grows', async () => {
    // 400px → 900px: the rows rendered for 400px (plus overscan) no longer fill the list
    await setListHeight(900);

    await poll(() => demoPage.coversVisibleArea('list1')).toBe(true);
  });

  test('should render fewer items when the container shrinks', async () => {
    const initialRendered = await demoPage.list1Items.count();

    await setListHeight(100);

    await poll(() => demoPage.list1Items.count()).toBeLessThan(initialRendered);
    expect(await demoPage.coversVisibleArea('list1')).toBe(true);

    // Scrolling far past the initial render still fills the small viewport
    await demoPage.scrollList('list1', 1000);
    expect(await demoPage.getScrollTop('list1')).toBe(1000);
    await poll(() => demoPage.coversVisibleArea('list1')).toBe(true);
  });

  test('should maintain scroll position after container resize', async () => {
    await expect(async () => {
      await demoPage.scrollList('list1', 500);
      expect(await demoPage.getScrollTop('list1')).toBe(500);
    }).toPass({ timeout: 2000 });

    await setListHeight(300);

    expect(await demoPage.getScrollTop('list1')).toBe(500);
    await poll(() => demoPage.coversVisibleArea('list1')).toBe(true);
  });

  test('should handle drag and drop correctly after resize', async () => {
    await setListHeight(500);
    const movedId = await demoPage.getItemId('list1', 0);

    await demoPage.dragItemToList('list1', 0, 'list2', 0);

    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
  });

  test('should handle container resizing during drag operation', async ({ page }) => {
    const movedId = await demoPage.getItemId('list1', 0);

    await demoPage.startDrag(demoPage.list1Items.first());

    // Resize the container during drag
    await setListHeight(500);

    // Continue the drag and drop
    const targetBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!targetBox) throw new Error('Could not get the target list bounding box');
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = Math.min(targetBox.y + 25, targetBox.y + targetBox.height - 10);
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await demoPage.settleDragPosition(targetX, targetY);
    await demoPage.waitForActiveDroppable('list2');
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();

    // The drag completed: the item moved to the top of list2
    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
  });

  test('should render correctly after multiple rapid resizes', async ({ page }) => {
    const container = demoPage.list1VirtualScroll;

    for (const height of [300, 500, 200, 600, 900]) {
      await container.evaluate((el, h) => {
        el.style.height = `${h}px`;
      }, height);
      await waitForFrames(page, 1);
    }

    // The last size wins, and the rows fill it wherever the list is scrolled
    await poll(async () => (await container.boundingBox())?.height).toBe(900);
    await poll(() => demoPage.coversVisibleArea('list1')).toBe(true);
    await demoPage.scrollList('list1', 1200);
    await poll(() => demoPage.coversVisibleArea('list1')).toBe(true);
  });
});
