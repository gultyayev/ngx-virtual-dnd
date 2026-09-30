import { signal } from '@angular/core';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';

/**
 * Fixed-height virtual scroll strategy.
 *
 * Wraps the existing `index * itemHeight` math with zero overhead — no cache,
 * no measurement. This is the default strategy used when `dynamicItemHeight`
 * is not enabled.
 */
export class FixedHeightStrategy implements VirtualScrollStrategy {
  readonly #itemHeight: number;

  /** Excluded index during same-list drag (-1 = none) */
  #excludedIndex = -1;

  /** Logical item count from setItemKeys (used by drag index calculator) */
  #itemCount = 0;

  /** Version signal — bumps when exclusion changes */
  readonly #version = signal(0);
  readonly version = this.#version.asReadonly();

  constructor(itemHeight: number) {
    this.#itemHeight = itemHeight;
  }

  getTotalHeight(itemCount: number): number {
    return itemCount * this.#itemHeight;
  }

  getFirstVisibleIndex(scrollTop: number): number {
    if (this.#itemHeight <= 0) return 0;
    return Math.floor(scrollTop / this.#itemHeight);
  }

  getVisibleCount(_startIndex: number, containerHeight: number): number {
    if (containerHeight <= 0 || this.#itemHeight <= 0) return 0;
    return Math.ceil(containerHeight / this.#itemHeight);
  }

  getOffsetForIndex(index: number): number {
    if (this.#excludedIndex >= 0 && index > this.#excludedIndex) {
      return (index - 1) * this.#itemHeight;
    }
    return index * this.#itemHeight;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getItemHeight(index: number): number {
    return this.#itemHeight;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setMeasuredHeight(key: unknown, height: number): void {
    // No-op for fixed height strategy
  }

  setItemKeys(keys: unknown[]): void {
    this.setItemCount(keys.length);
  }

  /**
   * Set the item count: all this strategy needs of the keys, so the library's containers skip
   * computing them.
   * @internal
   */
  setItemCount(count: number): void {
    if (this.#itemCount !== count) {
      this.#itemCount = count;
      this.#version.update((v) => v + 1);
    }
  }

  setExcludedIndex(index: number | null): void {
    const newIndex = index ?? -1;
    if (this.#excludedIndex !== newIndex) {
      this.#excludedIndex = newIndex;
      this.#version.update((v) => v + 1);
    }
  }

  findIndexAtOffset(offset: number): number {
    if (this.#itemHeight <= 0) return 0;
    const visualIndex = Math.floor(offset / this.#itemHeight);
    // When an item is excluded (same-list drag), visual indices at or past
    // the excluded position map to logical index + 1
    if (this.#excludedIndex >= 0 && visualIndex >= this.#excludedIndex) {
      return visualIndex + 1;
    }
    return visualIndex;
  }

  getItemCount(): number {
    return this.#itemCount;
  }
}
