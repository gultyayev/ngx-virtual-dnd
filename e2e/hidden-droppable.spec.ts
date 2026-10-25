import { expect, Locator, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

/** The droppable the processed drag state is over, from the demo's drag-state debug panel. */
async function activeDroppable(page: Page): Promise<unknown> {
  const raw = await page.getByTestId('drag-state-debug').textContent();
  return (JSON.parse(raw ?? '{}') as { activeDroppable?: unknown }).activeDroppable;
}

async function setVisibility(card: Locator, value: 'hidden' | ''): Promise<void> {
  await card.evaluate((el, visibility) => (el.style.visibility = visibility), value);
}

// A list that is mounted but `visibility: hidden` (a panel hidden without taking it out of the
// layout) stays registered in the group and keeps its rect. The pointer must not drop into it,
// as keyboard navigation doesn't move into it (keyboard-drag-crosslist.spec.ts). Hiding or
// showing it resizes and scrolls nothing, so the drag must notice the change by itself.
test.describe('visibility: hidden droppable', () => {
  let demoPage: DemoPage;
  let list2Card: Locator;
  let target: { x: number; y: number };

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
    list2Card = page.getByTestId('list-2-card');

    await demoPage.list2VirtualScroll.scrollIntoViewIfNeeded();
    const box = await demoPage.list2VirtualScroll.boundingBox();
    if (!box) {
      throw new Error('Could not get the List 2 bounding box');
    }
    target = { x: box.x + box.width / 2, y: box.y + 75 };
  });

  test('should stop being a target when hidden during the drag', async ({ page }) => {
    const draggedId = await demoPage.getItemId('list1', 0);

    await demoPage.startDrag(demoPage.list1Items.first());
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await demoPage.settleDragPosition(target.x, target.y);
    await demoPage.waitForActiveDroppable('list2');

    await setVisibility(list2Card, 'hidden');
    await expect(list2Card).toBeHidden();
    // The next pointer frames over the hidden list leave it
    await expect(async () => {
      await demoPage.settleDragPosition(target.x, target.y);
      expect(await activeDroppable(page)).not.toBe('list-2');
    }).toPass({ timeout: 5000 });

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();

    // Released over no list: dragEnd reports no destination, and nothing moved
    await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
    expect(await demoPage.host.getAttribute('data-last-drag-end-destination-index')).toBeNull();
    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(demoPage.countBadge('list2')).toHaveText('50');
    expect(await demoPage.getItemId('list1', 0)).toBe(draggedId);
  });

  test('should become a target when shown during the drag', async ({ page }) => {
    const movedId = await demoPage.getItemId('list1', 0);
    await setVisibility(list2Card, 'hidden');
    await expect(list2Card).toBeHidden();

    await demoPage.startDrag(demoPage.list1Items.first());
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await demoPage.settleDragPosition(target.x, target.y);
    expect(await activeDroppable(page)).not.toBe('list-2');

    await setVisibility(list2Card, '');
    await expect(list2Card).toBeVisible();
    await expect(async () => {
      await demoPage.settleDragPosition(target.x, target.y);
      expect(await activeDroppable(page)).toBe('list-2');
    }).toPass({ timeout: 5000 });

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();

    await expect(demoPage.countBadge('list1')).toHaveText('49');
    await expect(demoPage.countBadge('list2')).toHaveText('51');
    expect(await demoPage.getItemId('list2', 1)).toBe(movedId);
  });
});

// Keyboard navigation does not move into a hidden list, but a list can be hidden after the drag
// moved into it. Completing the drag there must not drop into it.
test.describe('keyboard drop into a list hidden after the drag moved into it', () => {
  for (const hide of ['visibility: hidden', 'display: none'] as const) {
    test(`does not drop into it (${hide})`, async ({ page }) => {
      const demoPage = new DemoPage(page);
      await demoPage.goto();
      const list2Card = page.getByTestId('list-2-card');
      const draggedId = await demoPage.getItemId('list1', 0);

      await demoPage.startKeyboardDrag('list1', 0);
      await expect(demoPage.dragPreview).toBeVisible();
      await demoPage.keyboardMoveToList('right');
      await demoPage.waitForActiveDroppable('list2');

      await list2Card.evaluate((el, style) => el.setAttribute('style', style), hide);
      await expect(list2Card).toBeHidden();
      await demoPage.keyboardDrop();
      await expect(demoPage.dragPreview).not.toBeVisible();

      // dragEnd reports no destination, no drop fired, and nothing moved
      await expect(demoPage.host).toHaveAttribute('data-last-drag-end-cancelled', 'false');
      expect(await demoPage.host.getAttribute('data-last-drag-end-destination-index')).toBeNull();
      expect(await demoPage.host.getAttribute('data-last-drop-destination-index')).toBeNull();
      await expect(demoPage.countBadge('list1')).toHaveText('50');
      await expect(demoPage.countBadge('list2')).toHaveText('50');
      expect(await demoPage.getItemId('list1', 0)).toBe(draggedId);
      // Focus goes back to the item, in its own list
      await expect(page.locator(':focus')).toHaveAttribute('data-draggable-id', draggedId!);
    });
  }
});
