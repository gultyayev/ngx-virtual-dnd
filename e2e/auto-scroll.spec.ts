import { expect, test } from '@playwright/test';
import { Box, DemoPage } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';

/**
 * Autoscroll runs once per animation frame, so "no scrolling" is checked over a number of
 * frames (it would have moved several pixels per frame) rather than a wall-clock sleep.
 */
const IDLE_FRAMES = 10;

test.describe('Auto Scroll', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should auto-scroll when dragging near bottom edge', async ({ page }) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    // Move to near bottom edge (within threshold of 50px)
    const nearBottomX = containerBox.x + 100;
    const nearBottomY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(nearBottomX, nearBottomY, { steps: 10 });

    // Re-issue the edge move on each attempt so WebKit cannot coalesce the final event away
    await expect(async () => {
      await page.mouse.move(nearBottomX, nearBottomY);
      expect(await demoPage.getScrollTop('list1')).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });

    await page.mouse.up();
  });

  test('should auto-scroll when dragging near top edge', async ({ page }) => {
    // First scroll down — wrap write+read in toPass so scroll re-applies if content isn't ready
    await expect(async () => {
      await demoPage.scrollList('list1', 200);
      expect(await demoPage.getScrollTop('list1')).toBe(200);
    }).toPass({ timeout: 2000 });

    // Start dragging a visible item
    let sourceBox: Box | null = null;
    await expect(async () => {
      sourceBox = await demoPage.getLastVisibleItemBox('list1');
      expect(sourceBox).not.toBeNull();
    }).toPass({ timeout: 3000 });
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!sourceBox || !containerBox) {
      throw new Error('Could not get source/container bounding boxes');
    }

    await demoPage.startDrag(sourceBox);

    // Move to near top edge
    const nearTopX = containerBox.x + 100;
    const nearTopY = containerBox.y + 25;
    await page.mouse.move(nearTopX, nearTopY, { steps: 10 });

    await expect(async () => {
      await page.mouse.move(nearTopX, nearTopY);
      expect(await demoPage.getScrollTop('list1')).toBeLessThan(200);
    }).toPass({ timeout: 5000 });

    await page.mouse.up();
  });

  test('should stop auto-scrolling when drag ends', async ({ page }) => {
    await demoPage.startDrag(demoPage.list1Items.first());

    // Move near bottom edge
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');
    const nearBottomX = containerBox.x + containerBox.width / 2;
    const nearBottomY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(nearBottomX, nearBottomY);
    await demoPage.settleDragPosition(nearBottomX, nearBottomY);

    // Wait for some autoscroll to happen
    await expect(async () => {
      await page.mouse.move(nearBottomX, nearBottomY);
      expect(await demoPage.getScrollTop('list1')).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });

    // End the drag; the preview disappearing proves the mouseup was processed
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();
    const scrollAfterDrop = await demoPage.getScrollTop('list1');

    // No further scrolling afterwards
    await waitForFrames(page, IDLE_FRAMES);
    expect(await demoPage.getScrollTop('list1')).toBe(scrollAfterDrop);
  });

  test('should not scroll when cursor is not near edge', async ({ page }) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    // Move to center of container (not near any edge), processed by the drag scheduler
    const centerX = containerBox.x + 100;
    const centerY = containerBox.y + containerBox.height / 2;
    await page.mouse.move(centerX, centerY, { steps: 10 });
    await demoPage.settleDragPosition(centerX, centerY);

    await waitForFrames(page, IDLE_FRAMES);
    expect(await demoPage.getScrollTop('list1')).toBe(0);

    await page.mouse.up();
  });
});
