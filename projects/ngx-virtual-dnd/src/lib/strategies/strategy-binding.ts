import { effect, inject } from '@angular/core';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { DynamicHeightStrategy } from './dynamic-height.strategy';
import { FixedHeightStrategy } from './fixed-height.strategy';

/**
 * Give a list's strategy its items: `count` of them, with the track keys `keys` returns (the
 * list's own array, which it goes on reading).
 *
 * - FixedHeightStrategy's `setItemKeys` only counts the keys: it gets the count, and the keys are
 *   never computed.
 * - DynamicHeightStrategy's copies the keys: it gets the list's array.
 * - Any other `setItemKeys` (a strategy of the consumer's own, or a subclass that overrides it)
 *   gets a copy, which it may keep and change.
 * @internal
 */
export function setStrategyItems(
  strategy: VirtualScrollStrategy,
  count: number,
  keys: () => unknown[],
): void {
  if (
    strategy instanceof FixedHeightStrategy &&
    strategy.setItemKeys === FixedHeightStrategy.prototype.setItemKeys
  ) {
    strategy.setItemCount(count);
  } else if (
    strategy instanceof DynamicHeightStrategy &&
    strategy.setItemKeys === DynamicHeightStrategy.prototype.setItemKeys
  ) {
    strategy.setItemKeys(keys());
  } else {
    strategy.setItemKeys(keys().slice());
  }
}

/**
 * The strategy for rows of `itemHeight` px: measured per row when `dynamicItemHeight`, otherwise
 * fixed (`itemHeight` is then every row's height, and the dynamic strategy's estimate).
 * @internal
 */
export function createHeightStrategy(
  itemHeight: number,
  dynamicItemHeight: boolean,
): VirtualScrollStrategy {
  return dynamicItemHeight
    ? new DynamicHeightStrategy(itemHeight)
    : new FixedHeightStrategy(itemHeight);
}

/** What a virtual list hands `bindListStrategy`, all read reactively */
export interface ListStrategySource {
  /** The list's strategy; replaced when its height inputs change */
  strategy: () => VirtualScrollStrategy;
  /** The number of items */
  itemCount: () => number;
  /** The items' track keys; only read when the strategy needs them (see `setStrategyItems`) */
  itemKeys: () => unknown[];
  /** The list's droppable ID, if it is one */
  droppableId: () => string | null | undefined;
  /** The dragged item's index while the drag is from this list, otherwise -1 */
  excludedIndex: () => number;
}

/**
 * Keep a virtual list's strategy in step with the list, in three effects (call it from the
 * constructor of `vdnd-virtual-scroll` or `*vdndVirtualFor`, before the effects that render
 * rows, which read the strategy these update):
 *
 * 1. Items: the strategy gets the item count, or their keys (see `setStrategyItems`). Kept apart
 *    from the exclusion, so a drag starting or ending never enumerates the keys again.
 * 2. Registration: drag code finds the strategy by the list's droppable ID
 *    (`DragIndexCalculatorService`). A changed ID or strategy unregisters the old one.
 * 3. Exclusion: during a drag from this list, the strategy closes up the dragged item's slot
 *    (`setExcludedIndex`); the total height keeps it.
 * @internal
 */
export function bindListStrategy(source: ListStrategySource): void {
  const dragIndexCalculator = inject(DragIndexCalculatorService);

  effect(() => {
    setStrategyItems(source.strategy(), source.itemCount(), source.itemKeys);
  });

  effect((onCleanup) => {
    const droppableId = source.droppableId();
    const strategy = source.strategy();
    if (droppableId) {
      dragIndexCalculator.registerStrategy(droppableId, strategy);
      onCleanup(() => dragIndexCalculator.unregisterStrategy(droppableId));
    }
  });

  effect(() => {
    const strategy = source.strategy();
    const excludedIndex = source.excludedIndex();
    strategy.setExcludedIndex(excludedIndex >= 0 ? excludedIndex : null);
  });
}
