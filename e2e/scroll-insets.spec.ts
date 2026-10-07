import { expect, Page, test } from '@playwright/test';
import { settleDragPosition, waitForAutoscroll, waitForFrames } from './fixtures/drag-sync';
import { collectPageErrors } from './fixtures/page-errors';
import { poll } from './fixtures/polling';
import { ElementBox, TaskDemoPage, taskDemoSelectors } from './fixtures/task-demo.page';

/** The scroll container's edges and the edges of the content pinned over it (viewport px). */
interface StickyLayout {
  containerTop: number;
  containerBottom: number;
  /** Bottom edge of the sticky header */
  headerBottom: number;
  /** Top edge of the sticky "Add task" button */
  footerTop: number;
  centerX: number;
}

interface DebugState {
  activeDroppable: string | null;
  placeholderIndex: number | null;
}

/**
 * The page-scroll demo with its header and "Add task" button pinned inside the scroll container
 * (`?sticky=true`), which passes their heights to `vdndScrollable` as scroll insets.
 */
test.describe('Scroll insets (sticky header and footer)', () => {
  let taskDemo: TaskDemoPage;
  let pageErrors: ReturnType<typeof collectPageErrors>;

  test.afterEach(() => {
    expect(pageErrors.unexpected(), 'Unexpected console or page errors').toEqual([]);
  });

  async function open(page: Page, options: { constrain?: boolean } = {}): Promise<void> {
    taskDemo = new TaskDemoPage(page);
    pageErrors = collectPageErrors(page);
    await taskDemo.goto('/page-scroll', { sticky: true, ...options });
    // The header and footer are measured after the first render (with the content offset)
    await expect(taskDemo.virtualContent).toHaveAttribute('data-content-offset', /^[1-9]/);
  }

  async function stickyLayout(page: Page): Promise<StickyLayout> {
    return page.evaluate((selectors) => {
      const container = document.querySelector(selectors.scrollContainer)!.getBoundingClientRect();
      const header = document.querySelector(selectors.header)!.getBoundingClientRect();
      const footer = document.querySelector(selectors.footer)!.getBoundingClientRect();
      return {
        containerTop: container.top,
        containerBottom: container.bottom,
        headerBottom: header.bottom,
        footerTop: footer.top,
        centerX: container.left + container.width / 2,
      };
    }, taskDemoSelectors);
  }

  /** Scroll the container to `scrollTop`, re-applying it until the content is tall enough. */
  async function scrollTo(scrollTop: number): Promise<void> {
    await expect(async () => {
      await taskDemo.scrollTo(scrollTop);
      expect(await taskDemo.getScrollTop()).toBe(scrollTop);
    }).toPass({ timeout: 3000 });
  }

  /** The rows fully in the uncovered part of the container, between the header and footer. */
  async function uncoveredRows(page: Page): Promise<(ElementBox & { id: string })[]> {
    return page.evaluate((selectors) => {
      const header = document.querySelector(selectors.header)!.getBoundingClientRect();
      const footer = document.querySelector(selectors.footer)!.getBoundingClientRect();
      return Array.from(document.querySelectorAll<HTMLElement>(selectors.item))
        .map((el) => ({
          id: el.getAttribute('data-draggable-id') ?? '',
          rect: el.getBoundingClientRect(),
        }))
        .filter(
          ({ rect }) =>
            rect.height > 0 && rect.top >= header.bottom - 1 && rect.bottom <= footer.top + 1,
        )
        .sort((a, b) => a.rect.top - b.rect.top)
        .map(({ id, rect }) => ({
          id,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }));
    }, taskDemoSelectors);
  }

  /** The uncovered rows once the list has rendered at its scroll position (at least three). */
  async function waitForUncoveredRows(page: Page): Promise<(ElementBox & { id: string })[]> {
    let rows: (ElementBox & { id: string })[] = [];
    await expect(async () => {
      rows = await uncoveredRows(page);
      expect(rows.length).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 3000 });
    return rows;
  }

  /** Press on `row` and move past the drag threshold; resolves once the preview shows. */
  async function startDrag(page: Page, row: ElementBox): Promise<void> {
    const x = row.x + row.width / 2;
    const y = row.y + row.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 2 });
    await expect(taskDemo.dragPreview).toBeVisible();
  }

  /** Move the pointer to (x, y) in steps, then directly (E2E.md rule 6). */
  async function moveTo(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x, y);
  }

  async function previewEdges(page: Page): Promise<{ top: number; bottom: number }> {
    return page.evaluate((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }, taskDemoSelectors.dragPreview);
  }

  async function debugState(page: Page): Promise<DebugState> {
    return JSON.parse((await page.getByTestId('drag-state-debug').textContent()) ?? '{}');
  }

  test.describe('with constrainToContainer', () => {
    test.beforeEach(async ({ page }) => {
      await open(page, { constrain: true });
    });

    test('keeps the preview below the sticky header', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      // Pointer over the header: the preview stops 1px below it, not over it
      await moveTo(page, layout.centerX, layout.containerTop + 5);
      await poll(async () => (await previewEdges(page)).top - layout.headerBottom).toBeCloseTo(
        1,
        0,
      );

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('keeps the preview above the sticky footer', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      // Pointer over the footer: the preview stops 1px above it, not over it
      await moveTo(page, layout.centerX, layout.containerBottom - 5);
      await poll(async () => layout.footerTop - (await previewEdges(page)).bottom).toBeCloseTo(
        1,
        0,
      );

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('autoscrolls up while the preview is pinned below the sticky header', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      await moveTo(page, layout.centerX, layout.headerBottom + 25);
      await waitForAutoscroll(taskDemo.scrollContainer, 'up', 1000);

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('autoscrolls down while the preview is pinned above the sticky footer', async ({
      page,
    }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      await moveTo(page, layout.centerX, layout.footerTop - 25);
      await waitForAutoscroll(taskDemo.scrollContainer, 'down', 2000);

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('keeps constraining a drag whose first move lands on the sticky header', async ({
      page,
    }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const [topRow] = await waitForUncoveredRows(page);
      const x = topRow.x + topRow.width / 2;
      await page.mouse.move(x, topRow.y + topRow.height / 2);
      await page.mouse.down();
      // A fast pull up: the move that starts the drag is already over the header
      await page.mouse.move(x, (layout.containerTop + layout.headerBottom) / 2);
      await expect(taskDemo.dragPreview).toBeVisible();

      await moveTo(page, x, layout.containerTop + 5);
      await poll(async () => (await previewEdges(page)).top - layout.headerBottom).toBeCloseTo(
        1,
        0,
      );

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('keeps the preview below the sticky header when the header grows mid-drag', async ({
      page,
    }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);
      await moveTo(page, layout.centerX, layout.headerBottom + 5);
      await poll(async () => (await previewEdges(page)).top - layout.headerBottom).toBeCloseTo(
        1,
        0,
      );

      // The header grows 60px while the pointer rests
      await taskDemo.header.evaluate((header) => {
        header.style.minHeight = `${header.getBoundingClientRect().height + 60}px`;
      });

      await poll(
        async () => (await previewEdges(page)).top - (await stickyLayout(page)).headerBottom,
      ).toBeCloseTo(1, 0);
      expect((await stickyLayout(page)).headerBottom).toBeCloseTo(layout.headerBottom + 60, 0);

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('drops at the start of the list under the sticky header', async ({ page }) => {
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      const dragged = rows[2];
      await startDrag(page, dragged);

      await moveTo(page, layout.centerX, layout.containerTop + 5);
      await expect(async () => {
        const state = await debugState(page);
        expect(state.activeDroppable).toBe('tasks');
        expect(state.placeholderIndex).toBe(0);
      }).toPass({ timeout: 3000 });

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
      await expect(async () => {
        expect((await uncoveredRows(page))[0]?.id).toBe(dragged.id);
      }).toPass({ timeout: 3000 });
    });

    test('drops at the end of the list above the sticky footer', async ({ page }) => {
      test.slow();
      await expect(async () => {
        await taskDemo.scrollContainer.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const atEnd = await taskDemo.scrollContainer.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 1,
        );
        expect(atEnd).toBe(true);
      }).toPass({ timeout: 3000 });
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      const dragged = rows[rows.length - 3];
      await startDrag(page, dragged);

      const total = Number(await page.getByTestId('task-count').getAttribute('data-total'));
      await moveTo(page, layout.centerX, layout.containerBottom - 5);
      await waitForAutoscroll(taskDemo.scrollContainer, 'down', 'end');
      await expect(async () => {
        const state = await debugState(page);
        expect(state.activeDroppable).toBe('tasks');
        expect(state.placeholderIndex).toBe(total);
      }).toPass({ timeout: 3000 });

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
      await expect(async () => {
        expect((await uncoveredRows(page)).at(-1)?.id).toBe(dragged.id);
      }).toPass({ timeout: 3000 });
    });
  });

  test.describe('keyboard drag', () => {
    test.beforeEach(async ({ page }) => {
      await open(page);
    });

    test('keeps the placeholder between the sticky header and footer', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await page.locator(`[data-draggable-id="${rows[0].id}"]`).focus();
      await page.keyboard.press('Space');
      await expect(taskDemo.dragPreview).toBeVisible();

      const placeholderEdges = async (): Promise<{ top: number; bottom: number }> => {
        const box = await taskDemo.visiblePlaceholder.boundingBox();
        return box ? { top: box.y, bottom: box.y + box.height } : { top: NaN, bottom: NaN };
      };

      // At an edge, within rounding: the header height the demo measures can be fractional
      const expectNear = async (actual: () => Promise<number>, expected: number): Promise<void> => {
        await expect(async () => {
          expect(Math.abs((await actual()) - expected)).toBeLessThanOrEqual(2);
        }).toPass({ timeout: 3000 });
      };

      // Up past the header: the list scrolls the placeholder down to the header's lower edge
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowUp');
      }
      await expectNear(async () => (await placeholderEdges()).top, layout.headerBottom);

      // Down past the footer: the list scrolls the placeholder up to the footer's upper edge
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('ArrowDown');
      }
      await expectNear(async () => (await placeholderEdges()).bottom, layout.footerTop);

      await page.keyboard.press('Escape');
      await expect(taskDemo.dragPreview).toBeHidden();
    });
  });

  test.describe('without constrainToContainer', () => {
    test.beforeEach(async ({ page }) => {
      await open(page);
    });

    test('autoscrolls up while the pointer is over the sticky header', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      // Halfway down the header, further from the container's top edge than the 50px threshold
      await moveTo(page, layout.centerX, (layout.containerTop + layout.headerBottom) / 2);
      await waitForAutoscroll(taskDemo.scrollContainer, 'up', 1000);

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('autoscrolls down from just above the sticky footer', async ({ page }) => {
      await scrollTo(1500);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);

      // 25px above the footer: further from the container's bottom edge than the 50px threshold
      await moveTo(page, layout.centerX, layout.footerTop - 25);
      await waitForAutoscroll(taskDemo.scrollContainer, 'down', 2000);

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });

    test('does not target the rows under the sticky header', async ({ page }) => {
      await scrollTo(3000);
      const layout = await stickyLayout(page);
      const rows = await waitForUncoveredRows(page);
      await startDrag(page, rows[Math.floor(rows.length / 2)]);
      await poll(async () => (await debugState(page)).activeDroppable).toBe('tasks');

      // Rows scroll under the header, but the pointer over it is not over the list
      const headerY = layout.headerBottom - 10;
      await settleDragPosition(page, layout.centerX, headerY);
      await waitForFrames(page, 10);
      expect((await debugState(page)).activeDroppable).toBeNull();

      // Back in the uncovered part, the list is the target again
      await settleDragPosition(page, layout.centerX, layout.headerBottom + 100);
      await poll(async () => (await debugState(page)).activeDroppable).toBe('tasks');

      await page.mouse.up();
      await expect(taskDemo.dragPreview).toBeHidden();
    });
  });
});
