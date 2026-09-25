import { expect, Page, test } from '@playwright/test';
import { settleDragPosition, waitForActiveDroppable } from './fixtures/drag-sync';
import { poll } from './fixtures/polling';

type ViewportId = 'viewport-a' | 'viewport-b';

/**
 * `vdnd-virtual-viewport` as the droppable, rendering its rows with `*vdndVirtualFor`.
 * Fixture: /virtual-viewport. Tasks (viewport-a) holds 60 rows; Backlog (viewport-b) holds 30 and
 * reserves 80px above them with `contentOffset` (`?contentOffset=` sets another offset). Rows are
 * 50px tall, both viewports 300px.
 */
test.describe('Virtual viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/virtual-viewport', { waitUntil: 'domcontentloaded' });
    await expect(row(page, 'a-1')).toBeVisible();
    await expect(row(page, 'b-1')).toBeVisible();
  });

  test('renders only the rows around the scroll position', async ({ page }) => {
    const tasks = viewport(page, 'viewport-a');
    expect(await tasks.locator('[data-draggable-id]').count()).toBeLessThan(20);
    await expect(row(page, 'a-60')).toHaveCount(0);

    // Write and check the scroll together: a write made before the rows have their height is lost
    await expect(async () => {
      const atBottom = await tasks.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return (
          element.scrollTop > 0 &&
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1
        );
      });
      expect(atBottom).toBe(true);
    }).toPass();

    await expect(row(page, 'a-60')).toBeInViewport();
    await expect(row(page, 'a-1')).toHaveCount(0);
  });

  test('reorders a row with the pointer', async ({ page }) => {
    await dragRowOnto(page, 'a-1', 'a-4', 'viewport-a');

    await expectDrop(page, 0, 3);
    await expectOrder(page, 'viewport-a', ['a-2', 'a-3', 'a-4', 'a-1', 'a-5']);
  });

  test('drops at the right index after the viewport is scrolled', async ({ page }) => {
    // 9 rows: Task 11 sits one row below the top edge, so the drag stays clear of the
    // autoscroll threshold (a row at the edge would scroll the list as soon as it is picked up)
    await scrollViewportTo(page, 'viewport-a', 450);
    await expect(row(page, 'a-14')).toBeInViewport();

    await dragRowOnto(page, 'a-11', 'a-14', 'viewport-a');

    await expectDrop(page, 10, 13);
    await expectOrder(page, 'viewport-a', ['a-12', 'a-13', 'a-14', 'a-11', 'a-15']);
  });

  test('moves a row into another viewport', async ({ page }) => {
    await dragRowOnto(page, 'a-1', 'b-2', 'viewport-b');

    await expectDrop(page, 0, 1);
    await expect(page.getByTestId('viewport-a-count')).toHaveText('59');
    await expect(page.getByTestId('viewport-b-count')).toHaveText('31');
    await expectOrder(page, 'viewport-b', ['b-1', 'a-1', 'b-2']);
  });

  test('reorders a row below the content offset', async ({ page }) => {
    await dragRowOnto(page, 'b-1', 'b-3', 'viewport-b');

    await expectDrop(page, 0, 2);
    await expectOrder(page, 'viewport-b', ['b-2', 'b-3', 'b-1', 'b-4']);
  });

  test('reorders a row with the keyboard', async ({ page }) => {
    await keyboardMoveDown(page, 'a-1', 2);

    await expectDrop(page, 0, 2);
    await expectOrder(page, 'viewport-a', ['a-2', 'a-3', 'a-1', 'a-4']);
  });

  test('reorders a row below the content offset with the keyboard', async ({ page }) => {
    await keyboardMoveDown(page, 'b-1', 1);

    await expectDrop(page, 0, 1);
    await expectOrder(page, 'viewport-b', ['b-2', 'b-1', 'b-3']);
  });

  test('scrolls while a row is held near its bottom edge', async ({ page }) => {
    const tasks = viewport(page, 'viewport-a');
    const box = await tasks.boundingBox();
    if (!box) throw new Error('The Tasks viewport has no bounding box');

    await startDrag(page, 'a-1');
    // 25px inside the edge reaches the autoscroll threshold in every browser (E2E.md rule 6)
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 25;
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x, y);

    await poll(() => tasks.evaluate((element) => element.scrollTop), {
      message: 'The viewport should scroll while the row is held near its bottom edge',
    }).toBeGreaterThan(100);

    await page.mouse.up();
    await expect(preview(page)).toBeHidden();
  });
});

/**
 * Backlog reserves 400px above its rows, more than the 3 rows of overscan: which rows it renders
 * depends on the offset, not only on the scroll position.
 */
