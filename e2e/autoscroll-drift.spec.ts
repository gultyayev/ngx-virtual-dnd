import { expect, Page, test, TestInfo } from '@playwright/test';
import { Box, DemoPage, ListName } from './fixtures/demo.page';
import { waitForFrames } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

interface DriftSnapshot {
  actualIndex: number;
  expectedIndex: number;
  scrollTop: number;
  indexDrift: number;
}

interface DragDebugState {
  placeholderIndex?: number | null;
  draggedItemHeight?: number | null;
  sourceDroppable?: string | null;
  sourceIndex?: number | null;
  activeDroppable?: string | null;
  cursorPosition?: { x: number; y: number } | null;
  grabOffset?: { x: number; y: number } | null;
}

interface ContainerMetrics {
  rectTop: number;
  rectBottom: number;
  scrollTop: number;
  itemHeight: number;
  totalItems: number;
}

/**
 * Read the list's scroll metrics and the processed drag state in ONE evaluation: during
 * autoscroll, two round trips would pair a scrollTop with a drag state from another frame.
 */
async function getDriftSnapshot(page: Page, list: ListName): Promise<DriftSnapshot> {
  const droppableId = list === 'list1' ? 'list-1' : 'list-2';
  const { metrics, rawDragState } = await page.evaluate((id) => {
    const el = document.querySelector(`[data-droppable-id="${id}"] [data-item-height]`);
    if (!el) throw new Error(`No virtual scroll container in ${id}`);
    const rect = el.getBoundingClientRect();
    const itemHeight = parseFloat(el.getAttribute('data-item-height') ?? '50');
    const totalItems = parseInt(el.getAttribute('data-total-items') ?? '0', 10);
    return {
      metrics: {
        rectTop: rect.top,
        rectBottom: rect.bottom,
        scrollTop: el.scrollTop,
        itemHeight: Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : 50,
        totalItems: Number.isFinite(totalItems) && totalItems > 0 ? totalItems : 0,
      },
      rawDragState: document.querySelector('[data-testid="drag-state-debug"]')?.textContent,
    };
  }, droppableId);

  const dragState = JSON.parse(rawDragState ?? '{}') as DragDebugState;
  const actualIndex = dragState.placeholderIndex ?? -1;
  const expectedIndex = getExpectedPlaceholderIndex(dragState, metrics);

  return {
    actualIndex,
    expectedIndex,
    scrollTop: metrics.scrollTop,
    indexDrift: Math.abs(expectedIndex - actualIndex),
  };
}

function getExpectedPlaceholderIndex(dragState: DragDebugState, metrics: ContainerMetrics): number {
  const cursor = dragState.cursorPosition;
  const grabOffset = dragState.grabOffset;
  if (!cursor || !grabOffset) {
    return -1;
  }

  const previewHeight =
    dragState.draggedItemHeight && dragState.draggedItemHeight > 0
      ? dragState.draggedItemHeight
      : metrics.itemHeight;
  const previewTopY = cursor.y - grabOffset.y;
  const previewCenterY = previewTopY + previewHeight / 2;
  const indexProbeY = Math.min(previewCenterY, previewTopY + metrics.itemHeight / 2);
  const relativeY = indexProbeY - metrics.rectTop + metrics.scrollTop;
  let placeholderIndex = Math.floor(relativeY / metrics.itemHeight);

  const sourceIndex = dragState.sourceIndex ?? -1;
  const isSameList =
    dragState.sourceDroppable !== null &&
    dragState.sourceDroppable !== undefined &&
    dragState.sourceDroppable === dragState.activeDroppable;
  if (isSameList && sourceIndex >= 0 && placeholderIndex >= sourceIndex) {
    placeholderIndex += 1;
  }

  const cursorRelativeToBottom = metrics.rectBottom - previewCenterY;
  if (cursorRelativeToBottom < metrics.itemHeight && placeholderIndex >= metrics.totalItems - 1) {
    placeholderIndex = metrics.totalItems;
  }

  return Math.max(0, Math.min(placeholderIndex, metrics.totalItems));
}

async function waitForDriftSnapshot(
  page: Page,
  list: ListName,
  assertSnapshot: (snapshot: DriftSnapshot) => void,
  timeout: number,
): Promise<DriftSnapshot> {
  let matchingSnapshot: DriftSnapshot | null = null;

  await expect(async () => {
    const snapshot = await getDriftSnapshot(page, list);
    assertSnapshot(snapshot);
    matchingSnapshot = snapshot;
  }).toPass({ timeout });

  if (!matchingSnapshot) {
    throw new Error('No drift snapshot matched the expected state');
  }
  return matchingSnapshot;
}

