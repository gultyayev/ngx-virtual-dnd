import { Page } from '@playwright/test';

export interface FastScroll {
  /** The list's droppable ID: its scroll container is the list itself, or inside or around it */
  droppableId: string;
  /** Where the scroll starts (px): rows must cover the whole viewport from there on */
  start: number;
  /** How far each frame scrolls (px) */
  step: number;
  /** How many frames scroll */
  frames: number;
}

/**
 * Scroll a virtual list by `step` px `frames` times, each time between two frames (as a browser
 * hands the page a new scroll position at the start of a frame), and measure how much of its
 * viewport (px) the rendered rows leave blank in each of those frames, right before it paints: in a
 * ResizeObserver callback, which runs after the frame's scroll event, its animation frame
 * callbacks and its layout. Returns one value per frame.
 *
 * Rows are the `data-draggable-id` elements in the scroll container. The scroll must stay inside
 * the rows (past any header above them, before any content after them).
 */
export async function blankPxPerFrame(page: Page, scroll: FastScroll): Promise<number[]> {
  return page.evaluate(async ({ droppableId, start, step, frames }) => {
    const droppable = document.querySelector<HTMLElement>(`[data-droppable-id="${droppableId}"]`);
    if (!droppable) throw new Error(`No droppable ${droppableId}`);
    const scrolls = (element: Element): boolean => {
      const overflow = getComputedStyle(element).overflowY;
      return (
        (overflow === 'auto' || overflow === 'scroll') &&
        element.scrollHeight > element.clientHeight
      );
    };
    let scroller: HTMLElement | null = null;
    for (let element: HTMLElement | null = droppable; element; element = element.parentElement) {
      if (scrolls(element)) {
        scroller = element;
        break;
      }
    }
    scroller ??= Array.from(droppable.querySelectorAll<HTMLElement>('*')).find(scrolls) ?? null;
    if (!scroller) throw new Error(`No scroll container for ${droppableId}`);
    const list = scroller;

    /** Viewport px the rows leave uncovered */
    const blankPx = (): number => {
      const rect = list.getBoundingClientRect();
      const top = rect.top + list.clientTop;
      const bottom = top + list.clientHeight;
      const covered = Array.from(list.querySelectorAll('[data-draggable-id]'))
        .map((row) => row.getBoundingClientRect())
        .filter((row) => row.height > 0 && row.bottom > top && row.top < bottom)
        .map((row) => [Math.max(top, row.top), Math.min(bottom, row.bottom)] as const)
        .sort((a, b) => a[0] - b[0]);
      let blank = 0;
      let reached = top;
      for (const [rowTop, rowBottom] of covered) {
        // Sub-pixel seams between rows are not blank space
        if (rowTop > reached + 1) blank += rowTop - reached;
        reached = Math.max(reached, rowBottom);
      }
      if (bottom > reached + 1) blank += bottom - reached;
      return Math.round(blank);
    };

    const probe = document.createElement('div');
    probe.style.cssText = 'position: fixed; top: 0; left: 0; width: 1px; height: 1px;';
    document.body.append(probe);
    /** Measure in the next frame, right before it paints */
    const beforeNextPaint = (): Promise<number> =>
      new Promise((resolve) => {
        // A new observation reports the probe's size in the next rendering update, after layout
        const observer = new ResizeObserver(() => {
          observer.disconnect();
          resolve(blankPx());
        });
        observer.observe(probe);
      });
    /** Resolve in a task after the current frame painted */
    const afterPaint = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

    list.scrollTop = start;
    for (let i = 0; i < 3; i++) await afterPaint();

    const blank: number[] = [];
    for (let i = 0; i < frames; i++) {
      list.scrollTop += step;
      blank.push(await beforeNextPaint());
      await new Promise((resolve) => setTimeout(resolve));
    }
    probe.remove();
    return blank;
  }, scroll);
}
