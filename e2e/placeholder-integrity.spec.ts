import { expect, test } from '@playwright/test';
import { DemoPage, ListName } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';

/**
 * Tests for placeholder rendering integrity.
 * These tests ensure placeholders render correctly and no "ghost" elements appear.
 */
test.describe('Placeholder Rendering Integrity', () => {
  let demoPage: DemoPage;

  test.beforeEach(({ page }) => {
    demoPage = new DemoPage(page);
  });

  /**
   * Drag the first item of `source` to 75px below the top of `target` and wait until that
   * position is processed and rendered (exactly one placeholder, in `target`).
   */
  async function dragFirstItemOver(source: ListName, target: ListName): Promise<void> {
    const targetBox = await demoPage.virtualScroll(target).boundingBox();
    if (!targetBox) throw new Error('Could not get the target list bounding box');

    await demoPage.startDrag(demoPage.items(source).first());
    const x = targetBox.x + targetBox.width / 2;
    const y = targetBox.y + 75;
    await demoPage.page.mouse.move(x, y, { steps: 10 });
    await demoPage.settleDragPosition(x, y);
    await expect(demoPage.container(target).locator('.vdnd-drag-placeholder-visible')).toHaveCount(
      1,
    );
    // Ghosts would come from this render; give it a frame to settle before inspecting the DOM
    await waitForFrames(demoPage.page, 1);
  }

  async function expectNoGhosts(list: ListName): Promise<void> {
    const items = await demoPage.getRenderedItemsWithContent(list);
    const ghosts = items.filter((item) => !item.isPlaceholder && item.text === '');
    expect(ghosts, `${list} should render no empty items`).toEqual([]);
    expect(items.filter((item) => item.isPlaceholder).length).toBeLessThanOrEqual(1);
  }

  test.describe('Ghost Element Detection', () => {
    for (const api of ['verbose', 'simplified'] as const) {
      test(`should not render ghost elements during same-list drag (${api} API)`, async ({
        page,
      }) => {
        await demoPage.goto({ api });
        await dragFirstItemOver('list2', 'list2');

        await expectNoGhosts('list2');
        await page.mouse.up();
      });
    }

    test('should not render ghost elements during cross-list drag (verbose API)', async ({
      page,
    }) => {
      await demoPage.goto();
      const draggedId = await demoPage.getItemId('list1', 0);
      await dragFirstItemOver('list1', 'list2');

      await expectNoGhosts('list1');
      await expectNoGhosts('list2');
      // The source list shows no placeholder once the target list took over, and the dragged
      // item stays hidden there
      await expect(demoPage.list1Container.locator('.vdnd-drag-placeholder-visible')).toHaveCount(
        0,
      );
      await expect(page.locator(`[data-draggable-id="${draggedId}"]`)).toHaveCSS('display', 'none');
      await page.mouse.up();
    });
  });

  test.describe('Cross-API Consistency', () => {
    test('switching the API at runtime keeps placeholder rendering intact', async ({ page }) => {
      await demoPage.goto();

      await dragFirstItemOver('list2', 'list2');
      await expectNoGhosts('list2');
      await page.mouse.up();
      await expect(demoPage.dragPreview).not.toBeVisible();

      // Switch to the simplified API at runtime (the @if swap recreates both lists)
      await demoPage.enableSimplifiedApi();

      await dragFirstItemOver('list2', 'list2');
      await expectNoGhosts('list2');
      await page.mouse.up();
      await expect(demoPage.dragPreview).not.toBeVisible();
    });
  });
});
