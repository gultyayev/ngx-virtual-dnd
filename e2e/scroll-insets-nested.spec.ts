import { expect, Locator, Page, test } from '@playwright/test';
import { waitForAutoscroll, waitForFrames } from './fixtures/drag-sync';
import { collectPageErrors } from './fixtures/page-errors';
import { poll } from './fixtures/polling';

interface DebugState {
  activeDroppable: string | null;
  cursorPosition: { x: number; y: number } | null;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The nested-scroll fixture:
 * - a page scroller whose 80px sticky header covers its top, holding a 360px column scroller (a
 *   `vdndScrollable` list) 320px into its content;
 * - beside it, a `vdnd-sortable-list` with a 40px header overlaid on its rows.
 */
test.describe('Scroll insets (nested and overlaid)', () => {
  let pageErrors: ReturnType<typeof collectPageErrors>;
  let pageScroller: Locator;
  let column: Locator;
  let sideScroller: Locator;
  let preview: Locator;

  test.afterEach(() => {
    expect(pageErrors.unexpected(), 'Unexpected console or page errors').toEqual([]);
  });

  async function open(page: Page, options: { constrain?: boolean } = {}): Promise<void> {
    pageErrors = collectPageErrors(page);
    await page.goto(`/nested-scroll${options.constrain ? '?constrain=true' : ''}`, {
      waitUntil: 'domcontentloaded',
    });
    pageScroller = page.getByTestId('nested-page');
    column = page.getByTestId('nested-column');
    sideScroller = page.getByTestId('side-list').locator('vdnd-virtual-scroll');
    preview = page.getByTestId('vdnd-drag-preview');
    await expect(column.locator('[data-draggable-id]').first()).toBeVisible();
    await expect(sideScroller.locator('[data-draggable-id]').first()).toBeVisible();
  }

  /** Set an element's scrollTop, re-applying it until its content is tall enough. */
  async function scroll(scroller: Locator, scrollTop: number): Promise<void> {
    await expect(async () => {
      const actual = await scroller.evaluate((el, top) => {
        el.scrollTop = top;
        el.dispatchEvent(new Event('scroll'));
        return el.scrollTop;
      }, scrollTop);
      expect(actual).toBe(scrollTop);
    }).toPass({ timeout: 3000 });
  }

  /** Viewport edge of an element */
  async function edge(locator: Locator, side: 'top' | 'bottom'): Promise<number> {
    return locator.evaluate((el, s) => el.getBoundingClientRect()[s], side);
  }

  /** Rows inside `scroller` that show in full between `top` and `bottom` (rendered after a scroll) */
  async function rowsBetween(scroller: Locator, top: number, bottom: number): Promise<Box[]> {
    let rows: Box[] = [];
    await expect(async () => {
      rows = await scroller.evaluate(
        (el, range) =>
          Array.from(el.querySelectorAll<HTMLElement>('[data-draggable-id]'))
            .map((row) => ({
              id: row.dataset['draggableId'] ?? '',
              rect: row.getBoundingClientRect(),
            }))
            .filter(
              ({ rect }) =>
                rect.height > 0 && rect.top >= range.top - 1 && rect.bottom <= range.bottom + 1,
            )
            .sort((a, b) => a.rect.top - b.rect.top)
            .map(({ id, rect }) => ({
              id,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            })),
        { top, bottom },
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 3000 });
    return rows;
  }

  async function startDrag(page: Page, row: Box): Promise<void> {
    const x = row.x + row.width / 2;
    const y = row.y + row.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 2 });
    await expect(preview).toBeVisible();
  }

  async function moveTo(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x, y);
  }

  async function debugState(page: Page): Promise<DebugState> {
    return JSON.parse((await page.getByTestId('drag-state-debug').textContent()) ?? '{}');
  }

  /**
   * Scroll the page so the column's top sits 60px behind the page header, and the column down so
   * it can scroll up. Returns where the page header ends and the column's center x.
   */
  async function columnUnderPageHeader(): Promise<{ headerBottom: number; x: number }> {
    await scroll(pageScroller, 300);
    await scroll(column, 500);
    const pageTop = await edge(pageScroller, 'top');
    const box = await column.boundingBox();
    if (!box) throw new Error('No column box');
    expect(box.y).toBeCloseTo(pageTop + 20, 0);
    return { headerBottom: pageTop + 80, x: box.x + box.width / 2 };
  }

