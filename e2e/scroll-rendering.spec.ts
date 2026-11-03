import { expect, Page, test } from '@playwright/test';
import { collectPageErrors } from './fixtures/page-errors';
import { blankPxPerFrame, ViewChange } from './fixtures/scroll-coverage';

/**
 * The rows for a new scroll position or size must be in the frame that first shows it: rows
 * rendered a frame later leave the viewport blank wherever they don't reach. A browser hands the
 * page a scroll position in that frame's scroll event and a size in its ResizeObserver callbacks,
 * both before it paints.
 */
interface List {
  name: string;
  path: string;
  droppableId: string;
  /** Where its rows cover the whole viewport: past any header above them */
  start: number;
}

/** The docs' Quick start: 48px rows, overscan 3 (144px), a fixed containerHeight */
const SORTABLE_LIST: List = {
  name: 'vdnd-sortable-list',
  path: '/examples/quick-start',
  droppableId: 'backlog',
  start: 0,
};
/** 50px rows, overscan 3 (150px), sized by CSS */
const VIEWPORT: List = {
  name: '*vdndVirtualFor in vdnd-virtual-viewport',
  path: '/virtual-viewport',
  droppableId: 'viewport-a',
  start: 0,
};
/** 50px rows, no overscan (every row a change brings in must render in its frame), sized by CSS */
const SCROLLABLE: List = {
  name: '*vdndVirtualFor in vdndScrollable',
  path: '/virtual-for-scrollable?overscan=0',
  droppableId: 'scrollable',
  start: 0,
};
/** 48px rows below a header, overscan 3 (144px) */
const PAGE: List = {
  name: 'vdnd-virtual-content in vdndScrollable',
  path: '/examples/page-scroll',
  droppableId: 'today',
  start: 300,
};
/** The docs' Dynamic heights example: rows of their own heights, each observed while rendered */
const DYNAMIC_LIST: List = {
  name: 'vdnd-sortable-list with dynamic heights',
  path: '/examples/dynamic-height',
  droppableId: 'notes',
  start: 0,
};

/**
 * Blank px in the frames of a change, and the errors the page reported while it ran: a render in a
 * ResizeObserver callback that changes what is observed can raise a ResizeObserver loop error.
 */
async function blankPx(
  page: Page,
  list: List,
  change: ViewChange,
): Promise<{ blank: number[]; errors: string[] }> {
  const errors = collectPageErrors(page);
  await page.goto(list.path);
  await expect(
    page.locator(`[data-droppable-id="${list.droppableId}"] [data-draggable-id]`).first(),
  ).toBeVisible();
  const blank = await blankPxPerFrame(page, list.droppableId, list.start, change);
  return { blank, errors: errors.unexpected() };
}

test.describe('Fast scrolling', () => {
  // Each frame scrolls further than the list's overscan covers
  for (const [list, change] of [
    [SORTABLE_LIST, { kind: 'scroll', px: 600, frames: 20 }],
    [VIEWPORT, { kind: 'scroll', px: 250, frames: 10 }],
    [SCROLLABLE, { kind: 'scroll', px: 100, frames: 12 }],
    [PAGE, { kind: 'scroll', px: 600, frames: 20 }],
  ] as const) {
    test(`${list.name} paints its rows in every frame`, async ({ page }) => {
      const { blank, errors } = await blankPx(page, list, change);

      expect(blank, 'blank px in each frame').toEqual(new Array(change.frames).fill(0));
      expect(errors).toEqual([]);
    });
  }
});

test.describe('Showing and resizing', () => {
  // Hidden, a list has no size and reads a scroll position of 0; shown again, the browser
  // restores its position without a scroll event, and only its ResizeObserver tells
  for (const list of [
    { ...SORTABLE_LIST, start: 700 },
    { ...VIEWPORT, start: 700 },
    { ...SCROLLABLE, start: 700 },
    { ...DYNAMIC_LIST, start: 700 },
  ]) {
    test(`${list.name} paints its rows in the frame it shows again`, async ({ page }) => {
      const { blank, errors } = await blankPx(page, list, { kind: 'show-again' });

      expect(blank, 'blank px in the two frames after it shows').toEqual([0, 0]);
      expect(errors).toEqual([]);
    });
  }

  // Lists sized by CSS: 300px to 700px tall
  for (const list of [VIEWPORT, SCROLLABLE]) {
    test(`${list.name} paints rows where it grows, in the frame it grows`, async ({ page }) => {
      const { blank, errors } = await blankPx(page, list, { kind: 'resize', px: 700 });

      expect(blank, 'blank px in the two frames after it grows').toEqual([0, 0]);
      expect(errors).toEqual([]);
    });
  }

  test('vdnd-virtual-scroll paints the rows its items end with, in the frame they shrink', async ({
    page,
  }) => {
    // Scrolled to 40,000px of 1,000 items, the main demo regenerates 50: they end far above the
    // scroll position, which the browser clamps when it lays them out
    const errors = collectPageErrors(page);
    await page.goto('/?itemCount=2000');
    await expect(
      page.locator('[data-droppable-id="list-1"] [data-draggable-id]').first(),
    ).toBeVisible();
    await page.getByLabel('Item count').fill('100');

    const blank = await blankPxPerFrame(page, 'list-1', 40000, {
      kind: 'click',
      testId: 'regenerate-items',
    });

    expect(blank, 'blank px in the two frames after the items shrink').toEqual([0, 0]);
    expect(errors.unexpected()).toEqual([]);
  });

  test('vdnd-virtual-content paints the rows a taller header moves into view, in that frame', async ({
    page,
  }) => {
    const { blank, errors } = await blankPx(
      page,
      { ...PAGE, start: 1500 },
      { kind: 'grow-header', px: 400 },
    );

    expect(blank, 'blank px in the two frames after the header grows').toEqual([0, 0]);
    expect(errors).toEqual([]);
  });
});
