import { HeightCache } from './height-cache';

/**
 * A reference model of HeightCache's lookups that recomputes every offset from scratch on each
 * call. HeightCache keeps its prefix sums up to date lazily (only as far as a lookup needs), so
 * this checks that it never answers from stale offsets.
 */
class ReferenceHeights {
  keys: unknown[] = [];
  readonly heights = new Map<unknown, number>();
  excluded = -1;

  constructor(readonly estimated: number) {}

  height(index: number): number {
    if (index < 0 || index >= this.keys.length) return this.estimated;
    return this.heights.get(this.keys[index]) ?? this.estimated;
  }

  raw(index: number): number {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += this.height(i);
    return sum;
  }

  total(): number {
    return this.raw(this.keys.length);
  }

  getOffset(index: number): number {
    const count = this.keys.length;
    if (this.excluded < 0) return index < count ? this.raw(index) : this.total();
    if (index <= this.excluded) return index < count ? this.raw(index) : 0;
    return (index < count ? this.raw(index) : this.total()) - this.height(this.excluded);
  }

  getTotalHeight(itemCount: number): number {
    const count = this.keys.length;
    if (itemCount <= 0) return 0;
    if (count === 0) return itemCount * this.estimated;
    if (itemCount >= count) return this.total() + (itemCount - count) * this.estimated;
    return this.raw(itemCount - 1) + this.height(itemCount - 1);
  }

  findFirstVisibleIndex(scrollTop: number): number {
    let result = 0;
    for (let i = 0; i < this.keys.length; i++) {
      if (this.getOffset(i) <= scrollTop) result = i;
    }
    return result;
  }

  findIndexAtOffset(offset: number): number {
    const count = this.keys.length;
    const e = this.excluded;
    if (count === 0) return 0;
    if (!Number.isFinite(offset)) return offset < 0 ? 0 : count;
    if (offset <= 0) return e === 0 ? (count > 1 ? 1 : count) : 0;
    if (e < 0 || e >= count) return this.#firstBottomPast(offset, 0, count - 1);
    if (offset < this.raw(e) && e > 0) return this.#firstBottomPast(offset, 0, e - 1);
    if (e >= count - 1) return count;
    return this.#firstBottomPast(offset + this.height(e), e + 1, count - 1);
  }

