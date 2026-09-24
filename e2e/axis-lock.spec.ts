import { expect, Page, test } from '@playwright/test';
import { Box, DemoPage } from './fixtures/demo.page';
import { afterInputHandled, waitForFrames } from './fixtures/drag-sync';

test.describe('Axis Lock', () => {
  let demoPage: DemoPage;

  test.beforeEach(({ page }) => {
    demoPage = new DemoPage(page);
  });

  /**
   * Start dragging the first list1 item and return the preview box once the starting move has
   * been handled and rendered, plus the pointer position it was captured at.
   */
  async function startDragAndCapturePreview(
    page: Page,
  ): Promise<{ preview: Box; pointer: { x: number; y: number } }> {
    const sourceItem = demoPage.list1Items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source item bounding box');

    await sourceItem.hover();
    await page.mouse.down();
    const pointer = { x: sourceBox.x + 10, y: sourceBox.y + 10 };
    await afterInputHandled(page, 'mousemove', () => page.mouse.move(pointer.x, pointer.y));
    await expect(demoPage.dragPreview).toBeVisible();

    const preview = await demoPage.dragPreview.boundingBox();
    if (!preview) throw new Error('Could not get initial preview bounding box');
    return { preview, pointer };
  }

  /** Move diagonally by (dx, dy) and wait until the preview moved by the expected amounts. */
  async function expectPreviewToFollow(
    page: Page,
    start: { preview: Box; pointer: { x: number; y: number } },
    expected: { dx: number; dy: number },
  ): Promise<void> {
    await page.mouse.move(start.pointer.x + 100, start.pointer.y + 80, { steps: 5 });
    await expect(async () => {
      const preview = await demoPage.dragPreview.boundingBox();
      if (!preview) throw new Error('Could not get final preview bounding box');
      expect(Math.abs(preview.x - start.preview.x - expected.dx)).toBeLessThan(10);
      expect(Math.abs(preview.y - start.preview.y - expected.dy)).toBeLessThan(10);
    }).toPass({ timeout: 2000 });
  }

  test('should allow free movement when axis lock is none', async ({ page }) => {
    await demoPage.goto();
    const start = await startDragAndCapturePreview(page);

    await expectPreviewToFollow(page, start, { dx: 100, dy: 80 });

    await page.mouse.up();
  });

  test('should lock horizontal movement when axis is set to X', async ({ page }) => {
    await demoPage.goto({ lockAxis: 'x' });
    const start = await startDragAndCapturePreview(page);

    // X stays put (locked), Y follows the cursor
    await expectPreviewToFollow(page, start, { dx: 0, dy: 80 });

    await page.mouse.up();
  });

  test('should not introduce horizontal offset when X axis is locked and drag starts off-axis', async ({
    page,
  }) => {
    await demoPage.goto({ lockAxis: 'x' });

    const sourceItem = demoPage.list1Items.first();
    await sourceItem.scrollIntoViewIfNeeded();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source item bounding box');

    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Move sideways enough to exceed the default drag threshold (5px) in a single event.
    // The preview should keep its locked axis aligned to the original grab position.
    await page.mouse.move(startX + 8, startY, { steps: 1 });

    await expect(demoPage.dragPreview).toBeVisible({ timeout: 2000 });

    // With X locked, the preview should not shift horizontally from the original element position
    await expect(async () => {
      const previewBox = await demoPage.dragPreview.boundingBox();
      expect(previewBox).not.toBeNull();
      expect(Math.abs(previewBox!.x - sourceBox.x)).toBeLessThan(3);
    }).toPass({ timeout: 2000 });

    await page.mouse.up();
  });

  test('should lock vertical movement when axis is changed to Y at runtime', async ({ page }) => {
    await demoPage.goto();
    // Set through the settings panel: covers a lockAxis input change after init
    await demoPage.setLockAxis('y');
    // The draggables receive the new input in the next render; nothing visible marks it
    await waitForFrames(page, 2);
    const start = await startDragAndCapturePreview(page);

    // X follows the cursor, Y stays put (locked)
    await expectPreviewToFollow(page, start, { dx: 100, dy: 0 });

    await page.mouse.up();
  });

  test('should constrain drop detection when X axis is locked', async ({ page }) => {
    await demoPage.goto({ lockAxis: 'x' });

    const sourceItem = demoPage.list1Items.first();
    const sourceBox = await sourceItem.boundingBox();
    const list2Box = await demoPage.list2VirtualScroll.boundingBox();
    if (!sourceBox || !list2Box) throw new Error('Could not get bounding boxes');

    // Start dragging from list1
    await sourceItem.hover();
    await page.mouse.down();

    // Try to move to list2 (which is to the right)
    // With X locked, the drop target detection should stay in list1
    await page.mouse.move(list2Box.x + list2Box.width / 2, sourceBox.y + 50, { steps: 10 });
    await expect(demoPage.dragPreview).toBeVisible({ timeout: 2000 });
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    // Since X is locked, the item stays in list1 (reordered within it)
    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(demoPage.countBadge('list2')).toHaveText('50');
  });

  test('should allow cross-list drag when Y axis is locked but lists are side by side', async ({
    page,
  }) => {
    await demoPage.goto({ lockAxis: 'y' });

    await demoPage.list1VirtualScroll.scrollIntoViewIfNeeded();
    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();

    const list2Box = await demoPage.list2VirtualScroll.boundingBox();
    if (!list2Box) throw new Error('Could not get list2 bounding box');

    const findSourceItemWithinList2Y = async () => {
      for (let i = 0; i < 8; i++) {
        const candidate = demoPage.list1Items.nth(i);
        await candidate.scrollIntoViewIfNeeded();
        const box = await candidate.boundingBox();
        if (!box) continue;
        const centerY = box.y + box.height / 2;
        const isWithinList2 =
          centerY >= list2Box.y + 10 && centerY <= list2Box.y + list2Box.height - 10;
        if (isWithinList2) {
          return { sourceItem: candidate, sourceBox: box };
        }
      }

      throw new Error('Could not find a list1 source item aligned vertically with list2');
    };

    const { sourceItem, sourceBox } = await findSourceItemWithinList2Y();

    // Start dragging from list1
    await sourceItem.hover();
    await page.mouse.down();
    // Move slightly to ensure WebKit recognizes the drag
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });
    await expect(demoPage.dragPreview).toBeVisible({ timeout: 5000 });

    // Move to list2 horizontally (Y locked means we can move horizontally freely)
    const targetY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(list2Box.x + list2Box.width / 2, targetY, { steps: 10 });
    // Placeholder visibility proves a drop target resolved; wait for list2 specifically so the
    // release cannot land back in list1 when the scheduler lags behind the pointer.
    await expect(demoPage.placeholder).toBeVisible({ timeout: 5000 });
    await demoPage.waitForActiveDroppable('list2');
    await waitForFrames(page, 1);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 5000 });

    // With Y locked but horizontal movement allowed, item should move to list2
    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
  });
});
