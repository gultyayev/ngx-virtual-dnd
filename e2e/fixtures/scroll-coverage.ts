import { Page } from '@playwright/test';

/** What changes the part of a virtual list its scroll container shows */
export type ViewChange =
  /** Scroll by `px` in each of `frames` frames, each time between two frames */
  | { kind: 'scroll'; px: number; frames: number }
  /** Hide what holds the list (`display: none`, as a closed tab panel would), then show it again */
  | { kind: 'show-again' }
  /** Make the scroll container `px` tall (a resized pane, a maximized window) */
  | { kind: 'resize'; px: number }
  /** Pad the scroll container by `px` at its top and bottom, within the height it has */
  | { kind: 'pad'; px: number }
  /** Pad the top of the list's `vdndContentHeader` by `px` (its text wraps, content loads in it) */
  | { kind: 'grow-header'; px: number }
  /** Click the element with this `data-testid` (a control of the page that changes the items) */
  | { kind: 'click'; testId: string };

/**
 * How much of a virtual list's viewport (px) its rendered rows leave blank in the frames after a
 * change, measured in each frame right before it paints: in a ResizeObserver callback, which runs
 * after the frame's scroll event, its animation frame callbacks and its layout. A scroll makes one
 * change per frame and measures each of those frames; the other changes happen once, between two
 * frames (as the browser hands the page a new position or size at the start of a frame), and the
 * two frames after them are measured.
 *
 * The list scrolls to `start` first. Rows are the `data-draggable-id` elements in the scroll
 * container, which is the list's droppable or an element inside or around it. The viewport must
 * show only rows from `start` on (past any header above them, before any content after them).
 */
export async function blankPxPerFrame(
  page: Page,
  droppableId: string,
  start: number,
  change: ViewChange,
): Promise<number[]> {
  return page.evaluate(
    async ({ droppableId, start, change }) => {
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
      const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
      const settle = async (): Promise<void> => {
        for (let i = 0; i < 3; i++) await afterPaint();
      };

      list.scrollTop = start;
      await settle();

      const blank: number[] = [];
      if (change.kind === 'scroll') {
        for (let i = 0; i < change.frames; i++) {
          list.scrollTop += change.px;
          blank.push(await beforeNextPaint());
          await nextTask();
        }
      } else {
        if (change.kind === 'show-again') {
          const holder = droppable.parentElement;
          if (!holder) throw new Error(`No element holds ${droppableId}`);
          holder.style.display = 'none';
          await settle();
          holder.style.display = '';
        } else if (change.kind === 'resize') {
          list.style.height = `${change.px}px`;
        } else if (change.kind === 'pad') {
          list.style.boxSizing = 'border-box';
          list.style.paddingTop = list.style.paddingBottom = `${change.px}px`;
        } else if (change.kind === 'click') {
          const control = document.querySelector<HTMLElement>(`[data-testid="${change.testId}"]`);
          if (!control) throw new Error(`No element with data-testid ${change.testId}`);
          control.click();
        } else {
          const header = droppable.querySelector<HTMLElement>('[vdndContentHeader]');
          if (!header) throw new Error(`No vdndContentHeader in ${droppableId}`);
          header.style.paddingTop = `${change.px}px`;
        }
        for (let i = 0; i < 2; i++) {
          blank.push(await beforeNextPaint());
          await nextTask();
        }
      }
      probe.remove();
      return blank;
    },
    { droppableId, start, change },
  );
}
