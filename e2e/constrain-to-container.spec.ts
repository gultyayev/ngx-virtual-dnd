import { expect, Page, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { poll } from './fixtures/polling';

interface DebugState {
  activeDroppable: string | null;
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
      expect(debugState.placeholderIndex).not.toBeNull();
      expect(debugState.sourceIndex).not.toBeNull();
      expect(debugState.placeholderIndex!).toBeGreaterThan(debugState.sourceIndex! + 1);
    }).toPass({ timeout: 3000 });
  }

  async function expectActiveDroppable(page: Page): Promise<void> {
    await expect(async () => {
      const debugState = await getDebugState(page);
      expect(debugState.activeDroppable).toBe('list-1');
      expect(debugState.placeholderIndex).not.toBeNull();
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

/**
 * A preview pinned at an edge of a scrolled list must keep the visible edge row as the drop
 * position: the first/last slot only once the list is scrolled to that end (issue #112).
 * List 1: 200 rows of 50px (10000px) in a 400px list, so autoscroll (at most 15px per frame)
 * needs well over 5s to reach either end from the middle, however loaded the machine is.
 */
for (const api of ['verbose', 'simplified'] as const) {
  test.describe(`Constrain to Container: pinned edge drops on a scrolled list (${api} API)`, () => {
    const ROW = 50;
    const ROWS = 200;
    const LIST_HEIGHT = 400;
    let demoPage: DemoPage;

    test.beforeEach(async ({ page }) => {
      demoPage = new DemoPage(page);
      // 400 items split between both lists: 200 in list 1
      await demoPage.goto({ constrainToContainer: true, api, itemCount: 2 * ROWS });
      await expect(demoPage.countBadge('list1')).toHaveText(String(ROWS));
    });

    async function listBox(): Promise<{ x: number; y: number; width: number; height: number }> {
      const box = await demoPage.list1VirtualScroll.boundingBox();
      if (!box) throw new Error('Could not get the list bounding box');
      return box;
    }

    async function scrollListTo(scrollTop: number): Promise<void> {
      await expect(async () => {
        await demoPage.scrollList('list1', scrollTop);
        expect(await demoPage.getScrollTop('list1')).toBe(scrollTop);
      }).toPass({ timeout: 3000 });
    }

    /** Box of the rendered row of list 1 whose top is `offset` px below the list top. */
    async function rowBoxAt(offset: number): Promise<{ x: number; y: number; height: number }> {
      let box: { x: number; y: number; height: number } | null = null;
      await expect(async () => {
        box = await demoPage.list1VirtualScroll.evaluate((list, rowOffset) => {
          const listTop = list.getBoundingClientRect().top;
          for (const row of list.querySelectorAll('[data-draggable-id]')) {
            const rect = row.getBoundingClientRect();
            if (Math.abs(rect.top - listTop - rowOffset) < 1) {
              return { x: rect.x + rect.width / 2, y: rect.y, height: rect.height };
            }
          }
          return null;
        }, offset);
        expect(box).not.toBeNull();
      }).toPass({ timeout: 3000 });
      return box!;
    }

    /** Debug placeholder index and list scrollTop, read in one evaluation. */
    async function placeholderAndScroll(
      page: Page,
    ): Promise<{ placeholderIndex: number | null; scrollTop: number }> {
      return page.evaluate(() => {
        const raw = document.querySelector('[data-testid="drag-state-debug"]')?.textContent;
        const list = document.querySelector(
          '[data-droppable-id="list-1"] [data-item-height]',
        ) as HTMLElement | null;
        const state = raw ? (JSON.parse(raw) as { placeholderIndex: number | null }) : null;
        return {
          placeholderIndex: state?.placeholderIndex ?? null,
          scrollTop: list?.scrollTop ?? -1,
        };
      });
    }

    async function lastDropIndex(): Promise<number> {
      await expect(demoPage.dragPreview).not.toBeVisible({ timeout: 2000 });
      const value = await demoPage.host.getAttribute('data-last-drop-destination-index');
      expect(value, 'The drop should have been delivered').not.toBeNull();
      return Number(value);
    }

    test('top edge while autoscrolling: drops at the visible top row, not at 0', async ({
      page,
    }) => {
      // Far enough down that autoscroll (≤15px per frame) can't reach the top before release
      await scrollListTo(5000);
      const list = await listBox();
      const row = await rowBoxAt(3 * ROW);
      await demoPage.startDrag({ x: row.x - 50, y: row.y, width: 100, height: row.height });

      // Past the top: the preview is pinned 1px inside and autoscroll moves the list up
      const aboveY = Math.max(2, list.y - 100);
      await page.mouse.move(row.x, aboveY, { steps: 5 });
      await page.mouse.move(row.x, aboveY);
      await poll(async () => {
        const box = await demoPage.dragPreview.boundingBox();
        return box ? box.y - list.y : Number.NaN;
      }).toBeCloseTo(1, 0);

      // The placeholder stays on the first visible row while the list scrolls. A short retry
      // (the debug panel may render a frame late): autoscroll needs >5s to bring the list from
      // 5000px to where the first slot would be the visible top row.
      await expect(async () => {
        const { placeholderIndex, scrollTop } = await placeholderAndScroll(page);
        expect(placeholderIndex).not.toBeNull();
        expect(Math.abs(placeholderIndex! * ROW - scrollTop)).toBeLessThanOrEqual(2 * ROW);
      }).toPass({ timeout: 500 });

      await page.mouse.up();
      const dropIndex = await lastDropIndex();
      const scrollTop = await demoPage.getScrollTop('list1');
      expect(scrollTop, 'Released before autoscroll reached the top').toBeGreaterThan(4 * ROW);
      expect(dropIndex).toBeGreaterThan(0);
      expect(Math.abs(dropIndex * ROW - scrollTop)).toBeLessThanOrEqual(2 * ROW);
    });

    test('bottom edge while autoscrolling: drops at the visible bottom row, not at the end', async ({
      page,
    }) => {
      const list = await listBox();
      const row = await rowBoxAt(0);
      await demoPage.startDrag({ x: row.x - 50, y: row.y, width: 100, height: row.height });

      // Past the bottom: the preview is pinned 1px inside and autoscroll moves the list down
      const viewportHeight = page.viewportSize()?.height ?? 720;
      const belowY = Math.min(viewportHeight - 2, list.y + list.height + 100);
      await page.mouse.move(row.x, belowY, { steps: 5 });
      await page.mouse.move(row.x, belowY);
      await poll(async () => {
        const box = await demoPage.dragPreview.boundingBox();
        return box ? list.y + list.height - (box.y + box.height) : Number.NaN;
      }).toBeCloseTo(1, 0);

      // The placeholder stays on the last visible row while the list scrolls (short retry: see
      // the top-edge test; the list needs >10s to scroll to where the end would be visible)
      await expect(async () => {
        const { placeholderIndex, scrollTop } = await placeholderAndScroll(page);
        expect(placeholderIndex).not.toBeNull();
        expect(Math.abs(placeholderIndex! * ROW - (scrollTop + LIST_HEIGHT))).toBeLessThanOrEqual(
          2 * ROW,
        );
      }).toPass({ timeout: 500 });

      await page.mouse.up();
      const dropIndex = await lastDropIndex();
      const scrollTop = await demoPage.getScrollTop('list1');
      expect(scrollTop, 'Released before autoscroll reached the bottom').toBeLessThan(5000);
      expect(dropIndex).toBeLessThan(ROWS - 1);
      expect(Math.abs(dropIndex * ROW - (scrollTop + LIST_HEIGHT))).toBeLessThanOrEqual(3 * ROW);
    });

    test('top edge while the list stays still: a card grabbed near its bottom drops where it is', async ({
      page,
    }) => {
      // At scrollTop 1000 the row 100px below the list top is index 22. Grab it near its bottom
      // (grab offset in (48, 49] px) and hold the pointer 98px higher: the preview top is then
      // 2px below the list top (inside the 2px edge tolerance) while the pointer is >50px below
      // it, outside the 50px autoscroll band, so the list does not scroll.
      await scrollListTo(1000);
      const row = await rowBoxAt(2 * ROW);
      // The first whole pixel more than 48px below the row top: at least 1px above the row's
      // bottom, since WebKit hit-tests pixel-snapped rows and a press <1px above a fractional
      // bottom grabs the next row.
      const grabY = Math.floor(row.y + 48) + 1;
      await page.mouse.move(row.x, grabY);
      await page.mouse.down();
      await page.mouse.move(row.x, grabY - 5, { steps: 2 });
      await expect(demoPage.dragPreview, 'The drag should start').toBeVisible({ timeout: 2000 });
      await expect(async () => {
        const raw = await page.getByTestId('drag-state-debug').textContent();
        expect((JSON.parse(raw ?? '{}') as { sourceIndex?: number }).sourceIndex).toBe(22);
      }, 'The grabbed row').toPass({ timeout: 2000 });

      const holdY = grabY - 98;
      await page.mouse.move(row.x, holdY, { steps: 10 });
      // Like settleDragPosition, but jitter downwards: 2px up would enter the autoscroll band
      await expect(async () => {
        await page.mouse.move(row.x, holdY + 2);
        await page.mouse.move(row.x, holdY);
        const raw = await page.getByTestId('drag-state-debug').textContent();
        const cursor = (JSON.parse(raw ?? '{}') as { cursorPosition?: { y?: number } | null })
          .cursorPosition;
        expect(Math.abs((cursor?.y ?? Number.NaN) - holdY)).toBeLessThanOrEqual(1);
      }).toPass({ timeout: 5000 });

      const list = await listBox();
      const previewBox = await demoPage.dragPreview.boundingBox();
      if (!previewBox) throw new Error('Could not get the preview bounding box');
      expect(previewBox.y - list.y).toBeLessThanOrEqual(2.5);
      expect(holdY - list.y, 'Outside the autoscroll band').toBeGreaterThan(50);

      // The probe's row (index 20, the first visible row) — not the first slot of the list
      await expect(async () => {
        const { placeholderIndex, scrollTop } = await placeholderAndScroll(page);
        expect(scrollTop).toBe(1000);
        expect(placeholderIndex).toBe(20);
      }).toPass({ timeout: 2000 });

      await page.mouse.up();
      expect(await lastDropIndex()).toBe(20);
      expect(await demoPage.getScrollTop('list1')).toBe(1000);
    });
  });
}
