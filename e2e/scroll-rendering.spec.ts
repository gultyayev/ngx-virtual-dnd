import { expect, test } from '@playwright/test';
import { blankPxPerFrame, FastScroll } from './fixtures/scroll-coverage';

/**
 * A fast scroll (a trackpad flick, a dragged scrollbar thumb) moves a list further in one frame
 * than its overscan reaches. The rows for the new position must be in the frame that first shows
 * it: rows rendered a frame later leave the viewport blank wherever the list moved past them.
 * Each frame here scrolls further than the list's overscan covers.
 */
const LISTS: { name: string; path: string; scroll: FastScroll }[] = [
  {
    // The docs' Quick start: 48px rows, overscan 3 (144px)
    name: 'vdnd-sortable-list',
    path: '/examples/quick-start',
    scroll: { droppableId: 'backlog', start: 0, step: 600, frames: 20 },
  },
  {
    // 50px rows, overscan 3 (150px)
    name: '*vdndVirtualFor in vdnd-virtual-viewport',
    path: '/virtual-viewport',
    scroll: { droppableId: 'viewport-a', start: 0, step: 250, frames: 10 },
  },
  {
    // 50px rows, no overscan: every row a scroll brings in must render in its frame
    name: '*vdndVirtualFor in vdndScrollable',
    path: '/virtual-for-scrollable?overscan=0',
    scroll: { droppableId: 'scrollable', start: 0, step: 100, frames: 12 },
  },
  {
    // 48px rows below a header, overscan 3 (144px); starts past the header
    name: 'vdnd-virtual-content in vdndScrollable',
    path: '/examples/page-scroll',
    scroll: { droppableId: 'today', start: 300, step: 600, frames: 20 },
  },
];

test.describe('Fast scrolling', () => {
  for (const { name, path, scroll } of LISTS) {
    test(`${name} paints its rows in every frame`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.locator(`[data-droppable-id="${scroll.droppableId}"] [data-draggable-id]`).first(),
      ).toBeVisible();

      const blank = await blankPxPerFrame(page, scroll);

      expect(blank, 'blank px in each frame').toEqual(new Array(scroll.frames).fill(0));
    });
  }
});
