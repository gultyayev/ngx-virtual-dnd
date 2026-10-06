import { expect, Page, test } from '@playwright/test';
import { settleDragPosition, waitForActiveDroppable } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

type ListId = 'scrollable' | 'scrollable-b';

/**
 * `*vdndVirtualFor` directly in a `vdndScrollable` droppable, with no viewport component.
 * Fixture: /virtual-for-scrollable. Tasks (`scrollable`, rows s-1…s-30) and Backlog
 * (`scrollable-b`, rows b-1…b-20): 50px rows in 300px scroll containers that set no `position`
 * (the directive positions them).
 */
test.describe('Virtual for in a scrollable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/virtual-for-scrollable', { waitUntil: 'domcontentloaded' });
    await expect(row(page, 's-1')).toBeVisible();
    await expect(row(page, 'b-1')).toBeVisible();
  });

  test('scrolls the list', async ({ page }) => {
    expect(await scrollHeight(page, 'scrollable')).toBe(1500);

    await scrollListTo(page, 'scrollable', 1200);

    await expect(row(page, 's-30')).toBeInViewport();
    await expect(row(page, 's-1')).toHaveCount(0);
  });

  test('opens a gap at the placeholder and drops into it', async ({ page }) => {
    await dragRowOnto(page, 's-1', 's-4', 'scrollable');

    expect(await placeholderGap(page, 'scrollable')).toEqual({ above: 's-4', below: 's-5' });
    // The gap fills the dragged row's closed-up slot: the scroll height stays the same
    expect(await scrollHeight(page, 'scrollable')).toBe(1500);

    await drop(page);
    await expectDrop(page, 0, 3);
    await expectOrder(page, 'scrollable', ['s-2', 's-3', 's-4', 's-1', 's-5']);
  });

  test('opens a gap and drops into it after the list is scrolled', async ({ page }) => {
    // Task 11 sits one row below the top edge, clear of the autoscroll threshold
    await scrollListTo(page, 'scrollable', 450);
    await expect(row(page, 's-14')).toBeInViewport();

    await dragRowOnto(page, 's-11', 's-14', 'scrollable');

    expect(await placeholderGap(page, 'scrollable')).toEqual({ above: 's-14', below: 's-15' });

    await drop(page);
    await expectDrop(page, 10, 13);
    await expectOrder(page, 'scrollable', ['s-12', 's-13', 's-14', 's-11', 's-15']);
  });

  test('drops at the end of the list scrolled to the bottom', async ({ page }) => {
    // Task 26 sits one row below the top edge, clear of the autoscroll threshold
    await scrollListTo(page, 'scrollable', 1200);
    await expect(row(page, 's-30')).toBeInViewport();

    await dragRowOnto(page, 's-26', 's-30', 'scrollable');

    expect(await placeholderGap(page, 'scrollable')).toEqual({ above: 's-30', below: null });

    await drop(page);
    await expectDrop(page, 25, 29);
    await expectOrder(page, 'scrollable', ['s-29', 's-30', 's-26']);
  });

  test('opens a gap for a row dragged in from another list and drops into it', async ({ page }) => {
    await dragRowOnto(page, 'b-1', 's-3', 'scrollable');

    expect(await placeholderGap(page, 'scrollable')).toEqual({ above: 's-2', below: 's-3' });
    // Nothing leaves this list: the gap adds its height to the scroll height
    expect(await scrollHeight(page, 'scrollable')).toBe(1550);

    await drop(page);
    await expectDrop(page, 0, 2);
    await expect(page.getByTestId('scrollable-count')).toHaveText('31');
    await expect(page.getByTestId('scrollable-b-count')).toHaveText('19');
    await expectOrder(page, 'scrollable', ['s-2', 'b-1', 's-3']);
    expect(await scrollHeight(page, 'scrollable')).toBe(1550);
  });
});

/**
 * With no overscan, the rows rendered for a scroll position past an incoming placeholder must be
 * the ones its gap pushes into view.
 */
test.describe('Virtual for in a scrollable without overscan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/virtual-for-scrollable?overscan=0', { waitUntil: 'domcontentloaded' });
    await expect(row(page, 's-1')).toBeVisible();
    await expect(row(page, 'b-1')).toBeVisible();
  });

  test('renders the rows in view when scrolled past an incoming placeholder', async ({ page }) => {
    // Pick Backlog item 1 up with the keyboard and move it into Tasks: its placeholder opens a
    // 50px gap at index 0
    await row(page, 'b-1').focus();
    await page.keyboard.press('Space');
    await expect(preview(page), 'The keyboard drag should start').toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await waitForActiveDroppable(page, 'scrollable');
    await expect(
      scroller(page, 'scrollable').locator('.vdnd-drag-placeholder-visible'),
    ).toBeAttached();

    // Scrolled 500px, the gap puts Task 10 (index 9) at the top edge and Task 15 at the bottom
    await scrollListTo(page, 'scrollable', 500);

    await expectEdgeRows(page, { top: 's-10', bottom: 's-15' });

    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeHidden();
  });

  test('renders the rows in view when scrolled past the dragged row and its placeholder', async ({
    page,
  }) => {
    // Pick Task 1 up with the keyboard: it is hidden, its placeholder fills its slot
    await row(page, 's-1').focus();
    await page.keyboard.press('Space');
    await expect(preview(page), 'The keyboard drag should start').toBeVisible();
    await expect(
      scroller(page, 'scrollable').locator('.vdnd-drag-placeholder-visible'),
    ).toBeAttached();

    // Scrolled 525px: Task 11 (500-550px) to Task 17 (800-850px) are in view
    await scrollListTo(page, 'scrollable', 525);

    await expectEdgeRows(page, { top: 's-11', bottom: 's-17' });

    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeHidden();
  });
});

