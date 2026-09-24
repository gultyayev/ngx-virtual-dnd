import { expect, Locator, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { afterInputHandled } from './fixtures/drag-sync';

test.describe('Drag UX Features - Cursor Management', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('should add vdnd-dragging class to body during drag', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).not.toHaveClass(/vdnd-dragging/);

    await demoPage.startDrag(demoPage.list1Items.first());
    await expect(body).toHaveClass(/vdnd-dragging/);

    await page.mouse.up();
    await expect(body).not.toHaveClass(/vdnd-dragging/);
  });

  test('should inject cursor styles for grabbing cursor', async ({ page }) => {
    const styleElement = page.locator('#vdnd-cursor-styles');
    await expect(styleElement).toBeAttached();
    expect(await styleElement.textContent()).toContain('cursor: grabbing');
  });
});

test.describe('Drag UX Features - Drag Handle', () => {
  let demoPage: DemoPage;

  test.beforeEach(({ page }) => {
    demoPage = new DemoPage(page);
  });

  /** Press on `target` and move far past the threshold; the drag must not start. */
  async function expectNoDragFrom(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error('Could not get the press target bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await afterInputHandled(page, 'mousemove', () => page.mouse.move(box.x + 100, box.y + 100));
    await expect(demoPage.dragPreview).not.toBeVisible();
    await page.mouse.up();
  }

  test('should only start drag from the handle when enabled', async ({ page }) => {
    await demoPage.goto({ dragHandle: true });
    const firstItem = demoPage.list1Items.first();

    // Pressing the item text (not the handle) does not start a drag...
    await expectNoDragFrom(page, firstItem.getByTestId('demo-item-text'));

    // ...pressing the handle does
    await demoPage.startDrag(firstItem.getByTestId('demo-item-handle'));
    await page.mouse.up();
  });

  test('should apply drag handle changes at runtime', async ({ page }) => {
    await demoPage.goto();
    const handleCheckbox = page.getByTestId('drag-handle-checkbox');
    const firstText = demoPage.list1Items.first().getByTestId('demo-item-text');

    // The demo's use-handle class renders in the same pass as the dragHandle input: a sync point
    await handleCheckbox.check();
    await expect(demoPage.list1Items.first()).toHaveClass(/use-handle/);
    await expectNoDragFrom(page, firstText);

    // Without the handle, the whole item starts a drag again
    await handleCheckbox.uncheck();
    await expect(demoPage.list1Items.first()).not.toHaveClass(/use-handle/);
    await demoPage.startDrag(firstText);
    await page.mouse.up();
  });
});