  test.describe('a list scrolling inside a page with a sticky header', () => {
    test('is not targeted over the page header that covers it', async ({ page }) => {
      await open(page);
      const { headerBottom, x } = await columnUnderPageHeader();
      const [row] = await rowsBetween(column, headerBottom, await edge(column, 'bottom'));
      await startDrag(page, row);
      await poll(async () => (await debugState(page)).activeDroppable).toBe('column');

      // Over the page header, 30px below the column's hidden top edge
      const y = headerBottom - 30;
      await moveTo(page, x, y);
      let state: DebugState | null = null;
      await expect(async () => {
        state = await debugState(page);
        expect(Math.abs((state.cursorPosition?.y ?? NaN) - y)).toBeLessThanOrEqual(1);
      }).toPass({ timeout: 3000 });
      // The first state with the cursor there, before any scroll can move the column away
      expect(state!.activeDroppable).toBeNull();

      await page.mouse.up();
      await expect(preview).toBeHidden();
    });

    test('scrolls the page, not the list, while the pointer is over the page header', async ({
      page,
    }) => {
      await open(page);
      const { headerBottom, x } = await columnUnderPageHeader();
      const [row] = await rowsBetween(column, headerBottom, await edge(column, 'bottom'));
      await startDrag(page, row);

      // 30px below the column's hidden top edge: in its top zone, but over the page header. The
      // pointer crosses the column's visible top zone on the way, which may scroll it a little.
      await moveTo(page, x, headerBottom - 30);
      await waitForFrames(page, 2);
      const columnScrollTop = await column.evaluate((el) => el.scrollTop);
      const pageScrollTop = await pageScroller.evaluate((el) => el.scrollTop);
      await waitForAutoscroll(pageScroller, 'up', pageScrollTop - 60);
      expect(await column.evaluate((el) => el.scrollTop)).toBe(columnScrollTop);

      await page.mouse.up();
      await expect(preview).toBeHidden();
    });

    test('keeps a constrained preview below the page header', async ({ page }) => {
      await open(page, { constrain: true });
      const { headerBottom, x } = await columnUnderPageHeader();
      const [row] = await rowsBetween(column, headerBottom, await edge(column, 'bottom'));
      await startDrag(page, row);

      await moveTo(page, x, (await edge(pageScroller, 'top')) + 5);
      await poll(async () => (await preview.boundingBox())!.y - headerBottom).toBeCloseTo(1, 0);

      await page.mouse.up();
      await expect(preview).toBeHidden();
    });
  });

  test.describe('a vdnd-sortable-list with a header overlaid on its rows', () => {
    test('keeps a constrained preview below the overlaid header', async ({ page }) => {
      await open(page, { constrain: true });
      await scroll(sideScroller, 500);
      const overlayBottom = await edge(page.getByTestId('side-overlay'), 'bottom');
      const rows = await rowsBetween(
        sideScroller,
        overlayBottom,
        await edge(sideScroller, 'bottom'),
      );
      await startDrag(page, rows[2]);

      await moveTo(page, rows[2].x + rows[2].width / 2, (await edge(sideScroller, 'top')) + 5);
      await poll(async () => (await preview.boundingBox())!.y - overlayBottom).toBeCloseTo(1, 0);

      await page.mouse.up();
      await expect(preview).toBeHidden();
    });

    test('autoscrolls up from just below the overlaid header', async ({ page }) => {
      await open(page);
      await scroll(sideScroller, 1000);
      const overlayBottom = await edge(page.getByTestId('side-overlay'), 'bottom');
      const rows = await rowsBetween(
        sideScroller,
        overlayBottom,
        await edge(sideScroller, 'bottom'),
      );
      await startDrag(page, rows[rows.length - 1]);

      // 25px below the overlay: further from the list's top edge than the 50px threshold
      await moveTo(page, rows[0].x + rows[0].width / 2, overlayBottom + 25);
      await waitForAutoscroll(sideScroller, 'up', 700);

      await page.mouse.up();
      await expect(preview).toBeHidden();
    });

    test('keeps the keyboard placeholder below the overlaid header', async ({ page }) => {
      await open(page);
      await scroll(sideScroller, 1000);
      const overlayBottom = await edge(page.getByTestId('side-overlay'), 'bottom');
      const [first] = await rowsBetween(
        sideScroller,
        overlayBottom,
        await edge(sideScroller, 'bottom'),
      );
      await page.locator(`[data-draggable-id="${first.id}"]`).focus();
      await page.keyboard.press('Space');
      await expect(preview).toBeVisible();

      const placeholder = page.locator('.vdnd-drag-placeholder-visible');
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowUp');
      }
      await waitForFrames(page, 2);
      await poll(
        async () => (await placeholder.boundingBox())?.y ?? Number.NaN,
      ).toBeGreaterThanOrEqual(overlayBottom - 1);

      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
    });
  });
});
