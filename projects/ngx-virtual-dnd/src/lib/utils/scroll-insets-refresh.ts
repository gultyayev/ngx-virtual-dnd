import { effect, inject, untracked } from '@angular/core';
import { AutoScrollService } from '../services/auto-scroll.service';
import { DragSchedulerService } from '../services/drag-scheduler.service';
import { PositionCalculatorService } from '../services/position-calculator.service';

/**
 * Keep a drag in progress in step with a scroll container's insets (call in an injection
 * context). A drag caches what it measured, so when the covered space changes (a sticky header
 * collapsing as the page scrolls) it measures the lists again, clamps the resting pointer again
 * and checks the autoscroll edges again. Each is a no-op without a drag.
 */
export function refreshDragOnScrollInsetChange(
  scrollInsetTop: () => number,
  scrollInsetBottom: () => number,
): void {
  const positionCalculator = inject(PositionCalculatorService);
  const scheduler = inject(DragSchedulerService);
  const autoScroll = inject(AutoScrollService);
  effect(() => {
    scrollInsetTop();
    scrollInsetBottom();
    untracked(() => {
      positionCalculator.invalidateDroppableRects();
      scheduler.requestUpdate();
      autoScroll.refresh();
    });
  });
}
