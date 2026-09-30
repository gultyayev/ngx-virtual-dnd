import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
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