test.describe('Virtual viewport with a content offset deeper than the overscan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/virtual-viewport?contentOffset=400', { waitUntil: 'domcontentloaded' });
    await expect(row(page, 'b-1')).toBeAttached();
  });

  /** Scroll 200px into Backlog's rows, and wait for the render that follows the scroll. */
  async function scrollIntoRows(page: Page): Promise<void> {
    await scrollViewportTo(page, 'viewport-b', 600);
    // Until then the rows rendered for the top of the list are still there (Backlog items 1-10),
    // scrolled into view: the item 1 above the overscan leaves with that render
    await expect(row(page, 'b-1')).toHaveCount(0);
  }

  test('renders the rows in view once scrolled into the list', async ({ page }) => {
    // Backlog item 5 (index 4) is at the top edge
    await scrollIntoRows(page);

    const topRow = row(page, 'b-5');
    await expect(topRow).toBeInViewport();
    const rowBox = await topRow.boundingBox();
    const viewportBox = await viewport(page, 'viewport-b').boundingBox();
    if (!rowBox || !viewportBox) throw new Error('Backlog item 5 or its viewport has no box');
    expect(Math.abs(rowBox.y - viewportBox.y)).toBeLessThanOrEqual(1);
  });

  test('drops at the right index once scrolled into the list', async ({ page }) => {
    // Backlog item 6 sits one row below the top edge, clear of the autoscroll threshold
    await scrollIntoRows(page);
    await expect(row(page, 'b-8')).toBeInViewport();

    await dragRowOnto(page, 'b-6', 'b-8', 'viewport-b');

    await expectDrop(page, 5, 7);
    await expectOrder(page, 'viewport-b', ['b-7', 'b-8', 'b-6', 'b-9']);
  });
});

function viewport(page: Page, id: ViewportId) {
  return page.locator(`[data-droppable-id="${id}"]`);
}

function row(page: Page, id: string) {
  return page.locator(`[data-draggable-id="${id}"]`);
}

function preview(page: Page) {
  return page.getByTestId('vdnd-drag-preview');
}

/**
 * Scroll a viewport, writing and checking the scroll together: a write made before the rows have
 * their height is clamped for good (E2E.md, "Scroll Commands Before Content Height Is Ready").
 */
async function scrollViewportTo(page: Page, id: ViewportId, scrollTop: number): Promise<void> {
  await expect(async () => {
    const actual = await viewport(page, id).evaluate((element, top) => {
      element.scrollTop = top;
      return element.scrollTop;
    }, scrollTop);
    expect(actual).toBe(scrollTop);
  }).toPass();
}

/** Press on the center of a row and move past the drag threshold. */
async function startDrag(page: Page, rowId: string): Promise<void> {
  const box = await row(page, rowId).boundingBox();
  if (!box) throw new Error(`Row ${rowId} has no bounding box`);

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 2 });
  await expect(preview(page), 'The drag should start').toBeVisible();
}

/**
 * Drag a row by its center onto the center of another row, so the preview covers the target and
 * takes its index. The target is measured first: once the pointer enters another list, its
 * placeholder shifts the rows below it.
 */
async function dragRowOnto(
  page: Page,
  sourceId: string,
  targetId: string,
  targetList: ViewportId,
): Promise<void> {
  const target = await row(page, targetId).boundingBox();
  if (!target) throw new Error(`Row ${targetId} has no bounding box`);

  await startDrag(page, sourceId);
  const x = target.x + target.width / 2;
  const y = target.y + target.height / 2;
  await page.mouse.move(x, y, { steps: 10 });
  await settleDragPosition(page, x, y);
  await waitForActiveDroppable(page, targetList);
  await page.mouse.up();
  await expect(preview(page)).toBeHidden();
}

/** Pick a row up with Space, move it down `steps` rows and drop it with Space. */
async function keyboardMoveDown(page: Page, rowId: string, steps: number): Promise<void> {
  await row(page, rowId).focus();
  await page.keyboard.press('Space');
  await expect(preview(page), 'The keyboard drag should start').toBeVisible();
  for (let step = 0; step < steps; step++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Space');
  await expect(preview(page)).toBeHidden();
}

async function expectDrop(page: Page, sourceIndex: number, destinationIndex: number) {
  const demo = page.getByTestId('viewport-demo');
  await expect(demo).toHaveAttribute('data-last-drop-source-index', String(sourceIndex));
  await expect(demo).toHaveAttribute('data-last-drop-destination-index', String(destinationIndex));
}

/** The rendered rows of a viewport contain `ids` as one contiguous run, in this order. */
async function expectOrder(page: Page, list: ViewportId, ids: string[]): Promise<void> {
  await poll(async () => {
    const rendered = await viewport(page, list)
      .locator('[data-draggable-id]')
      .evaluateAll((rows) => rows.map((element) => element.getAttribute('data-draggable-id')));
    const start = rendered.indexOf(ids[0]);
    return start === -1 ? rendered : rendered.slice(start, start + ids.length);
  }).toEqual(ids);
}
