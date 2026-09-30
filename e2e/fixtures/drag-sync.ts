import { expect, Locator, Page } from '@playwright/test';

/**
 * Ensure the drag scheduler has processed the pointer at exactly (x, y) before releasing.
 *
 * The drop outcome of a drag is computed from the last PROCESSED drag state — DragStateService
 * commits cursorPosition, activeDroppable and placeholderIndex together in one scheduler tick —
 * so once the processed cursor matches the release point, the drop destination is fully
 * determined regardless of event-loop timing.
 *
 * A single rAF wait cannot provide this guarantee: pointer event delivery is a browser task
 * while rAF is a rendering step, so under parallel/WebKit load the frame can fire before the
 * final move is seen and the drop then uses a stale placeholder index. This helper re-issues
 * the move on every retry, which also heals the "browser coalesced/dropped the final stepped
 * move" failure mode (E2E.md rule #6).
 *
 * Reads the `drag-state-debug` element, present on every demo page (visible debug panel on the
 * main demo, hidden DragStateDebugComponent on the task demos) unless it is opened with
 * `?dragStateDebug=false`, which only the perf benchmarks do.
 *
 * The processed cursor is the EFFECTIVE position: do not use with axis locking, and with
 * constrain-to-container it only matches when (x, y) lies inside the constraint bounds.
 */
export async function settleDragPosition(page: Page, x: number, y: number): Promise<void> {
  await expect(async () => {
    // Moving to the same coordinates can be coalesced away by WebKit under load. Jitter first,
    // then move to the exact release point so a fresh pointer event is delivered on every retry.
    await page.mouse.move(x > 4 ? x - 2 : x + 2, y > 4 ? y - 2 : y + 2);
    await page.mouse.move(x, y);
    const raw = await page.getByTestId('drag-state-debug').textContent();
    const debugState = JSON.parse(raw ?? '{}') as {
      isDragging?: boolean;
      cursorPosition?: { x?: number; y?: number } | null;
    };
    expect(debugState.isDragging).toBe(true);
    const cursor = debugState.cursorPosition;
    // ±1px tolerance: browsers round fractional client coordinates differently
    expect(Math.abs((cursor?.x ?? Number.NaN) - x)).toBeLessThanOrEqual(1);
    expect(Math.abs((cursor?.y ?? Number.NaN) - y)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 5000 });
}

/**
 * Wait until the processed drag state has resolved to the given droppable id.
 */
export async function waitForActiveDroppable(page: Page, droppableId: string): Promise<void> {
  await expect(async () => {
    const raw = await page.getByTestId('drag-state-debug').textContent();
    const debugState = JSON.parse(raw ?? '{}') as { activeDroppable?: unknown };
    expect(debugState.activeDroppable).toBe(droppableId);
  }).toPass({ timeout: 2000 });
}

/** Resolve after the page has rendered `count` more animation frames. */
export async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const tick = () => {
          remaining -= 1;
          if (remaining > 0) {
            requestAnimationFrame(tick);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/**
 * Wait until autoscroll has scrolled `scroller` down past `target` px, or to the end of its range
 * (within `tolerance` px) for `'end'`. Fails once the scroll position has not moved on for
 * `stallTimeout` ms, not after a fixed total time.
 *
 * Autoscroll moves a bounded distance per frame, so the time a long scroll takes depends on the
 * frame rate: WebKit renders only a few frames per second on a loaded 4-core machine. A fixed
 * timeout then fails a healthy scroll, while a stall still fails here within `stallTimeout`.
 * The test timeout bounds the whole wait: tests that scroll far call `test.slow()`.
 */
export async function waitForScrollDown(
  scroller: Locator,
  target: number | 'end',
  { tolerance = 2, stallTimeout = 5000 }: { tolerance?: number; stallTimeout?: number } = {},
): Promise<void> {
  const result = await scroller.evaluate(
    (element, options) =>
      new Promise<{ reached: boolean; scrollTop: number; maxScrollTop: number }>((resolve) => {
        let furthest = element.scrollTop;
        let movedAt = performance.now();
        const check = () => {
          const { scrollTop } = element;
          const maxScrollTop = element.scrollHeight - element.clientHeight;
          const reached =
            options.target === 'end'
              ? maxScrollTop - scrollTop <= options.tolerance
              : scrollTop > options.target;
          if (reached) {
            resolve({ reached, scrollTop, maxScrollTop });
            return;
          }
          // Progress is a new furthest position: a list that grows under the scroll (rows
          // measured taller) raises the distance left without the scroll stalling
          if (scrollTop > furthest) {
            furthest = scrollTop;
            movedAt = performance.now();
          } else if (performance.now() - movedAt > options.stallTimeout) {
            resolve({ reached, scrollTop, maxScrollTop });
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
    { target, tolerance, stallTimeout },
  );
  expect(
    result.reached,
    `Autoscroll stopped at scrollTop ${result.scrollTop} (max ${result.maxScrollTop}) before ` +
      `${target === 'end' ? 'the end' : `passing ${target}`} and did not move for ${stallTimeout}ms`,
  ).toBe(true);
}

interface InputHandledWindow {
  vdndInputHandled?: Promise<void>;
}

/**
 * Run `sendInput` and resolve once the page has received the `eventType` event it causes and
 * rendered two frames since (the library's drag start is synchronous; its render follows).
 *
 * This is the sync point for NEGATIVE assertions such as "no drag started": without it they
 * run before the input has even reached the page and pass whatever the library does.
 * `sendInput` must dispatch exactly one such event (e.g. an unstepped `mouse.move`).
 */
export async function afterInputHandled(
  page: Page,
  eventType: 'mousemove' | 'keyup',
  sendInput: () => Promise<unknown>,
): Promise<void> {
  await page.evaluate((type) => {
    (window as InputHandledWindow).vdndInputHandled = new Promise<void>((resolve) => {
      const afterTwoFrames = () =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      document.addEventListener(type, afterTwoFrames, { capture: true, once: true });
    });
  }, eventType);
  await sendInput();
  await page.evaluate(() => (window as InputHandledWindow).vdndInputHandled);
}
