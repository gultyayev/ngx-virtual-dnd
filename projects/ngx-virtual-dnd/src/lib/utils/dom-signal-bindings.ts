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
  let lastCommittedScrollTop = layoutValue(element.scrollTop);

  const onScroll = () => {
    if (pendingRaf !== null) {
      return;
    }

    const currentScrollTop = element.scrollTop;
    if (Math.abs(currentScrollTop - lastCommittedScrollTop) < thresholdPx) {
      return;
    }

    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      const finalScrollTop = element.scrollTop;
      if (Math.abs(finalScrollTop - lastCommittedScrollTop) >= thresholdPx) {
        lastCommittedScrollTop = finalScrollTop;
        scrollTop.set(finalScrollTop);
        onCommit?.(finalScrollTop);
      }
    });
  };

  ngZone.runOutsideAngular(() => {
    element.addEventListener('scroll', onScroll, { passive: true });
  });

  scrollTop.set(lastCommittedScrollTop);

  return () => {
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
    element.removeEventListener('scroll', onScroll);
  };
}

export function bindResizeObserverHeightSignal(options: {
  element: HTMLElement;
  ngZone: NgZone;
  height: WritableSignal<number>;
  minDeltaPx?: number;
}): () => void {
  const { element, ngZone, height, minDeltaPx = 1 } = options;

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
    });
    observer.observe(element);
  });

  height.set(layoutValue(element.clientHeight));

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
