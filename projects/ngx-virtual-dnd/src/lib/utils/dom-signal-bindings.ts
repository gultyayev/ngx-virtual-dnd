import { NgZone, type WritableSignal } from '@angular/core';

/** A layout value, or 0 where there is no layout (server rendering leaves them undefined). */
function layoutValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function bindRafThrottledScrollTopSignal(options: {
  element: HTMLElement;
  ngZone: NgZone;
  scrollTop: WritableSignal<number>;
  thresholdPx?: number;
  onCommit?: (scrollTop: number) => void;
}): () => void {
  const { element, ngZone, scrollTop, thresholdPx = 5, onCommit } = options;

  let pendingRaf: number | null = null;

  // The threshold is measured from the signal, not from this listener's last commit: the
  // signal is also set elsewhere (a resize re-reads the offset, programmatic scrolls set it).
  const onScroll = () => {
    if (pendingRaf !== null) {
      return;
    }

    const currentScrollTop = element.scrollTop;
    if (Math.abs(currentScrollTop - scrollTop()) < thresholdPx) {
      return;
    }

    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      const finalScrollTop = element.scrollTop;
      if (Math.abs(finalScrollTop - scrollTop()) >= thresholdPx) {
        scrollTop.set(finalScrollTop);
        onCommit?.(finalScrollTop);
      }
    });
  };

  ngZone.runOutsideAngular(() => {
    element.addEventListener('scroll', onScroll, { passive: true });
  });

  scrollTop.set(layoutValue(element.scrollTop));

  return () => {
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
    element.removeEventListener('scroll', onScroll);
  };
}

/**
 * Keep `height` in step with the element's height. Given `scrollTop`, also re-read the scroll
 * offset on every resize: an element shown again (`display: none` on an ancestor, an inactive
 * tab) or put back in the page gets its offset restored or reset without a `scroll` event, and
 * reads 0 while it has no layout box, so the scroll listener can miss or mis-read it. The
 * observer reports such an element at size 0 and again once it has a box, right after layout,
 * so the read forces no extra layout.
 */
export function bindResizeObserverHeightSignal(options: {
  element: HTMLElement;
  ngZone: NgZone;
  height: WritableSignal<number>;
  minDeltaPx?: number;
  scrollTop?: WritableSignal<number>;
}): () => void {
  const { element, ngZone, height, minDeltaPx = 1, scrollTop } = options;

  if (typeof ResizeObserver === 'undefined') {
    height.set(layoutValue(element.clientHeight));
    return () => undefined;
  }

  let observer: ResizeObserver | null = null;

  ngZone.runOutsideAngular(() => {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextHeight = entry.contentRect.height;
        if (Math.abs(nextHeight - height()) > minDeltaPx) {
          height.set(nextHeight);
        }
      }
      scrollTop?.set(element.scrollTop);
    });
    observer.observe(element);
  });

  height.set(layoutValue(element.clientHeight));

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