/**
 * The rows covering the top and bottom edges of the Tasks list: with no row there, the list shows
 * a blank strip. Retried until the render after the scroll has landed.
 */
async function expectEdgeRows(page: Page, expected: { top: string; bottom: string }) {
  await expect(async () => {
    const edges = await scroller(page, 'scrollable').evaluate((list) => {
      const box = list.getBoundingClientRect();
      const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-draggable-id]'));
      const rowAt = (y: number) =>
        rows
          .find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top <= y && rect.bottom > y;
          })
          ?.getAttribute('data-draggable-id') ?? null;
      return { top: rowAt(box.top + 1), bottom: rowAt(box.top + list.clientHeight - 1) };
    });
    expect(edges, 'Rows should cover both edges (no blank strip)').toEqual(expected);
  }).toPass({ timeout: 2000 });
}

function scroller(page: Page, id: ListId) {
  return page.locator(`[data-droppable-id="${id}"]`);
}

function row(page: Page, id: string) {
  return page.locator(`[data-draggable-id="${id}"]`);
}

function preview(page: Page) {
  return page.getByTestId('vdnd-drag-preview');
}

function scrollHeight(page: Page, id: ListId): Promise<number> {
  return scroller(page, id).evaluate((element) => element.scrollHeight);
}

/** Scroll a list, writing and checking the scroll together (E2E.md). */
async function scrollListTo(page: Page, id: ListId, scrollTop: number): Promise<void> {
  await expect(async () => {
    const actual = await scroller(page, id).evaluate((element, top) => {
      element.scrollTop = top;
      return element.scrollTop;
    }, scrollTop);
    expect(actual).toBe(scrollTop);
  }).toPass();
}

/**
 * Drag a row by its center onto the center of another row and hold it there, so the preview
 * covers the target and takes its index. The target is measured first: once the pointer enters
 * another list, its placeholder shifts the rows below it.
 */
async function dragRowOnto(
  page: Page,
  sourceId: string,
  targetId: string,
  targetList: ListId,
): Promise<void> {
  const target = await row(page, targetId).boundingBox();
  const source = await row(page, sourceId).boundingBox();
  if (!target || !source) throw new Error(`Row ${sourceId} or ${targetId} has no bounding box`);

  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 10, { steps: 2 });
  await expect(preview(page), 'The drag should start').toBeVisible();

  const x = target.x + target.width / 2;
  const y = target.y + target.height / 2;
  await page.mouse.move(x, y, { steps: 10 });
  await settleDragPosition(page, x, y);
  await waitForActiveDroppable(page, targetList);
}

async function drop(page: Page): Promise<void> {
  await page.mouse.up();
  await expect(preview(page)).toBeHidden();
}

/**
 * The visible rows right above and below the placeholder, once the placeholder fills the space
 * between them: its edges meet theirs within 1px (with no row below, it ends where the scroll
 * content ends). Retried until the placeholder's render has landed.
 */
async function placeholderGap(page: Page, id: ListId) {
  let gap: { above: string | null; below: string | null } | null = null;
  await expect(async () => {
    const measured = await scroller(page, id).evaluate((list) => {
      const placeholder = list.querySelector('.vdnd-drag-placeholder-visible');
      if (!placeholder) return null;
      const box = placeholder.getBoundingClientRect();
      const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-draggable-id]'))
        .filter((element) => element.style.display !== 'none')
        .map((element) => ({
          id: element.getAttribute('data-draggable-id'),
          rect: element.getBoundingClientRect(),
        }));
      // Rows whose middle is above / below the placeholder's middle
      const middle = box.top + box.height / 2;
      const above = rows
        .filter(({ rect }) => rect.top + rect.height / 2 < middle)
        .sort((a, b) => b.rect.top - a.rect.top)[0];
      const below = rows
        .filter(({ rect }) => rect.top + rect.height / 2 >= middle)
        .sort((a, b) => a.rect.top - b.rect.top)[0];
      const contentBottom = list.getBoundingClientRect().top - list.scrollTop + list.scrollHeight;
      return {
        above: above?.id ?? null,
        below: below?.id ?? null,
        fitsAbove: !!above && Math.abs(above.rect.bottom - box.top) <= 1,
        fitsBelow: below
          ? Math.abs(below.rect.top - box.bottom) <= 1
          : Math.abs(contentBottom - box.bottom) <= 1,
      };
    });
    expect(measured).toMatchObject({ fitsAbove: true, fitsBelow: true });
    gap = { above: measured!.above, below: measured!.below };
  }).toPass({ timeout: 2000 });
  return gap;
}

async function expectDrop(page: Page, sourceIndex: number, destinationIndex: number) {
  const demo = page.getByTestId('scrollable-virtual-for-demo');
  await expect(demo).toHaveAttribute('data-last-drop-source-index', String(sourceIndex));
  await expect(demo).toHaveAttribute('data-last-drop-destination-index', String(destinationIndex));
}

/** The rendered rows of a list contain `ids` as one contiguous run, in this order. */
async function expectOrder(page: Page, id: ListId, ids: string[]): Promise<void> {
  await poll(async () => {
    const rendered = await scroller(page, id)
      .locator('[data-draggable-id]')
      .evaluateAll((rows) => rows.map((element) => element.getAttribute('data-draggable-id')));
    const start = rendered.indexOf(ids[0]);
    return start === -1 ? rendered : rendered.slice(start, start + ids.length);
  }).toEqual(ids);
}
