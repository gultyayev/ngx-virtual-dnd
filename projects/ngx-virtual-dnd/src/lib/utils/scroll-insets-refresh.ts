import { afterNextRender, effect, inject, Injector, untracked } from '@angular/core';
import { AutoScrollService } from '../services/auto-scroll.service';
import { DragSchedulerService } from '../services/drag-scheduler.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { validScrollInset } from './scroll-insets';

/**
 * Keep a drag in progress in step with a scroll container's insets (call in an injection
 * context). A drag caches what it measured, so when the covered space changes (a sticky header
 * collapsing as the page scrolls) it measures the lists again, clamps the resting pointer again
 * and checks the autoscroll edges again, and a keyboard drag scrolls its placeholder into view
 * again, after the render that marks the element with the new insets. Each is a no-op without a
 * drag. Only a change in the space the drag reads as covered (see `validScrollInset`) does it:
 * an element created mid-drag with nothing covered changes nothing a drag measured.
 */
export function refreshDragOnScrollInsetChange(
  scrollInsetTop: () => number,
  scrollInsetBottom: () => number,
): void {
  const positionCalculator = inject(PositionCalculatorService);
  const scheduler = inject(DragSchedulerService);
  const autoScroll = inject(AutoScrollService);
  const keyboardDrag = inject(KeyboardDragService);
  const injector = inject(Injector);
  let covered = { top: 0, bottom: 0 };
  effect(() => {
    const top = validScrollInset(scrollInsetTop());
    const bottom = validScrollInset(scrollInsetBottom());
    if (top === covered.top && bottom === covered.bottom) {
      return;
    }
    covered = { top, bottom };
    untracked(() => {
      positionCalculator.invalidateDroppableRects();
      scheduler.requestUpdate();
      autoScroll.refresh();
      if (keyboardDrag.isActive()) {
        afterNextRender(() => keyboardDrag.revealPlaceholder(), { injector });
      }
    });
  });
}
