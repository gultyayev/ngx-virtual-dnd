import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

test.describe('Placeholder Behavior During Drag', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('dragged item is hidden and its slot collapses instead of leaving a gap', async ({
    page,
  }) => {
    const [firstId, secondId] = await demoPage.getItemIds('list2');
    const firstItem = page.locator(`[data-draggable-id="${firstId}"]`);
    const firstBox = await firstItem.boundingBox();
    if (!firstBox) throw new Error('Could not get the first item bounding box');

    // Drag the first item over the second slot
    await demoPage.startDrag(firstItem);
    const x = firstBox.x + firstBox.width / 2;
    const y = firstBox.y + 75;
    await page.mouse.move(x, y, { steps: 5 });
    await demoPage.settleDragPosition(x, y);

    await expect(firstItem).toHaveCSS('display', 'none');

    // The second item moved up into the first slot and the single placeholder sits right below
    // it: the hidden item takes no space (no double gap).
    await expect(async () => {
      const layout = await page.evaluate((id) => {
        const list = document.querySelector('[data-droppable-id="list-2"]')!;
        const placeholders = list.querySelectorAll('.vdnd-drag-placeholder-visible');
        const second = list.querySelector(`[data-draggable-id="${id}"]`);
        return {
          placeholderCount: placeholders.length,
          placeholderTop: placeholders[0]?.getBoundingClientRect().top ?? Number.NaN,
          secondTop: second?.getBoundingClientRect().top ?? Number.NaN,
        };
      }, secondId);
      expect(layout.placeholderCount).toBe(1);
      expect(Math.abs(layout.secondTop - firstBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.placeholderTop - (firstBox.y + firstBox.height))).toBeLessThanOrEqual(
        1,
      );
    }).toPass({ timeout: 2000 });

    await page.mouse.up();
  });
});
