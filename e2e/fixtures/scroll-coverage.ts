import { Page } from '@playwright/test';
import { waitForFrames } from './drag-sync';

/** What changes the part of a virtual list its scroll container shows */
export type ViewChange =
  /** Scroll by `px` in each of `frames` frames, each time between two frames */
  | { kind: 'scroll'; px: number; frames: number }
  /** Hide what holds the list (`display: none`, as a closed tab panel would), then show it again */
  | { kind: 'show-again' }
  /** Make the scroll container `px` tall (a resized pane, a maximized window) */
  | { kind: 'resize'; px: number }
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

/**
 * The longest run of pixel rows (px) in a virtual list's viewport that show nothing but the
 * list's background, in a frame the page has not rendered: the list scrolled to `scrollTop` with
 * its scroll event held back. A browser that scrolls on its own thread shows such frames during a
 * fast scroll (Safari and Firefox always, Chrome when the page misses the frame) until the page
 * renders the rows of the new position: a whole viewport of them when a dragged scrollbar thumb
 * jumps across hundreds of rows.
 *
 * Measured on a screenshot: a run is a stretch of pixel rows whose pixels (between 10% and 90%
 * of the width) all have the background color of the first element at or around the list's scroll
 * container that paints one. Rows drawn as inset cards leave runs as tall as the gap between two
 * cards. The list's scroll event is dispatched afterwards, so it renders that position again.
 */
export async function longestBlankRunBeforeRender(
  page: Page,
  droppableId: string,
  scrollTop: number,
): Promise<number> {
  const viewport = await page.evaluate(
    ({ droppableId, scrollTop }) => {
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
      // The screenshot shows only what is in the window
      list.scrollIntoView({ block: 'nearest' });

      // Scroll events reach the list through the window's capture phase
      const holdBack = (event: Event): void => {
        if (event.target === list) event.stopImmediatePropagation();
      };
      window.addEventListener('scroll', holdBack, { capture: true });
      (window as unknown as { releaseHeldScroll: () => void }).releaseHeldScroll = () => {
        window.removeEventListener('scroll', holdBack, { capture: true });
        list.dispatchEvent(new Event('scroll'));
      };
      list.scrollTop = scrollTop;

      let background: number[] | null = null;
      for (
        let element: HTMLElement | null = list;
        element && !background;
        element = element.parentElement
      ) {
        const [r, g, b, a = 1] = (
          getComputedStyle(element).backgroundColor.match(/[\d.]+/g) ?? []
        ).map(Number);
        if (a === 1 && r !== undefined) background = [r, g, b];
      }
      if (!background) throw new Error(`No background around ${droppableId}`);

      const rect = list.getBoundingClientRect();
      return {
        clip: {
          x: rect.left + list.clientLeft,
          y: rect.top + list.clientTop,
          width: list.clientWidth,
          height: list.clientHeight,
        },
        background,
      };
    },
    { droppableId, scrollTop },
  );

  // The browser shows the new position; the page renders nothing for it
  await waitForFrames(page, 2);
  const screenshot = await page.screenshot({ clip: viewport.clip });

  const longestRun = await page.evaluate(
    async ({ data, background, width }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D canvas context');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const isBackground = (i: number): boolean =>
        [0, 1, 2].every((channel) => Math.abs(pixels[i + channel] - background[channel]) <= 3);

      let longest = 0;
      let run = 0;
      for (let y = 0; y < canvas.height; y++) {
        let blank = true;
        for (let x = Math.floor(canvas.width * 0.1); x < canvas.width * 0.9 && blank; x += 2) {
          blank = isBackground((y * canvas.width + x) * 4);
        }
        run = blank ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      return Math.round(longest / (canvas.width / width));
    },
    {
      data: screenshot.toString('base64'),
      background: viewport.background,
      width: viewport.clip.width,
    },
  );

  await page.evaluate(() =>
    (window as unknown as { releaseHeldScroll: () => void }).releaseHeldScroll(),
  );
  return longestRun;
}