  #firstBottomPast(offset: number, start: number, end: number): number {
    if (start > end) return start;
    for (let i = start; i <= end; i++) {
      if (this.raw(i) + this.height(i) > offset) return i;
    }
    return end + 1;
  }
}

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('HeightCache', () => {
  const ESTIMATED = 50;
  const keysFor = (count: number, prefix = 'k'): string[] =>
    Array.from({ length: count }, (_, i) => `${prefix}${i}`);

  /** Offsets of every item plus the total, read through the public API. */
  function offsetsOf(cache: HeightCache): number[] {
    return Array.from({ length: cache.itemCount + 1 }, (_, i) => cache.getOffset(i));
  }

  describe('after a lookup, a height change', () => {
    let cache: HeightCache;
    const keys = keysFor(10);

    beforeEach(() => {
      cache = new HeightCache(ESTIMATED);
      cache.setKeys(keys);
      keys.forEach((key, i) => cache.setHeight(key, 10 + i));
      // Bring every offset up to date first, so the change below must invalidate some of them
      expect(cache.getOffset(10)).toBe(145);
    });

    it.each([
      ['at the start', 0],
      ['in the middle', 5],
      ['at the end', 9],
    ])('%s moves the offsets after it and the total', (_where, index) => {
      cache.setHeight(keys[index], 100);

      const heights = keys.map((_, i) => (i === index ? 100 : 10 + i));
      const expected = heights.reduce<number[]>((acc, h) => [...acc, acc[acc.length - 1] + h], [0]);
      expect(offsetsOf(cache)).toEqual(expected);
      expect(cache.getTotalHeight(10)).toBe(expected[10]);
    });

    it('is seen by a search that only reads the offsets before it was asked', () => {
      // A lookup near the top leaves the offsets further down out of date
      expect(cache.findFirstVisibleIndex(25)).toBe(2);
      cache.setHeight(keys[1], 111);

      // Item 2 now starts at 10 + 111 = 121 and item 1 covers 10..121
      expect(cache.findFirstVisibleIndex(120)).toBe(1);
      expect(cache.findFirstVisibleIndex(121)).toBe(2);
      expect(cache.findIndexAtOffset(120)).toBe(1);
      expect(cache.getTotalHeight(10)).toBe(145 - 11 + 111);
    });

    it('keeps offsets right while an item is excluded (same-list drag)', () => {
      cache.setExcludedIndex(3);
      expect(cache.getOffset(5)).toBe(10 + 11 + 12 + 14);

      cache.setHeight(keys[3], 40);
      cache.setHeight(keys[1], 21);

      // The excluded item's own height no longer counts after it
      expect(cache.getOffset(3)).toBe(10 + 21 + 12);
      expect(cache.getOffset(5)).toBe(10 + 21 + 12 + 14);
      expect(cache.findFirstVisibleIndex(10 + 21 + 12 + 14)).toBe(5);
      // The spacer keeps every item, the excluded one included
      expect(cache.getTotalHeight(10)).toBe(145 + (40 - 13) + (21 - 11));
    });
  });

  describe('keys', () => {
    it('keeps the offsets right when items are appended', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(keysFor(3));
      cache.setHeight('k1', 20);
      expect(cache.getOffset(3)).toBe(120);

      cache.setKeys(keysFor(5));

      expect(offsetsOf(cache)).toEqual([0, 50, 70, 120, 170, 220]);
    });

    it('keeps the offsets right when items are reordered or removed', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(['a', 'b', 'c', 'd']);
      cache.setHeight('a', 10);
      cache.setHeight('b', 20);
      cache.setHeight('c', 30);
      cache.setHeight('d', 40);
      expect(cache.getOffset(4)).toBe(100);

      cache.setKeys(['a', 'd', 'b']);

      expect(offsetsOf(cache)).toEqual([0, 10, 50, 70]);
      expect(cache.measuredCount).toBe(3);
    });

    it('counts a key listed twice at both positions', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(['a', 'b', 'a']);
      expect(cache.getTotalHeight(3)).toBe(150);

      cache.setHeight('a', 10);

      expect(offsetsOf(cache)).toEqual([0, 10, 60, 70]);
      expect(cache.getTotalHeight(3)).toBe(70);
    });

    it('does not move any offset for a height recorded for a key not in the list', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(['a', 'b']);
      expect(cache.getOffset(2)).toBe(100);

      expect(cache.setHeight('elsewhere', 999)).toBe(true);

      expect(offsetsOf(cache)).toEqual([0, 50, 100]);
    });
  });

  describe('unusual input', () => {
    it('finds the last of several rows that start at the same offset (height 0)', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(['a', 'b', 'c', 'd']);
      cache.setHeight('b', 0);
      cache.setHeight('c', 0);

      // b, c and d all start at 50
      expect(cache.findFirstVisibleIndex(50)).toBe(3);
      expect(cache.findIndexAtOffset(50)).toBe(3);
    });

    it('recovers the total after a non-finite height', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(['a', 'b', 'c']);
      expect(cache.getTotalHeight(3)).toBe(150);

      cache.setHeight('b', Infinity);
      cache.setHeight('b', 10);

      expect(cache.getTotalHeight(3)).toBe(110);
      expect(cache.getOffset(3)).toBe(110);
    });

    it('reads an offset before the first item as 0 while an item is excluded', () => {
      const cache = new HeightCache(ESTIMATED);
      cache.setKeys(keysFor(10));
      cache.setExcludedIndex(5);

      expect(cache.getOffset(-1)).toBe(0);
    });

    it('recomputes every offset when the same keys array is changed in place', () => {
      const cache = new HeightCache(ESTIMATED);
      const keys = ['a', 'b', 'c', 'd'];
      cache.setKeys(keys);
      keys.forEach((key, i) => cache.setHeight(key, 10 * (i + 1)));
      expect(cache.getOffset(4)).toBe(100);

      keys.splice(0, 1);
      cache.setKeys(keys);

      expect(offsetsOf(cache)).toEqual([0, 20, 50, 90]);
      expect(cache.getTotalHeight(3)).toBe(90);
    });
  });

  describe('against a reference that recomputes every offset', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'answers every lookup the same through random changes (seed %i)',
      (seed) => {
        const next = random(seed);
        const int = (max: number): number => Math.floor(next() * max);
        const cache = new HeightCache(ESTIMATED);
        const reference = new ReferenceHeights(ESTIMATED);
        let keys = keysFor(30);
        let fresh = 0;
        cache.setKeys(keys);
        reference.keys = keys;

        for (let step = 0; step < 400; step++) {
          const action = int(10);
          if (action < 5) {
            // Measure an item (sometimes one that is not in the list)
            const key = int(8) === 0 ? `gone${int(5)}` : keys[int(keys.length)];
            // Some rows measure 0 (hidden or empty)
            const height = int(10) === 0 ? 0 : 1 + int(120);
            expect(cache.setHeight(key, height)).toBe(reference.heights.get(key) !== height);
            reference.heights.set(key, height);
          } else if (action < 7) {
            // Change the list: append, remove, move or replace items
            keys = [...keys];
            const change = int(4);
            if (change === 0) keys.push(`n${fresh++}`);
            else if (change === 1 && keys.length > 1) keys.splice(int(keys.length), 1);
            else if (change === 2)
              keys.splice(int(keys.length), 0, ...keys.splice(int(keys.length), 1));
            else keys[int(keys.length)] = `n${fresh++}`;
            const sameOrder =
              keys.length === reference.keys.length &&
              keys.every((key, i) => key === reference.keys[i]);
            let pruned = false;
            for (const key of [...reference.heights.keys()]) {
              if (!keys.includes(key as string)) {
                reference.heights.delete(key);
                pruned = true;
              }
            }
            expect(cache.setKeys(keys)).toBe(!(sameOrder && !pruned));
            reference.keys = keys;
          } else if (action < 8) {
            const excluded = int(3) === 0 ? null : int(keys.length + 1);
            expect(cache.setExcludedIndex(excluded)).toBe((excluded ?? -1) !== reference.excluded);
            reference.excluded = excluded ?? -1;
          }

          // Often several changes land before the next lookup
          if (int(3) !== 0) continue;

          // Look things up at random points, as rendering and drag hit-testing do
          const total = reference.total();
          // Half the lookups land exactly on a row's top, where rows of height 0 share an offset
          const offset =
            int(2) === 0 ? reference.getOffset(int(keys.length + 1)) : next() * (total + 200) - 50;
          const index = int(keys.length + 3);
          const context = `seed ${seed}, step ${step}`;
          expect([context, cache.getOffset(index)]).toEqual([context, reference.getOffset(index)]);
          expect([context, cache.getTotalHeight(index)]).toEqual([
            context,
            reference.getTotalHeight(index),
          ]);
          expect([context, cache.findFirstVisibleIndex(offset)]).toEqual([
            context,
            reference.findFirstVisibleIndex(offset),
          ]);
          expect([context, cache.findIndexAtOffset(offset)]).toEqual([
            context,
            reference.findIndexAtOffset(offset),
          ]);
        }
      },
    );

    it('keeps the offset past the last item exactly equal to the prefix sums', () => {
      // Browsers report heights in fractions of a pixel (1/60 px in Firefox), whose sums round.
      // Drag hit-testing compares the offsets around a dragged last item, so the offset past it
      // must be computed like the others, not from the running total.
      const next = random(7);
      const cache = new HeightCache(ESTIMATED);
      const keys = keysFor(40);
      cache.setKeys(keys);
      cache.setExcludedIndex(39);

      for (let step = 0; step < 500; step++) {
        cache.setHeight(
          keys[Math.floor(next() * keys.length)],
          20 + Math.floor(next() * 4800) / 60,
        );
        cache.getTotalHeight(40);

        // The excluded last item takes no space: nothing after it
        expect([step, cache.getOffset(40) <= cache.getOffset(39)]).toEqual([step, true]);
      }
    });

    it('keeps the running total within rounding of the offsets with fractional heights', () => {
      const next = random(42);
      const cache = new HeightCache(ESTIMATED);
      const reference = new ReferenceHeights(ESTIMATED);
      const keys = keysFor(200);
      cache.setKeys(keys);
      reference.keys = keys;

      for (let step = 0; step < 2000; step++) {
        const key = keys[Math.floor(next() * keys.length)];
        const height = 20 + next() * 80;
        cache.setHeight(key, height);
        reference.heights.set(key, height);
      }

      expect(cache.getTotalHeight(200)).toBeCloseTo(reference.total(), 6);
      expect(cache.getOffset(150)).toBeCloseTo(reference.raw(150), 6);
    });
  });
});
