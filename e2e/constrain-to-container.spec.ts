import { expect, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { poll } from './fixtures/polling';

interface DebugState {
  activeDroppable: string | null;
  placeholder: string | null;
  placeholderIndex: number | null;
  sourceIndex: number | null;
}

test.describe('Constrain to Container', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto({ constrainToContainer: true });
    await demoPage.list1VirtualScroll.evaluate((el) =>
      el.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
  });

  async function getDebugState(page: Page): Promise<DebugState> {
    const raw = await page.getByTestId('drag-state-debug').textContent();
    if (!raw) {
      throw new Error('Debug panel state is missing');
    }
    return JSON.parse(raw) as DebugState;
  }

  async function expectBottomReorderDestination(page: Page): Promise<void> {
    await expect(async () => {
      const debugState = await getDebugState(page);
      expect(debugState.activeDroppable).toBe('list-1');
      expect(debugState.placeholder).not.toBeNull();
      expect(debugState.placeholderIndex).not.toBeNull();
      expect(debugState.sourceIndex).not.toBeNull();
      expect(debugState.placeholderIndex!).toBeGreaterThan(debugState.sourceIndex! + 1);
    }).toPass({ timeout: 3000 });
  }

  async function expectActiveDroppable(page: Page): Promise<void> {
    await expect(async () => {
      const debugState = await getDebugState(page);
      expect(debugState.activeDroppable).toBe('list-1');
      expect(debugState.placeholder).not.toBeNull();
    }).toPass({ timeout: 3000 });
  }

  /**
   * Clamp a pointer target into the viewport: Firefox drops a mouse.move to a point outside it,
   * steps included, so the drag would never leave the container there.
   */
  function insideViewport(page: Page, y: number): number {
    const height = page.viewportSize()?.height ?? 720;
    return Math.min(Math.max(y, 2), height - 2);
  }

  /** Top and bottom edge of the drag preview (viewport coordinates). */
  async function previewEdges(): Promise<{ top: number; bottom: number }> {
    const box = await demoPage.dragPreview.boundingBox();
    if (!box) throw new Error('Could not get preview bounding box');
    return { top: box.y, bottom: box.y + box.height };
  }

  test('bottom drag stays in droppable and drop succeeds', async ({ page }) => {
    const expectedFirstId = await demoPage.getItemId('list1', 1);
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) {
      throw new Error('Could not get the container bounding box');
    }

    await demoPage.startDrag(demoPage.list1Items.first());

    const belowContainerY = insideViewport(page, containerBox.y + containerBox.height + 200);
    const targetX = containerBox.x + containerBox.width / 2;
    await page.mouse.move(targetX, belowContainerY, { steps: 20 });
    await page.mouse.move(targetX, belowContainerY);

    await expect(demoPage.placeholder).toBeVisible();
    await expectActiveDroppable(page);

    const bottomEdgeY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(targetX, bottomEdgeY, { steps: 10 });
    await page.mouse.move(targetX, bottomEdgeY);
    await expectBottomReorderDestination(page);

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });

    await expect(demoPage.countBadge('list1')).toHaveText('50');
    await expect(async () => {
      await demoPage.scrollList('list1', 0);
      expect(await demoPage.getScrollTop('list1')).toBe(0);
      expect(await demoPage.getItemId('list1', 0)).toBe(expectedFirstId);
    }).toPass({ timeout: 3000 });
  });

  test('preview is pinned inside the container at its top boundary', async ({ page }) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) {
      throw new Error('Could not get the container bounding box');
    }

    // Start from the third item so the preview has to travel up to reach the edge
    await demoPage.startDrag(demoPage.list1Items.nth(2));

    const aboveContainerY = insideViewport(page, containerBox.y - 200);
    const targetX = containerBox.x + containerBox.width / 2;
    await page.mouse.move(targetX, aboveContainerY, { steps: 20 });
    await page.mouse.move(targetX, aboveContainerY);

    // Clamped to 1px inside the top edge (not merely "still inside": it must have moved there)
    await poll(async () => (await previewEdges()).top - containerBox.y).toBeCloseTo(1, 0);

    await page.mouse.move(
      containerBox.x + containerBox.width / 2,
      containerBox.y + containerBox.height / 2,
    );
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });
  });

  test('autoscroll works at both edges with constrainToContainer', async ({ page }) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get container box');

    // Grab the first item near its bottom edge (non-trivial grabOffset.y)
    const sourceItem = demoPage.list1Items.first();
    await sourceItem.scrollIntoViewIfNeeded();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source item box');

    const grabX = sourceBox.x + sourceBox.width / 2;
    const grabY = sourceBox.y + sourceBox.height - 5;

    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 10, grabY + 10, { steps: 2 });
    await expect(demoPage.dragPreview).toBeVisible({ timeout: 2000 });

    // Move to the container's bottom edge to trigger downward autoscroll
    const bottomEdgeY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(grabX, bottomEdgeY, { steps: 15 });
    await page.mouse.move(grabX, bottomEdgeY);

    // Wait for scrollTop to increase substantially (proves downward autoscroll works)
    await poll(() => demoPage.getScrollTop('list1'), { timeout: 10000 }).toBeGreaterThan(100);

    const scrollTopBeforeTopEdge = await demoPage.getScrollTop('list1');

    // Now move to the container's top edge — autoscroll should reverse upward
    const topEdgeY = containerBox.y + 25;
    await page.mouse.move(grabX, topEdgeY, { steps: 15 });
    await page.mouse.move(grabX, topEdgeY);

    await poll(() => demoPage.getScrollTop('list1'), {
      timeout: 5000,
      message: 'Autoscroll up should trigger at top edge with non-trivial grabOffset',
    }).toBeLessThan(scrollTopBeforeTopEdge);

    // Clean up: drop inside the container
    await page.mouse.move(
      containerBox.x + containerBox.width / 2,
      containerBox.y + containerBox.height / 2,
    );
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });
  });

  test('preview is pinned inside the container at its bottom boundary', async ({ page }) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) {
      throw new Error('Could not get the container bounding box');
    }

    await demoPage.startDrag(demoPage.list1Items.first());

    const belowContainerY = insideViewport(page, containerBox.y + containerBox.height + 200);
    const targetX = containerBox.x + containerBox.width / 2;
    await page.mouse.move(targetX, belowContainerY, { steps: 20 });
    await page.mouse.move(targetX, belowContainerY);

    // Clamped to 1px inside the bottom edge (not merely "still inside": it must have moved there)
    const containerBottom = containerBox.y + containerBox.height;
    await poll(async () => containerBottom - (await previewEdges()).bottom).toBeCloseTo(1, 0);

    await page.mouse.move(
      containerBox.x + containerBox.width / 2,
      containerBox.y + containerBox.height / 2,
    );
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });
  });
});
