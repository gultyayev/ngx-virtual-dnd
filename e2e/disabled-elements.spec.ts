import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { afterInputHandled } from './fixtures/drag-sync';

test.describe('Disabled Elements', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
  });

  test('should mark items disabled and ignore pointer drags', async ({ page }) => {
    await demoPage.goto({ dragEnabled: false });

    const sourceItem = demoPage.list1Items.first();
    await expect(sourceItem).toHaveClass(/vdnd-draggable-disabled/);
    await expect(sourceItem).toHaveClass(/vdnd-draggable(\s|$)/);
    const sourceId = await sourceItem.getAttribute('data-draggable-id');
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source item bounding box');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // Far past the drag threshold; the barrier makes the negative checks below meaningful.
    await afterInputHandled(page, 'mousemove', () =>
      page.mouse.move(sourceBox.x + 200, sourceBox.y + 100),
    );

    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(sourceItem).not.toHaveCSS('display', 'none');
    await expect(sourceItem).not.toHaveAttribute('aria-grabbed', 'true');

    await page.mouse.up();

    await expect(sourceItem).toHaveClass(/vdnd-draggable-disabled/);
    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(demoPage.countBadge('list2')).toHaveText('50');
    expect(await demoPage.getItemId('list1', 0)).toBe(sourceId);
  });

  test('should allow drag after re-enabling', async ({ page }) => {
    await demoPage.goto();
    const checkbox = page.getByTestId('drag-enabled-checkbox');

    // Toggled at runtime (not via URL) to cover the input change in both directions
    await checkbox.uncheck();
    await expect(demoPage.list1Items.first()).toHaveClass(/vdnd-draggable-disabled/);
    await checkbox.check();
    await expect(demoPage.list1Items.first()).not.toHaveClass(/vdnd-draggable-disabled/);

    const movedId = await demoPage.getItemId('list1', 0);
    await demoPage.dragItemToList('list1', 0, 'list2', 0);

    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 0)).toBe(movedId);
  });

  test.describe('disabled droppable (destination)', () => {
    test.beforeEach(async () => {
      await demoPage.goto({ list2Disabled: true });
      await expect(demoPage.list2Container).toHaveAttribute('data-droppable-disabled', 'true');
    });

    test('should not fire a drop when released over a disabled droppable', async ({ page }) => {
      const draggedId = await demoPage.getItemId('list1', 0);

      const sourceItem = demoPage.list1Items.first();
      await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
      const targetBox = await demoPage.list2VirtualScroll.boundingBox();
      if (!targetBox) {
        throw new Error('Could not get the target list bounding box');
      }

      const targetX = targetBox.x + targetBox.width / 2;
      const targetY = targetBox.y + Math.min(80, targetBox.height / 2);

      await demoPage.startDrag(sourceItem);

      // Move over the disabled List 2 droppable and release immediately — no RAF settle.
      // The drop must resolve against the release position (the disabled list), which the
      // synchronous pointer-up flush in #endDrag guarantees even if no frame was processed.
      await page.mouse.move(targetX, targetY, { steps: 15 });
      await page.mouse.move(targetX, targetY);
      await page.mouse.up();
      await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

      // dragEnd must fire (non-cancelled) but report no destination — no drop event.
      await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
      expect(await demoPage.host.getAttribute('data-last-drag-end-destination-index')).toBeNull();

      // Counts unchanged and the item stays in List 1 — the disabled container did not swallow it.
      await expect(demoPage.countBadge('list1')).toHaveText('50');
      await expect(demoPage.countBadge('list2')).toHaveText('50');
      expect(await demoPage.getItemId('list1', 0)).toBe(draggedId);
    });

    test('keyboard ArrowRight does not navigate into a disabled droppable', async () => {
      const draggedId = await demoPage.getItemId('list1', 0);

      await demoPage.startKeyboardDrag('list1', 0);
      await expect(demoPage.dragPreview).toBeVisible();

      // Attempt to cross into the disabled List 2, then move down: the placeholder moving to
      // index 1 of List 1 proves the ArrowRight was processed (and rejected) first.
      await demoPage.keyboardMoveToList('right');
      await demoPage.keyboardMoveDown();
      await expect(demoPage.list1Container.locator('.vdnd-drag-placeholder-visible')).toBeVisible();
      await expect(
        demoPage.list2Container.locator('.vdnd-drag-placeholder-visible'),
      ).not.toBeVisible();

      await demoPage.keyboardDrop();
      await expect(demoPage.dragPreview).not.toBeVisible();

      // The item was dropped one slot down in List 1 and never left it.
      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '1');
      await expect(demoPage.countBadge('list1')).toHaveText('50');
      await expect(demoPage.countBadge('list2')).toHaveText('50');
      expect(await demoPage.getItemId('list1', 1)).toBe(draggedId);
    });
  });

  test('should not start a drag after the drag delay when disabled', async ({ page }) => {
    // Fake timers (time still flows) let the test step past the delay instead of sleeping
    await page.clock.install();
    await demoPage.goto({ dragDelay: 200, dragEnabled: false });

    const sourceItem = demoPage.list1Items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source item bounding box');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // Past the 200ms drag delay: a disabled item must not have armed a drag
    await page.clock.runFor(250);
    await afterInputHandled(page, 'mousemove', () =>
      page.mouse.move(sourceBox.x + 100, sourceBox.y + 100),
    );

    await expect(demoPage.dragPreview).not.toBeVisible();
    await expect(sourceItem).not.toHaveClass(/vdnd-drag-pending/);

    await page.mouse.up();
  });
});
