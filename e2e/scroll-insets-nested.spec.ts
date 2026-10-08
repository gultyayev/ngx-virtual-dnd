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
 *   `vdndScrollable` list) 320px into its content and, 16px below it, a 360px `vdnd-sortable-list`;
 * - beside it, a `vdnd-sortable-list` with a 40px header overlaid on its rows;
 * - below them, 20 plain `@for` rows of 50px in a 300px scroller with a 40px sticky header.
 */
test.describe('Scroll insets (nested and overlaid)', () => {
  let pageErrors: ReturnType<typeof collectPageErrors>;
  let pageScroller: Locator;
  let column: Locator;
  let innerScroller: Locator;
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
    innerScroller = page.getByTestId('nested-inner-list').locator('vdnd-virtual-scroll');
    sideScroller = page.getByTestId('side-list').locator('vdnd-virtual-scroll');
    preview = page.getByTestId('vdnd-drag-preview');
    await expect(column.locator('[data-draggable-id]').first()).toBeVisible();
    await expect(sideScroller.locator('[data-draggable-id]').first()).toBeVisible();
  }

  /**
   * Set an element's scrollTop, re-applying it until its content is tall enough, and wait for the
   * rows it scrolls to render (a virtual list renders them on the next animation frame).
   */
  async function scroll(scroller: Locator, scrollTop: number): Promise<void> {
    await expect(async () => {
      const actual = await scroller.evaluate((el, top) => {
        el.scrollTop = top;
        el.dispatchEvent(new Event('scroll'));
        return el.scrollTop;
      }, scrollTop);
      expect(actual).toBe(scrollTop);
    }).toPass({ timeout: 3000 });
    await waitForFrames(scroller.page(), 2);
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

  test.describe('a vdnd-sortable-list scrolling inside a page with a sticky header', () => {
    test('keeps the keyboard placeholder below the page header', async ({ page }) => {
      await open(page);
      await scroll(innerScroller, 1000);
      // The list's top 60px behind the page header
      const pageTop = await edge(pageScroller, 'top');
      const listTop = await edge(innerScroller, 'top');
      await scroll(pageScroller, Math.round(listTop - pageTop - 20));
      expect(await edge(innerScroller, 'top')).toBeCloseTo(pageTop + 20, 0);
      const headerBottom = pageTop + 80;
      const [first] = await rowsBetween(
        innerScroller,
        headerBottom,
        await edge(innerScroller, 'bottom'),
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
      ).toBeGreaterThanOrEqual(headerBottom - 1);

      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
    });
  });

  test.describe('a list of plain rows under a sticky header', () => {
    let plainScroller: Locator;

    test.beforeEach(async ({ page }) => {
      await open(page);
      plainScroller = page.getByTestId('plain-scroller');
      await plainScroller.scrollIntoViewIfNeeded();
    });

    /** Viewport top of a row */
    async function rowTop(page: Page, id: string): Promise<number> {
      return edge(page.locator(`[data-draggable-id="${id}"]`), 'top');
    }

    test('scrolls to follow a keyboard drag past its bottom edge', async ({ page }) => {
      await page.locator('[data-draggable-id="plain-1"]').focus();
      await page.keyboard.press('Space');
      await expect(preview).toBeVisible();
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('ArrowDown');
      }

      // Target 10: the slot where Plain row 12 starts (Plain row 1 is the one held), 50px tall
      const bottom = await edge(plainScroller, 'bottom');
      await poll(async () => (await rowTop(page, 'plain-12')) + 50).toBeLessThanOrEqual(bottom + 2);
      expect(await plainScroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

      await page.keyboard.press('Space');
      await expect(preview).toBeHidden();
      await poll(() =>
        plainScroller.evaluate(
          (el) =>
            el.querySelectorAll<HTMLElement>('[data-draggable-id]')[10]?.dataset['draggableId'],
        ),
      ).toBe('plain-1');
    });

    test('keeps the keyboard slot below the sticky header', async ({ page }) => {
      await scroll(plainScroller, 600);
      const headerBottom = await edge(page.getByTestId('plain-header'), 'bottom');
      const [first] = await rowsBetween(
        plainScroller,
        headerBottom,
        await edge(plainScroller, 'bottom'),
      );
      const firstIndex = Number(first.id.replace('plain-', '')) - 1;
      await page.locator(`[data-draggable-id="${first.id}"]`).focus();
      await page.keyboard.press('Space');
      await expect(preview).toBeVisible();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowUp');
      }

      // The slot starts where the row 4 above the held one does
      await poll(() => rowTop(page, `plain-${firstIndex + 1 - 4}`)).toBeGreaterThanOrEqual(
        headerBottom - 2,
      );

      await page.keyboard.press('Escape');
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

    test('shows its first and last rows clear of the overlaid header and footer', async ({
      page,
    }) => {
      await open(page);
      const overlayBottom = await edge(page.getByTestId('side-overlay'), 'bottom');
      const footerTop = await edge(page.getByTestId('side-overlay-footer'), 'top');
      const first = page.locator('[data-draggable-id="side-1"]');
      expect(await edge(first, 'top')).toBeGreaterThanOrEqual(overlayBottom - 1);

      await scroll(
        sideScroller,
        await sideScroller.evaluate((el) => el.scrollHeight - el.clientHeight),
      );
      const last = page.locator('[data-draggable-id="side-40"]');
      await expect(last).toBeVisible();
      await poll(() => edge(last, 'bottom')).toBeLessThanOrEqual(footerTop + 1);
    });

    test('reveals the first slot below the overlaid header in a keyboard drag', async ({
      page,
    }) => {
      await open(page);
      await scroll(sideScroller, 150);
      const overlayBottom = await edge(page.getByTestId('side-overlay'), 'bottom');
      const [first] = await rowsBetween(
        sideScroller,
        overlayBottom,
        await edge(page.getByTestId('side-overlay-footer'), 'top'),
      );
      await page.locator(`[data-draggable-id="${first.id}"]`).focus();
      await page.keyboard.press('Space');
      await expect(preview).toBeVisible();

      const placeholder = page.locator('.vdnd-drag-placeholder-visible');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowUp');
      }
      await poll(() => sideScroller.evaluate((el) => el.scrollTop)).toBe(0);
      await poll(
        async () => (await placeholder.boundingBox())?.y ?? Number.NaN,
      ).toBeGreaterThanOrEqual(overlayBottom - 1);

      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
    });

    test('reveals the last slot above the overlaid footer in a keyboard drag', async ({ page }) => {
      await open(page);
      await scroll(sideScroller, 1500);
      const footerTop = await edge(page.getByTestId('side-overlay-footer'), 'top');
      const rows = await rowsBetween(
        sideScroller,
        await edge(page.getByTestId('side-overlay'), 'bottom'),
        footerTop,
      );
      await page.locator(`[data-draggable-id="${rows[rows.length - 1].id}"]`).focus();
      await page.keyboard.press('Space');
      await expect(preview).toBeVisible();

      const placeholder = page.locator('.vdnd-drag-placeholder-visible');
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('ArrowDown');
      }
      await waitForFrames(page, 2);
      await poll(async () => {
        const box = await placeholder.boundingBox();
        return box ? box.y + box.height : Number.NaN;
      }).toBeLessThanOrEqual(footerTop + 1);

      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();
    });
  });
});
