/**
 * Cache for measured item heights in dynamic virtual scrolling.
 *
 * Tracks heights by trackBy key (survives reordering). Maintains a cumulative
 * offset prefix-sum array and binary searches it for scroll-to-index lookups.
 *
 * The prefix sums are brought up to date lazily and only as far as a lookup needs:
 * a height change invalidates the offsets from that item on, and the next lookup
 * recomputes them up to the item it asks about. Measurements land on the rendered
 * rows and lookups ask about the rows in view, so while scrolling a long list each
 * frame recomputes a few rows' offsets instead of the whole list. The total height
 * is kept as a running sum, so the spacer height needs no prefix sums between key
 * changes.
 *
 * This is a plain class (not a service) — one instance per virtual scroll.
 */
export class HeightCache {
  /** Estimated height used for unmeasured items */
  readonly #estimatedHeight: number;

  /** Map from trackBy key to measured height */
  readonly #heightsByKey = new Map<unknown, number>();

  /** Current ordered list of trackBy keys (index-aligned with item array) */
  #keys: unknown[] = [];

  /** Index of each key's first occurrence in `#keys` */
  #firstIndexByKey = new Map<unknown, number>();

  /** Whether a key occurs more than once in `#keys` (a trackBy misconfiguration) */
  #hasDuplicateKeys = false;

  /** Prefix sums: offsets[i] = cumulative height of items 0..i-1 */
  #offsets: number[] = [];

  /** Number of leading `#offsets` entries that are up to date */
  #validCount = 0;

  /** Sum of the heights of all items in `#keys`, or null until it is next needed */
  #totalHeight: number | null = 0;

  /** Index excluded during same-list drag (-1 = none) */
  #excludedIndex = -1;

  constructor(estimatedHeight: number) {
    this.#estimatedHeight = estimatedHeight;
  }

  /** Number of measured items */
  get measuredCount(): number {
    return this.#heightsByKey.size;
  }

  /** Number of logical items in the cache */
  get itemCount(): number {
    return this.#keys.length;
  }

