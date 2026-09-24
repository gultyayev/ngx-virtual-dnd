import { DynamicHeightStrategy } from './dynamic-height.strategy';

describe('DynamicHeightStrategy', () => {
  const ESTIMATED_HEIGHT = 50;

  let strategy: DynamicHeightStrategy;

  beforeEach(() => {
    strategy = new DynamicHeightStrategy(ESTIMATED_HEIGHT);
  });

  describe('getTotalHeight', () => {
    it('should return 0 for 0 items', () => {
      strategy.setItemKeys([]);
      expect(strategy.getTotalHeight(0)).toBe(0);
    });

    it('should use estimated height for all unmeasured items', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      // 3 * 50 = 150
      expect(strategy.getTotalHeight(3)).toBe(150);
    });

    it('should use measured heights where available', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 80);
      strategy.setMeasuredHeight('c', 30);
      // 80 + 50 + 30 = 160
      expect(strategy.getTotalHeight(3)).toBe(160);
    });

    it('should handle all items measured', () => {
      strategy.setItemKeys(['a', 'b']);
      strategy.setMeasuredHeight('a', 100);
      strategy.setMeasuredHeight('b', 60);
      // 100 + 60 = 160
      expect(strategy.getTotalHeight(2)).toBe(160);
    });

    it('should add estimated height for items beyond known keys', () => {
      strategy.setItemKeys(['a', 'b']);
      strategy.setMeasuredHeight('a', 100);
      strategy.setMeasuredHeight('b', 60);
      // (100 + 60) + 3 * 50 = 310
      expect(strategy.getTotalHeight(5)).toBe(310);
    });

    it('should handle partial itemCount (fewer than keys)', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd']);
      strategy.setMeasuredHeight('a', 100);
      strategy.setMeasuredHeight('b', 60);
      // First 2 items: 100 + 60 = 160
      expect(strategy.getTotalHeight(2)).toBe(160);
    });

    it('should use estimated height when no keys are set', () => {
      // No setItemKeys called, but requesting height for 5 items
      expect(strategy.getTotalHeight(5)).toBe(250);
    });
  });

  describe('getFirstVisibleIndex', () => {
    it('should return 0 for scrollTop 0', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.getFirstVisibleIndex(0)).toBe(0);
    });

    it('should return 0 when no keys are set', () => {
      expect(strategy.getFirstVisibleIndex(100)).toBe(0);
    });

    it('should find correct index with uniform estimated heights', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd', 'e']);
      // Offsets: 0, 50, 100, 150, 200 (all estimated at 50)
      expect(strategy.getFirstVisibleIndex(100)).toBe(2);
      expect(strategy.getFirstVisibleIndex(50)).toBe(1);
      expect(strategy.getFirstVisibleIndex(199)).toBe(3);
    });

    it('should find correct index with mixed heights', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd']);
      strategy.setMeasuredHeight('a', 100); // offset 0, bottom 100
      strategy.setMeasuredHeight('b', 30); // offset 100, bottom 130
      // c: estimated 50, offset 130, bottom 180
      // d: estimated 50, offset 180, bottom 230

      expect(strategy.getFirstVisibleIndex(0)).toBe(0);
      expect(strategy.getFirstVisibleIndex(99)).toBe(0);
      expect(strategy.getFirstVisibleIndex(100)).toBe(1);
      expect(strategy.getFirstVisibleIndex(129)).toBe(1);
      expect(strategy.getFirstVisibleIndex(130)).toBe(2);
    });

    it('should return last index when scrollTop is beyond content', () => {
      strategy.setItemKeys(['a', 'b']);
      // Total height = 100, last index = 1
      expect(strategy.getFirstVisibleIndex(500)).toBe(1);
    });
  });

  describe('getVisibleCount', () => {
    it('should return 0 for zero container height', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.getVisibleCount(0, 0)).toBe(0);
    });

    it('should return 0 for negative container height', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.getVisibleCount(0, -10)).toBe(0);
    });

    it('should count visible items with estimated heights', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd', 'e']);
      // 120px container: a, b, c (150px) fill it, plus 1 for the partially visible next item
      expect(strategy.getVisibleCount(0, 120)).toBe(4);
    });

    it('should handle container taller than content', () => {
      strategy.setItemKeys(['a', 'b']);
      // 2 items (100px) never fill the 500px container, and there is nothing after them
      expect(strategy.getVisibleCount(0, 500)).toBe(2);
    });

    it('should count from startIndex', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd', 'e']);
      // From c in an 80px container: c, d fill it, plus 1 partial (e)
      expect(strategy.getVisibleCount(2, 80)).toBe(3);
    });

    it('should skip excluded index', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd', 'e']);
      strategy.setExcludedIndex(1);
      // b is skipped: a, c, d fill the 120px container, plus 1 partial (e)
      expect(strategy.getVisibleCount(0, 120)).toBe(4);
    });

    it('should handle mixed measured heights', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 100);
      strategy.setMeasuredHeight('b', 20);
      // a (100) + b (20) fill the 110px container, plus 1 partial (c)
      expect(strategy.getVisibleCount(0, 110)).toBe(3);
    });
  });

  describe('getOffsetForIndex', () => {
    it('should return 0 for index 0', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.getOffsetForIndex(0)).toBe(0);
    });

    it('should calculate offset with estimated heights', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      // Offsets: 0, 50, 100
      expect(strategy.getOffsetForIndex(1)).toBe(50);
      expect(strategy.getOffsetForIndex(2)).toBe(100);
    });

    it('should calculate offset with measured heights', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 80);
      strategy.setMeasuredHeight('b', 30);
      // Offsets: 0, 80, 110
      expect(strategy.getOffsetForIndex(0)).toBe(0);
      expect(strategy.getOffsetForIndex(1)).toBe(80);
      expect(strategy.getOffsetForIndex(2)).toBe(110);
    });

    it('should return total height for index beyond bounds', () => {
      strategy.setItemKeys(['a', 'b']);
      strategy.setMeasuredHeight('a', 60);
      strategy.setMeasuredHeight('b', 40);
      // Total raw = 100
      expect(strategy.getOffsetForIndex(5)).toBe(100);
    });

    it('should subtract excluded item height for indices after excluded index', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd']);
      strategy.setMeasuredHeight('a', 40);
      strategy.setMeasuredHeight('b', 60);
      // Raw offsets: 0, 40, 100, 150
      // Exclude index 1 (height=60)
      strategy.setExcludedIndex(1);

      // index 0 (before excluded) => raw offset 0
      expect(strategy.getOffsetForIndex(0)).toBe(0);
      // index 1 (== excluded) => raw offset 40
      expect(strategy.getOffsetForIndex(1)).toBe(40);
      // index 2 (after excluded) => raw offset 100 - 60 = 40
      expect(strategy.getOffsetForIndex(2)).toBe(40);
      // index 3 (after excluded) => raw offset 150 - 60 = 90
      expect(strategy.getOffsetForIndex(3)).toBe(90);
    });
  });

  describe('findIndexAtOffset', () => {
    it('should return 0 for offset 0 with no exclusion', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.findIndexAtOffset(0)).toBe(0);
    });

    it('should return 0 for negative offset', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.findIndexAtOffset(-10)).toBe(0);
    });

    it('should return 0 when no keys are set', () => {
      expect(strategy.findIndexAtOffset(100)).toBe(0);
    });

    it('should find correct index with uniform heights', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd', 'e']);
      // Heights all 50. Offsets: 0,50,100,150,200. Bottoms: 50,100,150,200,250
      // findIndexAtOffset looks for first item whose bottom > offset
      expect(strategy.findIndexAtOffset(0)).toBe(0); // bottom 50 > 0
      expect(strategy.findIndexAtOffset(49)).toBe(0); // bottom 50 > 49
      expect(strategy.findIndexAtOffset(50)).toBe(1); // bottom 100 > 50
      expect(strategy.findIndexAtOffset(100)).toBe(2); // bottom 150 > 100
    });

    it('should find correct index with mixed heights', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 100);
      strategy.setMeasuredHeight('b', 30);
      // Offsets: 0, 100, 130. Bottoms: 100, 130, 180
      expect(strategy.findIndexAtOffset(0)).toBe(0);
      expect(strategy.findIndexAtOffset(99)).toBe(0);
      expect(strategy.findIndexAtOffset(100)).toBe(1);
      expect(strategy.findIndexAtOffset(129)).toBe(1);
      expect(strategy.findIndexAtOffset(130)).toBe(2);
    });

    it('should return item count for offset beyond all items', () => {
      strategy.setItemKeys(['a', 'b']);
      // Total height = 100. Offset 200 is beyond.
      expect(strategy.findIndexAtOffset(200)).toBe(2);
    });

    it('should handle excluded index at 0', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setExcludedIndex(0);
      // When offset <= 0 and excludedIndex === 0, return 1 (next valid index)
      expect(strategy.findIndexAtOffset(0)).toBe(1);
    });

    it('should handle non-finite offset', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.findIndexAtOffset(-Infinity)).toBe(0);
      expect(strategy.findIndexAtOffset(Infinity)).toBe(3);
      expect(strategy.findIndexAtOffset(NaN)).toBe(3);
    });

    it('should account for excluded item in binary search', () => {
      strategy.setItemKeys(['a', 'b', 'c', 'd']);
      strategy.setMeasuredHeight('a', 40);
      strategy.setMeasuredHeight('b', 60);
      strategy.setMeasuredHeight('c', 50);
      strategy.setMeasuredHeight('d', 50);
      // Raw offsets: 0, 40, 100, 150. Bottoms: 40, 100, 150, 200
      strategy.setExcludedIndex(1);
      // Excluded item b at offset 40, height 60

      // offset=0: since 0 < excludedOffset (40), search in [0, 0] => index 0
      expect(strategy.findIndexAtOffset(0)).toBe(0);

      // offset=39: < excludedOffset (40), search in [0, 0]
      // item 0 bottom = 40 > 39 => index 0
      expect(strategy.findIndexAtOffset(39)).toBe(0);

      // offset=40: >= excludedOffset, search in [2, 3] with offset + 60 = 100
      // item 2 bottom = 150 > 100 => index 2
      expect(strategy.findIndexAtOffset(40)).toBe(2);

      // offset=89: >= excludedOffset, search in [2, 3] with offset + 60 = 149
      // item 2 bottom = 150 > 149 => index 2
      expect(strategy.findIndexAtOffset(89)).toBe(2);

      // offset=90: search with 90+60=150, item 2 bottom=150, NOT > 150. item 3 bottom=200 > 150 => index 3
      expect(strategy.findIndexAtOffset(90)).toBe(3);
    });
  });

  describe('getItemCount', () => {
    it('should return 0 when no keys are set', () => {
      expect(strategy.getItemCount()).toBe(0);
    });

    it('should return the number of keys', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.getItemCount()).toBe(3);
    });

    it('should update when keys change', () => {
      strategy.setItemKeys(['a', 'b']);
      expect(strategy.getItemCount()).toBe(2);

      strategy.setItemKeys(['a', 'b', 'c', 'd']);
      expect(strategy.getItemCount()).toBe(4);
    });

    it('should not be affected by exclusion', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setExcludedIndex(1);
      // getItemCount returns raw count, not adjusted for exclusion
      expect(strategy.getItemCount()).toBe(3);
    });
  });

  describe('setExcludedIndex', () => {
    it('should bump version when excluded index changes', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      const v0 = strategy.version();

      strategy.setExcludedIndex(1);

      expect(strategy.version()).toBe(v0 + 1);
    });

    it('should not bump version when set to same value', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setExcludedIndex(1);
      const v = strategy.version();

      strategy.setExcludedIndex(1);

      expect(strategy.version()).toBe(v);
    });

    it('should bump version when clearing exclusion', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setExcludedIndex(1);
      const v = strategy.version();

      strategy.setExcludedIndex(null);

      expect(strategy.version()).toBe(v + 1);
    });

    it('should affect getOffsetForIndex calculations', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 40);

      const offsetWithout = strategy.getOffsetForIndex(2);

      strategy.setExcludedIndex(0);
      const offsetWith = strategy.getOffsetForIndex(2);

      // With exclusion of index 0 (height 40), offset for index 2 should decrease by 40
      expect(offsetWith).toBe(offsetWithout - 40);
    });
  });

  describe('setMeasuredHeight', () => {
    it('should bump version when height changes', () => {
      strategy.setItemKeys(['a']);
      const v0 = strategy.version();

      strategy.setMeasuredHeight('a', 80);

      expect(strategy.version()).toBe(v0 + 1);
    });

    it('should not bump version when height is unchanged', () => {
      strategy.setItemKeys(['a']);
      strategy.setMeasuredHeight('a', 80);
      const v = strategy.version();

      strategy.setMeasuredHeight('a', 80);

      expect(strategy.version()).toBe(v);
    });

    it('should update getItemHeight for the corresponding index', () => {
      strategy.setItemKeys(['a', 'b']);
      expect(strategy.getItemHeight(0)).toBe(ESTIMATED_HEIGHT);

      strategy.setMeasuredHeight('a', 120);

      expect(strategy.getItemHeight(0)).toBe(120);
      expect(strategy.getItemHeight(1)).toBe(ESTIMATED_HEIGHT);
    });

    it('should survive key reordering', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 80);
      strategy.setMeasuredHeight('c', 30);

      // Reorder keys
      strategy.setItemKeys(['c', 'b', 'a']);

      expect(strategy.getItemHeight(0)).toBe(30); // c
      expect(strategy.getItemHeight(1)).toBe(ESTIMATED_HEIGHT); // b (unmeasured)
      expect(strategy.getItemHeight(2)).toBe(80); // a
    });

    it('should affect total height calculations', () => {
      strategy.setItemKeys(['a', 'b']);
      expect(strategy.getTotalHeight(2)).toBe(100); // 50 + 50

      strategy.setMeasuredHeight('a', 200);
      expect(strategy.getTotalHeight(2)).toBe(250); // 200 + 50
    });
  });

  describe('getItemHeight', () => {
    it('should return estimated height for unmeasured item', () => {
      strategy.setItemKeys(['a']);
      expect(strategy.getItemHeight(0)).toBe(ESTIMATED_HEIGHT);
    });

    it('should return estimated height for out-of-bounds index', () => {
      strategy.setItemKeys(['a']);
      expect(strategy.getItemHeight(5)).toBe(ESTIMATED_HEIGHT);
      expect(strategy.getItemHeight(-1)).toBe(ESTIMATED_HEIGHT);
    });

    it('should return measured height', () => {
      strategy.setItemKeys(['a']);
      strategy.setMeasuredHeight('a', 120);
      expect(strategy.getItemHeight(0)).toBe(120);
    });
  });

  describe('setItemKeys', () => {
    it('should bump version when keys change', () => {
      const v0 = strategy.version();
      strategy.setItemKeys(['a', 'b']);
      expect(strategy.version()).toBe(v0 + 1);
    });

    it('should bump version when order changes', () => {
      strategy.setItemKeys(['a', 'b']);
      const v = strategy.version();

      strategy.setItemKeys(['b', 'a']);

      expect(strategy.version()).toBe(v + 1);
    });

    it('should not bump version when keys are unchanged', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      const v = strategy.version();

      strategy.setItemKeys(['a', 'b', 'c']);

      expect(strategy.version()).toBe(v);
    });

    it('should forget measured heights for removed keys and keep the rest', () => {
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('a', 80);
      strategy.setMeasuredHeight('b', 90);

      strategy.setItemKeys(['b']);
      // 'a' comes back: its old measurement must not be reused
      strategy.setItemKeys(['a', 'b']);

      expect(strategy.getItemHeight(0)).toBe(ESTIMATED_HEIGHT);
      expect(strategy.getItemHeight(1)).toBe(90);
    });
  });

  describe('version signal', () => {
    it('should start at 0', () => {
      expect(strategy.version()).toBe(0);
    });

    it('should increment monotonically', () => {
      strategy.setItemKeys(['a']);
      const v1 = strategy.version();

      strategy.setMeasuredHeight('a', 80);
      const v2 = strategy.version();

      strategy.setExcludedIndex(0);
      const v3 = strategy.version();

      expect(v2).toBe(v1 + 1);
      expect(v3).toBe(v2 + 1);
    });
  });
});
