import { NgZone, type WritableSignal } from '@angular/core';

/** A layout value, or 0 where there is no layout (server rendering leaves them undefined). */
function layoutValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Keep `scrollTop` in step with the element's scroll position: committed in the scroll event
 * itself, after a move of `thresholdPx` or more, and handed to `onCommit` right away.
 *
 * Browsers dispatch scroll events once per frame, in the frame whose scroll position they report,
 * before its animation frame callbacks, layout and paint. Whatever `onCommit` renders therefore
 * shows in the frame that first shows the new position. Waiting for an animation frame, or for
 * the change detection a signal change schedules (a task or an animation frame after this one),
 * paints that frame with the rows of the previous position: blank space wherever a fast scroll
 * (a trackpad flick, a dragged scrollbar thumb) moved further than the overscan.
 */
export function bindScrollTopSignal(options: {
  element: HTMLElement;
  ngZone: NgZone;
  scrollTop: WritableSignal<number>;
  thresholdPx?: number;
  onCommit?: (scrollTop: number) => void;
}): () => void {
  const { element, ngZone, scrollTop, thresholdPx = 5, onCommit } = options;

  // The threshold is measured from the signal, not from this listener's last commit: the
  // signal is also set elsewhere (a resize re-reads the offset, programmatic scrolls set it).
  const onScroll = () => {
    const currentScrollTop = element.scrollTop;
    if (Math.abs(currentScrollTop - scrollTop()) < thresholdPx) {
      return;
    }
    scrollTop.set(currentScrollTop);
    onCommit?.(currentScrollTop);
  };

  ngZone.runOutsideAngular(() => {
    element.addEventListener('scroll', onScroll, { passive: true });
  });

  scrollTop.set(layoutValue(element.scrollTop));

  return () => {
    element.removeEventListener('scroll', onScroll);
  };
}

/**
 * Keep `height` in step with the height the element shows: its `clientHeight`, which counts its
 * padding (rows scroll through it too). Given `scrollTop`, also re-read the scroll
 * offset on every resize: an element shown again (`display: none` on an ancestor, an inactive
 * tab) or put back in the page gets its offset restored or reset without a `scroll` event, and
 * reads 0 while it has no layout box, so the scroll listener can miss or mis-read it. The
 * observer reports such an element at size 0 and again once it has a box, right after layout,
 * so the read forces no extra layout.
 *
 * The observer reports after the frame's layout and before its paint, so whatever `onCommit`
 * renders for a changed height or scroll position shows in that frame. Left to the change
 * detection the signal change schedules, a list shown again paints its first frame with the rows
 * it had while hidden (none in view), and a taller one with no rows where it grew.
 */
export function bindResizeObserverHeightSignal(options: {
  element: HTMLElement;
  ngZone: NgZone;
  height: WritableSignal<number>;
  minDeltaPx?: number;
  scrollTop?: WritableSignal<number>;
  onCommit?: () => void;
}): () => void {
  const { element, ngZone, height, minDeltaPx = 1, scrollTop, onCommit } = options;

  if (typeof ResizeObserver === 'undefined') {
    height.set(layoutValue(element.clientHeight));
    return () => undefined;
  }

  let observer: ResizeObserver | null = null;

  ngZone.runOutsideAngular(() => {
    observer = new ResizeObserver(() => {
      let changed = false;
      // The height the element shows (its padding box), as the first read below: rows scroll
      // through a scroll container's padding too, which the entry's content rect leaves out.
      // Read right after the layout the observer reports, so it forces none.
      const nextHeight = layoutValue(element.clientHeight);
      if (Math.abs(nextHeight - height()) > minDeltaPx) {
        height.set(nextHeight);
        changed = true;
      }
      if (scrollTop && element.scrollTop !== scrollTop()) {
        scrollTop.set(element.scrollTop);
        changed = true;
      }
      if (changed) {
        onCommit?.();
      }
    });
    observer.observe(element);
  });

  height.set(layoutValue(element.clientHeight));

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