function attachJson(testInfo: TestInfo, name: string, body: unknown): Promise<void> {
  return testInfo.attach(name, {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  });
}

test.describe('Autoscroll Placeholder Drift', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    // Item count defaults to 100 in the demo (50 per list)
    await demoPage.goto();
    await demoPage.list1VirtualScroll.evaluate((el) =>
      el.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
  });

  test('placeholder should stay aligned in List 2 during extended autoscroll', async ({
    page,
  }, testInfo) => {
    // User's scenario: drag the first item of List 2 and autoscroll down
    const containerBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list2Items.first());

    // Move to bottom edge to trigger autoscroll
    const nearBottomY = containerBox.y + containerBox.height - 15;
    await page.mouse.move(containerBox.x + 100, nearBottomY, { steps: 10 });
    await page.mouse.move(containerBox.x + 100, nearBottomY);

    const snapshot = await waitForDriftSnapshot(
      page,
      'list2',
      (driftSnapshot) => {
        expect(
          driftSnapshot.scrollTop,
          `ScrollTop should exceed 1200, current: ${driftSnapshot.scrollTop}`,
        ).toBeGreaterThan(1200);
        expect(driftSnapshot.indexDrift).toBe(0);
      },
      10000,
    );
    await attachJson(testInfo, 'list2-extended-drift', snapshot);

    await page.mouse.up();
  });

  test('placeholder should stay aligned with drag preview during autoscroll down', async ({
    page,
  }, testInfo) => {
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    const nearBottomY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(containerBox.x + 100, nearBottomY, { steps: 10 });
    await page.mouse.move(containerBox.x + 100, nearBottomY);

    const snapshot = await waitForDriftSnapshot(
      page,
      'list1',
      (driftSnapshot) => {
        expect(
          driftSnapshot.scrollTop,
          `ScrollTop should exceed 500, current: ${driftSnapshot.scrollTop}`,
        ).toBeGreaterThan(500);
        expect(driftSnapshot.indexDrift).toBe(0);
      },
      10000,
    );
    await attachJson(testInfo, 'list1-down-drift', snapshot);

    await page.mouse.up();
  });

  test('placeholder drift should not accumulate during extended autoscroll', async ({
    page,
  }, testInfo) => {
    // Extended autoscroll to catch cumulative drift bugs
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    const nearBottomY = containerBox.y + containerBox.height - 25;
    await page.mouse.move(containerBox.x + 100, nearBottomY, { steps: 10 });
    await page.mouse.move(containerBox.x + 100, nearBottomY);

    const snapshot = await waitForDriftSnapshot(
      page,
      'list1',
      (driftSnapshot) => {
        expect(
          driftSnapshot.scrollTop,
          `ScrollTop should exceed 1500, current: ${driftSnapshot.scrollTop}`,
        ).toBeGreaterThan(1500);
        expect(driftSnapshot.indexDrift).toBe(0);
      },
      15000,
    );
    await attachJson(testInfo, 'extended-drift', snapshot);

    await page.mouse.up();
  });

  test('placeholder should stay aligned during autoscroll up', async ({ page }, testInfo) => {
    // List is 2500px (50 items * 50px): scroll near the bottom first
    await expect(async () => {
      await demoPage.scrollList('list1', 2000);
      expect(await demoPage.getScrollTop('list1')).toBeGreaterThan(1500);
    }).toPass({ timeout: 2000 });

    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    let sourceBox: Box | null = null;
    await expect(async () => {
      sourceBox = await demoPage.getLastVisibleItemBox('list1');
      expect(sourceBox).not.toBeNull();
    }).toPass({ timeout: 3000 });
    await demoPage.startDrag(sourceBox!);

    // Move to top edge
    const nearTopY = containerBox.y + 15;
    await page.mouse.move(containerBox.x + 100, nearTopY, { steps: 10 });
    await page.mouse.move(containerBox.x + 100, nearTopY);

    const snapshot = await waitForDriftSnapshot(
      page,
      'list1',
      (driftSnapshot) => {
        expect(
          driftSnapshot.scrollTop,
          `ScrollTop should drop below 1000, current: ${driftSnapshot.scrollTop}`,
        ).toBeLessThan(1000);
        expect(driftSnapshot.indexDrift).toBe(0);
      },
      10000,
    );
    await attachJson(testInfo, 'up-drift', snapshot);

    await page.mouse.up();
  });

  test('placeholder should be accurate at absolute maximum scroll', async ({ page }, testInfo) => {
    // Boundary condition: autoscroll to the very end of the list
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    const nearBottomY = containerBox.y + containerBox.height - 20;
    await page.mouse.move(containerBox.x + 100, nearBottomY, { steps: 10 });
    await page.mouse.move(containerBox.x + 100, nearBottomY);
    await poll(
      () =>
        demoPage.list1VirtualScroll.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      { timeout: 15000 },
    ).toBeLessThanOrEqual(2);

    // At the end, the placeholder index matches the pointer exactly and stays in bounds
    const snapshot = await waitForDriftSnapshot(
      page,
      'list1',
      (driftSnapshot) => {
        expect(driftSnapshot.indexDrift).toBe(0);
        expect(driftSnapshot.actualIndex).toBeGreaterThan(40);
        expect(driftSnapshot.actualIndex).toBeLessThanOrEqual(50);
      },
      5000,
    );
    await attachJson(testInfo, 'max-scroll-state', snapshot);

    await page.mouse.up();
  });

  test('cumulative drift should not occur during repeated up-down autoscroll cycles', async ({
    page,
  }, testInfo) => {
    test.slow();
    // User-reported scenario: drag item to bottom, then to top, repeat several times
    // Drift should not accumulate with each cycle
    const containerBox = await demoPage.list1VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    await demoPage.startDrag(demoPage.list1Items.first());

    const nearBottomY = containerBox.y + containerBox.height - 20;
    const nearTopY = containerBox.y + 20;
    const centerX = containerBox.x + containerBox.width / 2;

    const cycleData: { cycle: number; bottomScroll: number; topScroll: number }[] = [];

    // Perform 5 up-down cycles (more aggressive test)
    for (let cycle = 0; cycle < 5; cycle++) {
      // Move to bottom, wait for autoscroll to go down
      const bottomStartScrollTop = await demoPage.getScrollTop('list1');
      await page.mouse.move(centerX, nearBottomY, { steps: 5 });
      await poll(() => demoPage.getScrollTop('list1'), { timeout: 10000 }).toBeGreaterThan(
        Math.max(bottomStartScrollTop + 300, 1000),
      );
      const bottomScroll = await demoPage.getScrollTop('list1');

      // Move to top, wait for autoscroll to go up
      await page.mouse.move(centerX, nearTopY, { steps: 5 });
      await poll(() => demoPage.getScrollTop('list1'), { timeout: 10000 }).toBeLessThan(
        bottomScroll - 300,
      );

      cycleData.push({
        cycle: cycle + 1,
        bottomScroll,
        topScroll: await demoPage.getScrollTop('list1'),
      });
    }

    // Park the cursor mid-list (no autoscroll): the placeholder must match the pointer exactly
    const middleY = containerBox.y + containerBox.height / 2;
    await page.mouse.move(centerX, middleY, { steps: 5 });
    await demoPage.settleDragPosition(centerX, middleY);
    const snapshot = await waitForDriftSnapshot(
      page,
      'list1',
      (driftSnapshot) => expect(driftSnapshot.indexDrift).toBe(0),
      5000,
    );

    // The content height is intact (50 items * 50px; the dragged item still counts)
    const scrollHeight = await demoPage.list1VirtualScroll.evaluate((el) => el.scrollHeight);
    expect(scrollHeight).toBeGreaterThanOrEqual(2450);
    expect(scrollHeight).toBeLessThanOrEqual(2500);
    await expect(demoPage.list1Items.first()).toBeAttached();

    await attachJson(testInfo, 'cycle-data', { cycleData, snapshot, scrollHeight });

    await page.mouse.up();
  });

  test('placeholder should track preview position accurately with slow mouse movement', async ({
    page,
  }, testInfo) => {
    test.slow();
    // More realistic test: slowly approach edges like a real user
    const containerBox = await demoPage.list2VirtualScroll.boundingBox();
    if (!containerBox) throw new Error('Could not get the container bounding box');

    const start = await demoPage.startDrag(demoPage.list2Items.first());

    const topEdge = containerBox.y;
    const bottomEdge = containerBox.y + containerBox.height;

    // Perform 2 slow up-down cycles (matching user's reproduction)
    for (let cycle = 0; cycle < 2; cycle++) {
      // Slowly approach bottom edge (many small steps, one frame apart)
      const currentY = cycle === 0 ? start.y : topEdge + 30;
      for (let y = currentY; y < bottomEdge - 15; y += 20) {
        await page.mouse.move(start.x, y, { steps: 3 });
        await waitForFrames(page, 1);
      }

      // Stay at bottom edge for autoscroll
      const bottomStartScroll = await demoPage.getScrollTop('list2');
      await page.mouse.move(start.x, bottomEdge - 15, { steps: 3 });
      await poll(() => demoPage.getScrollTop('list2'), { timeout: 10000 }).toBeGreaterThan(
        bottomStartScroll + 500,
      );

      // Slowly approach top edge
      for (let y = bottomEdge - 15; y > topEdge + 15; y -= 20) {
        await page.mouse.move(start.x, y, { steps: 3 });
        await waitForFrames(page, 1);
      }

      // Stay at top edge for autoscroll
      const topStartScroll = await demoPage.getScrollTop('list2');
      await page.mouse.move(start.x, topEdge + 15, { steps: 3 });
      const driftSnapshot = await waitForDriftSnapshot(
        page,
        'list2',
        (snapshot) => {
          expect(snapshot.scrollTop).toBeLessThan(topStartScroll - 300);
          expect(snapshot.indexDrift).toBe(0);
        },
        10000,
      );
      await attachJson(testInfo, `cycle-${cycle + 1}-state`, driftSnapshot);
    }

    await page.mouse.up();
  });

  test.describe('WebKit-specific drift tests', () => {
    test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit only');

    test('Safari should not drift during rapid up-down autoscroll direction changes', async ({
      page,
    }, testInfo) => {
      // Catches Safari's hit-test caching: elementFromPoint results are only invalidated on
      // user scroll
      const containerBox = await demoPage.list1VirtualScroll.boundingBox();
      if (!containerBox) throw new Error('Could not get the container bounding box');

      await demoPage.startDrag(demoPage.list1Items.first());

      const nearBottomY = containerBox.y + containerBox.height - 15;
      const nearTopY = containerBox.y + 15;
      const centerX = containerBox.x + containerBox.width / 2;

      // Rapid direction changes - this is where Safari drift is most visible
      for (let i = 0; i < 3; i++) {
        const bottomStartScroll = await demoPage.getScrollTop('list1');
        await page.mouse.move(centerX, nearBottomY, { steps: 3 });
        await poll(() => demoPage.getScrollTop('list1'), { timeout: 5000 }).toBeGreaterThan(
          bottomStartScroll + 50,
        );

        const topStartScroll = await demoPage.getScrollTop('list1');
        await page.mouse.move(centerX, nearTopY, { steps: 3 });
        await poll(() => demoPage.getScrollTop('list1'), { timeout: 5000 }).toBeLessThan(
          topStartScroll - 50,
        );
      }

      const snapshot = await waitForDriftSnapshot(
        page,
        'list1',
        (driftSnapshot) => expect(driftSnapshot.indexDrift).toBe(0),
        5000,
      );
      await attachJson(testInfo, 'safari-rapid-direction-drift', snapshot);

      await page.mouse.up();
    });
  });

  test('no gap should remain after drop at maximum scroll', async ({ page }, testInfo) => {
    // Dropping an item while scrolled to the bottom must not leave a gap
    await expect(async () => {
      await demoPage.scrollList('list1', 5000);
      expect(await demoPage.getScrollTop('list1')).toBeGreaterThan(1000);
    }).toPass({ timeout: 2000 });

    // Pick a visible item near the bottom once the items rendered for the new scroll position
    let itemBox: Box | null = null;
    await expect(async () => {
      itemBox = await demoPage.getLastVisibleItemBox('list1');
      expect(itemBox).not.toBeNull();
    }).toPass({ timeout: 3000 });

    await demoPage.startDrag(itemBox!);

    // Drop the item (same-list reorder at same position = no-op, but tests scroll state)
    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();

    // No gap at the bottom: scrollTop stays at (or near) the maximum
    const metrics = await demoPage.list1VirtualScroll.evaluate((el) => ({
      scrollTop: el.scrollTop,
      maxScroll: el.scrollHeight - el.clientHeight,
    }));
    const gap = metrics.maxScroll - metrics.scrollTop;
    await attachJson(testInfo, 'drop-gap-metrics', { ...metrics, gap });

    // Gap should be less than 1 item height (50px)
    expect(gap).toBeLessThan(60);
  });
});