  /**
   * Update the ordered list of trackBy keys.
   * This must be called whenever items change order or the array changes.
   */
  setKeys(keys: unknown[]): boolean {
    const sameOrder =
      keys.length === this.#keys.length &&
      keys.every((key, index) => Object.is(key, this.#keys[index]));

    // Filled from the end, so each key keeps its first index. It also serves as the set of keys
    // for pruning, so building it costs no extra pass.
    const firstIndexByKey = new Map<unknown, number>();
    for (let i = keys.length - 1; i >= 0; i--) {
      firstIndexByKey.set(keys[i], i);
    }
    let pruned = false;
    for (const key of this.#heightsByKey.keys()) {
      if (!firstIndexByKey.has(key)) {
        this.#heightsByKey.delete(key);
        pruned = true;
      }
    }

    if (sameOrder && !pruned) {
      return false;
    }

    // Offsets before the first key that changed position are still valid. An array changed in
    // place can't be compared with its old contents, so nothing counts as kept then.
    let firstChanged = 0;
    const commonLength = keys === this.#keys ? 0 : Math.min(keys.length, this.#keys.length);
    while (firstChanged < commonLength && Object.is(keys[firstChanged], this.#keys[firstChanged])) {
      firstChanged++;
    }

    this.#keys = keys;
    this.#firstIndexByKey = firstIndexByKey;
    this.#hasDuplicateKeys = firstIndexByKey.size < keys.length;
    this.#offsets.length = keys.length;
    this.#validCount = Math.min(this.#validCount, firstChanged);
    this.#totalHeight = null;
    return true;
  }

  /**
   * Record a measured height for a trackBy key.
   * @returns true if the height actually changed (triggers version bump)
   */
  setHeight(key: unknown, height: number): boolean {
    const existing = this.#heightsByKey.get(key);
    if (existing === height) return false;
    this.#heightsByKey.set(key, height);

    // Only items at or after the key's first position move
    const firstIndex = this.#firstIndexByKey.get(key);
    if (firstIndex !== undefined) {
      this.#validCount = Math.min(this.#validCount, firstIndex);
      const previous = existing ?? this.#estimatedHeight;
      // A key listed twice, or a non-finite height (which a running sum can't take back out),
      // leaves the total to be recomputed from the offsets
      this.#totalHeight =
        this.#totalHeight === null ||
        this.#hasDuplicateKeys ||
        !Number.isFinite(height) ||
        !Number.isFinite(previous)
          ? null
          : this.#totalHeight + height - previous;
    }
    return true;
  }

  /**
   * Get the height for a specific index.
   * Returns measured height if available, otherwise the estimated height.
   */
  getHeight(index: number): number {
    if (index < 0 || index >= this.#keys.length) return this.#estimatedHeight;
    const key = this.#keys[index];
    return this.#heightsByKey.get(key) ?? this.#estimatedHeight;
  }

  /**
   * Get the pixel offset (top position) for a given item index.
   * Accounts for the excluded index during same-list drag.
   */
  getOffset(index: number): number {
    const count = this.#keys.length;

    if (this.#excludedIndex < 0) {
      // No exclusion — direct lookup
      return index < count ? this.#offsetAt(index) : this.#getExactTotalHeight();
    }

    // With exclusion: subtract the excluded item's height from offsets
    // at or after the excluded index
    if (index <= this.#excludedIndex) {
      return this.#offsetAt(index) ?? 0;
    }

    // index > excludedIndex: offset = raw offset for (index) minus excluded item's height
    const rawOffset = index < count ? this.#offsetAt(index) : this.#getExactTotalHeight();
    const excludedHeight = this.getHeight(this.#excludedIndex);
    return rawOffset - excludedHeight;
  }

  /**
   * Get total content height for all items.
   * Does NOT exclude the dragged item — the spacer must maintain full height
   * during same-list drag so sibling content (footers etc.) doesn't shift.
   * Uses O(1) prefix-sum lookup when possible.
   */
  getTotalHeight(itemCount: number): number {
    if (itemCount <= 0) return 0;

    const keyCount = this.#keys.length;
    if (keyCount === 0) return itemCount * this.#estimatedHeight;

    if (itemCount >= keyCount) {
      // All known items + estimated for any extras
      return this.#getTotalHeightRaw() + (itemCount - keyCount) * this.#estimatedHeight;
    }

    // Partial: prefix sum up to itemCount
    return this.#offsetAt(itemCount - 1) + this.getHeight(itemCount - 1);
  }

  /**
   * Find the first visible index for a given scrollTop.
   * Uses binary search on the prefix-sum offsets (excluding the excluded item).
   */
  findFirstVisibleIndex(scrollTop: number): number {
    const count = this.#keys.length;
    if (count === 0) return 0;

    // Offsets after the excluded item sit its height higher than their raw values, so
    // bring the raw offsets up to date just past scrollTop plus that height
    const excludedHeight = this.#excludedIndex >= 0 ? this.getHeight(this.#excludedIndex) : 0;
    this.#extendPastOffset(scrollTop + excludedHeight);

    // Binary search for the last item whose top is at or above scrollTop. Items past the
    // up-to-date offsets start below scrollTop, so the search can stop there.
    let lo = 0;
    let hi = Math.min(count, this.#validCount) - 1;
    let result = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const offset = this.getOffset(mid);
      if (offset <= scrollTop) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result;
  }

  /**
   * Count visible items from startIndex within containerHeight.
   */
  getVisibleCount(startIndex: number, containerHeight: number): number {
    if (containerHeight <= 0) return 0;

    const count = this.#keys.length;
    let accumulated = 0;
    let visible = 0;
    let stopIndex = count;

    for (let i = startIndex; i < count; i++) {
      if (i === this.#excludedIndex) continue;
      accumulated += this.getHeight(i);
      visible++;
      if (accumulated >= containerHeight) {
        stopIndex = i;
        break;
      }
    }

    // Add 1 for partially visible items
    if (visible === 0) return 0;
    const hasMoreItems = stopIndex < count - 1;
    return hasMoreItems ? visible + 1 : visible;
  }

  /**
   * Find the item index at a given pixel offset.
   * Used for drag index calculations with variable heights.
   */
  findIndexAtOffset(offset: number): number {
    const count = this.#keys.length;
    if (count === 0) return 0;

    if (!Number.isFinite(offset)) {
      return offset < 0 ? 0 : count;
    }

    if (offset <= 0) {
      if (this.#excludedIndex === 0) {
        return count > 1 ? 1 : count;
      }
      return 0;
    }

    const excludedIndex = this.#excludedIndex;
    if (excludedIndex < 0 || excludedIndex >= count) {
      return this.#findFirstIndexWithBottomPastOffset(offset, 0, count - 1);
    }

    const excludedOffset = this.#offsetAt(excludedIndex);
    if (offset < excludedOffset && excludedIndex > 0) {
      return this.#findFirstIndexWithBottomPastOffset(offset, 0, excludedIndex - 1);
    }

    if (excludedIndex >= count - 1) {
      return count;
    }

    const excludedHeight = this.getHeight(excludedIndex);
    return this.#findFirstIndexWithBottomPastOffset(
      offset + excludedHeight,
      excludedIndex + 1,
      count - 1,
    );
  }

  /**
   * Set the excluded index for same-list drag.
   */
  setExcludedIndex(index: number | null): boolean {
    const nextIndex = index ?? -1;
    if (this.#excludedIndex === nextIndex) {
      return false;
    }

    this.#excludedIndex = nextIndex;
    return true;
  }

  /**
   * Find first logical index in [start, end] whose bottom edge is past offset.
   * Returns one-past-end when no match is found.
   */
  #findFirstIndexWithBottomPastOffset(offset: number, start: number, end: number): number {
    if (start > end) {
      return start;
    }

    // Items past the up-to-date offsets start below `offset`, so their bottoms are past it
    // too: the answer is at or before the first of them
    this.#extendPastOffset(offset);
    const lastValid = this.#validCount - 1;
    if (start > lastValid) {
      return start;
    }

    let lo = start;
    let hi = Math.min(end, lastValid);
    let result = end + 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midBottom = this.#offsets[mid] + this.getHeight(mid);

      if (midBottom > offset) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return result;
  }

  /**
   * Raw total height without exclusion, from the running sum. With fractional heights it can
   * differ from the prefix sums by rounding, so it is only for the spacer height.
   */
  #getTotalHeightRaw(): number {
    if (this.#keys.length === 0) return 0;
    return this.#totalHeight ?? this.#getExactTotalHeight();
  }

  /**
   * Raw total height computed like the offsets (the offset one past the last item), so it
   * compares exactly with them. Re-syncs the running sum.
   */
  #getExactTotalHeight(): number {
    const count = this.#keys.length;
    if (count === 0) return 0;
    this.#extendTo(count, Infinity);
    this.#totalHeight = this.#offsets[count - 1] + this.getHeight(count - 1);
    return this.#totalHeight;
  }

  /** The raw offset of an item, bringing the prefix sums up to date as far as it */
  #offsetAt(index: number): number {
    if (index >= this.#validCount) {
      this.#extendTo(index + 1, Infinity);
    }
    return this.#offsets[index];
  }

  /**
   * Bring the prefix sums up to date until the last up-to-date item starts past `offset`, or
   * to the end of the list.
   */
  #extendPastOffset(offset: number): void {
    this.#extendTo(this.#keys.length, offset);
  }

  /**
   * Bring the first `count` prefix sums up to date, stopping early after the first item that
   * starts past `stopPastOffset`.
   */
  #extendTo(count: number, stopPastOffset: number): void {
    const end = Math.min(count, this.#keys.length);
    let i = this.#validCount;
    if (i >= end || (i > 0 && this.#offsets[i - 1] > stopPastOffset)) {
      return;
    }

    let cumulative = i === 0 ? 0 : this.#offsets[i - 1] + this.getHeight(i - 1);
    while (i < end) {
      this.#offsets[i] = cumulative;
      i++;
      if (cumulative > stopPastOffset) {
        break;
      }
      cumulative += this.getHeight(i - 1);
    }
    this.#validCount = i;

    if (i === this.#keys.length) {
      // Re-sync the running total with the prefix sums, dropping floating-point drift
      this.#totalHeight = this.#offsets[i - 1] + this.getHeight(i - 1);
    }
  }
}
