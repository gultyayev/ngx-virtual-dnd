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

  test('should cancel the drag when the window loses focus mid-drag', async ({ page }) => {
    const body = page.locator('body');
    const firstId = await demoPage.getItemId('list1', 0);
    const first = page.locator(`[data-draggable-id="${firstId}"]`);

    await demoPage.startDrag(first);
    // What the browser fires when the user switches windows while holding the button
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));

    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(body).not.toHaveClass(/vdnd-dragging/);
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'true');
    await expect(first).toBeVisible();
    await page.mouse.up();

    // Nothing is left stuck: the next drag starts and drops normally
    await demoPage.startDrag(first);
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
  });

  test('should inject cursor styles for grabbing cursor', async ({ page }) => {
    const styleElement = page.locator('#vdnd-cursor-styles');
    await expect(styleElement).toBeAttached();
    expect(await styleElement.textContent()).toContain('cursor: grabbing');
  });

  test('shows the grabbing cursor over lists and items during a mouse drag', async ({ page }) => {
    await demoPage.startDrag(demoPage.list1Items.first());

    // What the user sees: the cursor of the element under the pointer (the demo turns off
    // pointer events on items during a drag, so over an item that is the list beneath)
    const target = demoPage.list2Items.nth(1);
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 5 });
    await demoPage.waitForActiveDroppable('list2');
    expect(await cursorAtPoint(page, box!.x + box!.width / 2, box!.y + box!.height / 2)).toBe(
      'grabbing',
    );
    await expect(demoPage.list1Container).toHaveCSS('cursor', 'grabbing');
    await expect(target).toHaveCSS('cursor', 'grabbing');

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.list2Container).not.toHaveCSS('cursor', 'grabbing');
    await expect(target).not.toHaveCSS('cursor', 'grabbing');
  });

  test('shows the grabbing cursor over lists during a keyboard drag', async () => {
    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();

    await expect(demoPage.list1Container).toHaveCSS('cursor', 'grabbing');
    await expect(demoPage.list2Container).toHaveCSS('cursor', 'grabbing');

    await demoPage.keyboardCancel();
    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(demoPage.list1Container).not.toHaveCSS('cursor', 'grabbing');
  });

  // Toggling a rule that matches every element restyles the whole document at drag start and
  // drop; the cursor rule covers lists and items only
  test('does not restyle the rest of the page during a drag', async ({ page }) => {
    await demoPage.startDrag(demoPage.list1Items.first());
    await expect(page.locator('body')).toHaveClass(/vdnd-dragging/);

    expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toBe('grabbing');
    expect(
      await demoPage.settingsCollapse.evaluate((element) => getComputedStyle(element).cursor),
    ).not.toBe('grabbing');

    await page.mouse.up();
  });
});

/** The cursor of the element under a viewport point, as the user sees it there. */
async function cursorAtPoint(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => {
      const element = document.elementFromPoint(px, py);
      return element ? getComputedStyle(element).cursor : null;
    },
    [x, y] as const,
  );
}

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
