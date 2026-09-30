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
 * Wait until autoscroll has scrolled `scroller` in `direction` past `target` px (below it when
 * scrolling up), or to the end of its range in that direction for `'end'` (within `tolerance`
 * px). Fails once the scroll has reached no new furthest position in `direction` for
 * `stallTimeout` ms, not after a fixed total time.
 *
 * Autoscroll moves a bounded distance per frame, so the time a long scroll takes depends on the
 * frame rate: WebKit renders only a few frames per second on a loaded 4-core machine. A fixed
 * timeout then fails a healthy scroll, while a stall still fails here within `stallTimeout`.
 * The test timeout bounds the whole wait: tests that scroll far call `test.slow()`.
 *
 * Progress means a new furthest position, so a scroll that moves back mid-way (a dynamic-height
 * list anchoring its scroll position while rows above it are measured) counts as stalled until
 * it passes its furthest position again.
 */
export async function waitForAutoscroll(
  scroller: Locator,
  direction: 'down' | 'up',
  target: number | 'end',
  { tolerance = 2, stallTimeout = 5000 }: { tolerance?: number; stallTimeout?: number } = {},
): Promise<void> {
  const result = await scroller.evaluate(
    (element, options) =>
      new Promise<{ reached: boolean; scrollTop: number; furthest: number; max: number }>(
        (resolve) => {
          const sign = options.direction === 'down' ? 1 : -1;
          let furthest = element.scrollTop;
          let movedAt = performance.now();
          // A timer, not requestAnimationFrame: it keeps checking (and can report the stall)
          // when the page renders no frames
          const check = () => {
            const { scrollTop } = element;
            const max = element.scrollHeight - element.clientHeight;
            let reached: boolean;
            if (options.target === 'end') {
              const left = options.direction === 'down' ? max - scrollTop : scrollTop;
              reached = left <= options.tolerance;
            } else {
              reached = sign * scrollTop > sign * options.target;
            }
            if (sign * scrollTop > sign * furthest) {
              furthest = scrollTop;
              movedAt = performance.now();
            }
            if (reached || performance.now() - movedAt > options.stallTimeout) {
              resolve({ reached, scrollTop, furthest, max });
              return;
            }
            setTimeout(check, 16);
          };
          check();
        },
      ),
    { direction, target, tolerance, stallTimeout },
  );
  const goal =
    target === 'end'
      ? `reaching the ${direction === 'down' ? 'bottom' : 'top'}`
      : `${direction === 'down' ? 'passing' : 'going below'} ${target}`;
  expect(
    result.reached,
    `Autoscroll ${direction} stopped before ${goal}: no new furthest position (` +
      `${result.furthest}) for ${stallTimeout}ms; scrollTop ${result.scrollTop}, max ${result.max}`,
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
