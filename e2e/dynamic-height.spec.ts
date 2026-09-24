import { expect, test } from '@playwright/test';
import { waitForFrames } from './fixtures/drag-sync';
import { collectPageErrors } from './fixtures/page-errors';
import { poll } from './fixtures/polling';
import { TaskDemoPage, taskDemoSelectors } from './fixtures/task-demo.page';

test.describe('Dynamic Height Demo', () => {
  let taskDemo: TaskDemoPage;
  let pageErrors: ReturnType<typeof collectPageErrors>;

  test.beforeEach(async ({ page }) => {
    taskDemo = new TaskDemoPage(page);
    pageErrors = collectPageErrors(page);
    await taskDemo.goto('/dynamic-height');
  });

  test.afterEach(() => {
    expect(pageErrors.unexpected(), 'Unexpected console or page errors').toEqual([]);
  });

  test('should display items with varying heights', async ({ page }) => {
    const heights = await page.evaluate((selectors) => {
      const items = document.querySelectorAll(selectors.item);
      const result: number[] = [];
      for (let i = 0; i < Math.min(5, items.length); i++) {
        result.push(items[i].getBoundingClientRect().height);
      }
      return result;
    }, taskDemoSelectors);

    expect(heights.length).toBe(5);
    const uniqueHeights = new Set(heights);
    expect(uniqueHeights.size).toBeGreaterThan(1);
  });

  test('should re-render the list when its items are filtered', async () => {
    await taskDemo.categoryFilter('work').click();

    // Wait for filter to apply by checking that only work badges are shown
    await expect(async () => {
      const categories = await taskDemo.getTaskCategoryTexts();
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.every((text) => text === 'work')).toBe(true);
    }).toPass({ timeout: 2000 });
  });

  test('should scroll and render items correctly', async () => {
    const initialFirstItem = await taskDemo.getTaskTitle(0);

    const headerHeight = await taskDemo.getHeaderHeight();

    const scrollAmount = headerHeight + 500;

    // Scroll down — wrap write+read+assertion in toPass (virtual scroll needs a frame to re-render)
    await expect(async () => {
      await taskDemo.scrollTo(scrollAmount);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBeGreaterThan(0);
      const afterScrollFirstItem = await taskDemo.getTaskTitle(0);
      expect(afterScrollFirstItem).not.toBe(initialFirstItem);
    }).toPass({ timeout: 3000 });

    // Scroll back to top — include item check in toPass (virtual scroll needs a frame to re-render)
    await expect(async () => {
      await taskDemo.scrollTo(0);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBe(0);
      const restoredFirstItem = await taskDemo.getTaskTitle(0);
      expect(restoredFirstItem).toBe(initialFirstItem);
    }).toPass({ timeout: 3000 });
  });

  test('should reorder tasks via drag-drop', async ({ page }) => {
    const secondItemText = await taskDemo.getTaskTitle(1);

    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    // Get the second item's actual position (no fixed-height math)
    const targetItem = taskDemo.items.nth(1);
    const targetBox = await targetItem.boundingBox();
    if (!targetBox) throw new Error('Could not get target bounding box');

    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Move to center of second item
    const targetX = sourceBox.x + sourceBox.width / 2;
    const targetY = targetBox.y + targetBox.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 10 });

    // The test asserts exact post-drop order, so the placeholder index must be computed from
    // the exact release coordinates before releasing (a rAF wait alone is racy under load).
    await taskDemo.settleDragPosition(targetX, targetY);
    await page.mouse.up();

    // Wait for drop to complete by verifying DOM update
    await expect(async () => {
      const newFirstItemText = await taskDemo.getTaskTitle(0);
      expect(newFirstItemText).toBe(secondItemText);
    }).toPass({ timeout: 2000 });
  });

  test('should show drag preview while dragging', async ({ page }) => {
    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    await page.mouse.move(sourceBox.x + 100, sourceBox.y + 100, { steps: 10 });

    // Verify drag preview is still visible after moving
    await expect(dragPreview).toBeVisible();
    await page.mouse.up();
  });

  test('should show placeholder during drag', async ({ page }) => {
    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    const targetItem = taskDemo.items.nth(1);
    const targetBox = await targetItem.boundingBox();
    if (!targetBox) throw new Error('Could not get target bounding box');

    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    const targetY = targetBox.y + targetBox.height / 2;
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, targetY, { steps: 10 });

    // Wait one rAF for position update, then check placeholder
    await waitForFrames(page, 1);

    const placeholder = taskDemo.visiblePlaceholder;
    await expect(placeholder).toBeVisible({ timeout: 2000 });

    await page.mouse.up();
  });

  test('should not show gray gaps during rapid scroll', async () => {
    // Scroll down
    await expect(async () => {
      await taskDemo.scrollTo(2000);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBeGreaterThan(0);
    }).toPass({ timeout: 2000 });

    // Rapidly scroll up
    await taskDemo.scrollContainer.evaluate((el) => {
      el.scrollTop -= 500;
    });

    // Wait for virtual scroll to cover the visible list area at the new position.
    await expect(async () => {
      const coverage = await taskDemo.getVisibleListCoverage();
      expect(coverage.visibleHeight).toBeGreaterThan(100);
      expect(coverage.renderedItemCount).toBeGreaterThan(0);
      expect(coverage.maxGap, JSON.stringify(coverage)).toBeLessThanOrEqual(4);
    }).toPass({ timeout: 2000 });
  });

  test('should keep drag preview visible during autoscroll', async ({ page }) => {
    const scrollContainer = taskDemo.scrollContainer;
    const scrollBox = await scrollContainer.boundingBox();
    if (!scrollBox) throw new Error('Could not get scroll container bounding box');

    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    const edgeOffset = 25; // Consistent 25px offset
    const bottomEdgeY = scrollBox.y + scrollBox.height - edgeOffset;
    const targetX = sourceBox.x + sourceBox.width / 2;
    await page.mouse.move(targetX, bottomEdgeY, { steps: 15 });
    // Extra move for stability
    await page.mouse.move(targetX, bottomEdgeY);

    await expect(async () => {
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop, `ScrollTop should reach 200, current: ${scrollTop}`).toBeGreaterThan(200);
    }).toPass({ timeout: 10000 });

    await expect(dragPreview).toBeVisible();
    await page.mouse.up();
  });

  test('should correctly reorder after scrolling and maintain virtual scroll', async ({ page }) => {
    // Scroll down so visible items are past the first few
    const scrollAmount = 800;
    await expect(async () => {
      await taskDemo.scrollTo(scrollAmount);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBeGreaterThan(0);
    }).toPass({ timeout: 2000 });

    // Get fully visible items in the viewport (not overscan or clipped edge items)
    const visibleItems = await taskDemo.getFullyVisibleTasks();

    expect(visibleItems.length).toBeGreaterThanOrEqual(3);
    const sourceId = visibleItems[0].id;
    const targetId = visibleItems[2].id;
    expect(sourceId).not.toBe(targetId);

    // Drag first visible item to third visible item
    const sourceItem = page.locator(`[data-draggable-id="${sourceId}"]`);
    const targetItem = page.locator(`[data-draggable-id="${targetId}"]`);
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;

    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Get FRESH target coordinates after drag starts (source item is now hidden,
    // items have shifted). Per E2E.md: "After drag starts, get fresh boundingBox()
    // of target items — positions shift when the dragged item hides."
    const freshTargetBox = await targetItem.boundingBox();
    if (!freshTargetBox) throw new Error('Could not get fresh target bounding box');
    const targetY = freshTargetBox.y + freshTargetBox.height / 2;

    // Move to center of third visible item
    await page.mouse.move(sourceX, targetY, { steps: 10 });
    // Ensure the drop uses the exact release coordinates (re-issues the final move, replacing
    // the E2E.md rule #6 direct move, and outwaits the rAF-vs-input race under load).
    await taskDemo.settleDragPosition(sourceX, targetY);
    await page.mouse.up();

    // Wait for drop to complete — verify source item moved
    await expect(async () => {
      const afterItems = await taskDemo.getVisibleTasks();

      // The source item should have moved — it should no longer be the first visible
      const afterIds = afterItems.map((i) => i.id);
      expect(afterIds[0]).not.toBe(sourceId);
    }).toPass({ timeout: 2000 });

    // Virtual scroll integrity: scroll to top and verify items render
    await expect(async () => {
      await taskDemo.scrollTo(0);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBe(0);
    }).toPass({ timeout: 2000 });

    const topItems = await taskDemo.items.count();
    expect(topItems).toBeGreaterThan(0);

    const topTitle = await taskDemo.getTaskTitle(0);
    expect(topTitle).toBeTruthy();
  });

  test('should correctly reorder via autoscroll drag', async ({ page }) => {
    const firstItemText = await taskDemo.getTaskTitle(0);

    const scrollContainer = taskDemo.scrollContainer;
    const scrollBox = await scrollContainer.boundingBox();
    if (!scrollBox) throw new Error('Could not get scroll container bounding box');

    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    // Pick up the first item
    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Move to bottom edge to trigger autoscroll
    const edgeOffset = 25; // Consistent 25px offset
    const bottomEdgeY = scrollBox.y + scrollBox.height - edgeOffset;
    const targetX = sourceBox.x + sourceBox.width / 2;
    await page.mouse.move(targetX, bottomEdgeY, { steps: 15 });
    // Extra move for stability
    await page.mouse.move(targetX, bottomEdgeY);

    // Wait for autoscroll to engage
    await expect(async () => {
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop, `ScrollTop should reach 300, current: ${scrollTop}`).toBeGreaterThan(300);
    }).toPass({ timeout: 10000 });

    // Wait one rAF before drop
    await waitForFrames(page, 1);
    await page.mouse.up();

    // Scroll back to top to verify reorder happened — include item check in toPass
    await expect(async () => {
      await taskDemo.scrollTo(0);
      const scrollTop = await taskDemo.getScrollTop();
      expect(scrollTop).toBe(0);
      // The first item should have moved — it should no longer be at index 0
      const newFirstItemText = await taskDemo.getTaskTitle(0);
      expect(newFirstItemText).not.toBe(firstItemText);
    }).toPass({ timeout: 3000 });

    // Virtual scroll integrity: items should still render
    const itemCount = await taskDemo.items.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('should not shrink container height during same-list drag', async ({ page }) => {
    const scrollContainer = taskDemo.scrollContainer;

    // Scroll to bottom so the footer is visible and shift would be noticeable
    await expect(async () => {
      await scrollContainer.evaluate((el) => (el.scrollTop = el.scrollHeight));
      const { scrollTop, scrollHeight, clientHeight } = await scrollContainer.evaluate((el) => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(scrollTop).toBeGreaterThan(0);
      expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - 2);
    }).toPass({ timeout: 3000 });

    // Measure the virtual-content host height and footer position before drag
    const beforeDrag = await page.evaluate((selectors) => {
      const virtualContent = document.querySelector(selectors.virtualContent) as HTMLElement | null;
      const footer = document.querySelector(selectors.footer) as HTMLElement | null;
      return {
        contentHeight: virtualContent?.offsetHeight ?? 0,
        footerTop: footer?.getBoundingClientRect().top ?? 0,
      };
    }, taskDemoSelectors);
    expect(beforeDrag.contentHeight).toBeGreaterThan(0);

    await expect(async () => {
      // Capture a viewport-visible draggable/task item box atomically inside the browser.
      const sourceBox = await taskDemo.getVisibleItemBoxAt(0.65);
      expect(sourceBox).not.toBeNull();
    }).toPass({ timeout: 3000 });

    const sourceBox = await taskDemo.getVisibleItemBoxAt(0.65);
    if (!sourceBox) throw new Error('Could not get source bounding box');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 5, sourceBox.y + 5, { steps: 3 });
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 5, sourceBox.y + 5);

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Wait one rAF for position update
    await waitForFrames(page, 1);
    const allowedShrinkPx = 8;
    await expect(async () => {
      // Measure during drag — atomic measurement
      const duringDrag = await page.evaluate((selectors) => {
        const virtualContent = document.querySelector(
          selectors.virtualContent,
        ) as HTMLElement | null;
        const footer = document.querySelector(selectors.footer) as HTMLElement | null;
        return {
          contentHeight: virtualContent?.offsetHeight ?? 0,
          footerTop: footer?.getBoundingClientRect().top ?? 0,
        };
      }, taskDemoSelectors);

      // Allow minor cross-browser rounding differences while still catching real shrink regressions.
      expect(duringDrag.contentHeight).toBeGreaterThanOrEqual(
        beforeDrag.contentHeight - allowedShrinkPx,
      );

      // The footer should NOT shift up during drag (positive shift = moved up = bad).
      const footerShift = beforeDrag.footerTop - duringDrag.footerTop;
      expect(footerShift).toBeLessThan(10);
    }).toPass({ timeout: 2000 });

    // Clean up
    await page.mouse.up();
  });

  test('should clamp to scroll container when cursor escapes above with constrainToContainer', async ({
    page,
  }) => {
    // Enable constrain-to-container on the droppable element
    await page.evaluate(() => {
      const droppable = document.querySelector('[data-droppable-id="tasks"]');
      if (droppable) {
        droppable.setAttribute('data-constrain-to-container', '');
      }
    });

    // Get the scroll container's bounding box (the constraint boundary)
    const scrollContainerBox = await taskDemo.scrollContainer.boundingBox();
    if (!scrollContainerBox) throw new Error('Could not get scroll container bounding box');

    // Pick a visible item using atomic source selection (avoids overscan issues)
    await expect(async () => {
      const sourceBox = await taskDemo.getVisibleItemBoxAt(0.35);
      expect(sourceBox).not.toBeNull();
    }).toPass({ timeout: 3000 });

    const sourceBox = await taskDemo.getVisibleItemBoxAt(0.35);
    if (!sourceBox) throw new Error('Could not get source bounding box');

    // Start drag
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Move cursor far above the scroll container (into the header area). Stay inside the
    // viewport: Firefox drops a mouse.move to a point outside it, steps included.
    const aboveContainerY = Math.max(scrollContainerBox.y - 100, 2);
    const targetX = sourceBox.x + sourceBox.width / 2;
    await page.mouse.move(targetX, aboveContainerY, { steps: 10 });
    await page.mouse.move(targetX, aboveContainerY);

    // The preview is pinned 1px inside the scroll container's top edge (it started lower down,
    // so "still inside" alone would pass even if it never moved)
    await poll(async () => {
      const previewBox = await dragPreview.boundingBox();
      return (previewBox?.y ?? Number.NaN) - scrollContainerBox.y;
    }).toBeCloseTo(1, 0);

    // Move back inside and drop — should succeed (droppable remained active because cursor was clamped)
    await page.mouse.move(targetX, scrollContainerBox.y + scrollContainerBox.height / 2, {
      steps: 5,
    });
    await waitForFrames(page, 1);
    await page.mouse.up();
    await expect(dragPreview).not.toBeVisible({ timeout: 2000 });

    // Verify items still render (no broken state)
    const itemCount = await taskDemo.items.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('should reorder correctly with constrainToContainer enabled', async ({ page }) => {
    // Enable constrain-to-container on the droppable element
    await page.evaluate(() => {
      const droppable = document.querySelector('[data-droppable-id="tasks"]');
      if (droppable) {
        droppable.setAttribute('data-constrain-to-container', '');
      }
    });

    // Capture item texts before drag
    const firstItemText = await taskDemo.getTaskTitle(0);
    const secondItemText = await taskDemo.getTaskTitle(1);

    // Get source (item 0) and target (item 1) positions
    const sourceItem = taskDemo.items.first();
    const sourceBox = await sourceItem.boundingBox();
    if (!sourceBox) throw new Error('Could not get source bounding box');

    const targetItem = taskDemo.items.nth(1);
    const targetBox = await targetItem.boundingBox();
    if (!targetBox) throw new Error('Could not get target bounding box');

    // Start drag
    await sourceItem.hover();
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 5, sourceBox.y + 5, { steps: 2 });

    const dragPreview = taskDemo.dragPreview;
    await expect(dragPreview).toBeVisible({ timeout: 2000 });

    // Move to center of second item — with the bug (top-edge probe + no midpoint
    // refinement), the placeholder index would lag behind the preview position.
    const targetX = sourceBox.x + sourceBox.width / 2;
    const targetY = targetBox.y + targetBox.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 10 });

    // The test asserts exact post-drop order — settle the processed position before releasing.
    // The release point is inside the constraint bounds, so the effective cursor matches.
    await taskDemo.settleDragPosition(targetX, targetY);
    await page.mouse.up();

    // Wait for drop to complete — verify reorder happened
    await expect(async () => {
      const newFirstItemText = await taskDemo.getTaskTitle(0);
      expect(newFirstItemText).toBe(secondItemText);
    }).toPass({ timeout: 2000 });

    // Original first item should now be at index 1
    const newSecondItemText = await taskDemo.getTaskTitle(1);
    expect(newSecondItemText).toBe(firstItemText);
  });

  test('should not emit ResizeObserver errors', async ({ page }) => {
    // Errors are collected from before navigation (beforeEach), so the initial render counts
    // Scroll multiple times to trigger potential ResizeObserver issues
    for (let i = 0; i < 5; i++) {
      await taskDemo.scrollTo(i * 500);
      await waitForFrames(page, 1);
    }

    expect(pageErrors.unexpected().filter((text) => text.includes('ResizeObserver'))).toEqual([]);
  });
});
