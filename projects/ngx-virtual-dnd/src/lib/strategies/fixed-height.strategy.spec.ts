import { FixedHeightStrategy } from './fixed-height.strategy';

describe('FixedHeightStrategy', () => {
  let strategy: FixedHeightStrategy;

  beforeEach(() => {
    strategy = new FixedHeightStrategy(50);
  });

  it('should compute total height and visible range from the item height', () => {
    expect(strategy.getTotalHeight(10)).toBe(500);
    expect(strategy.getFirstVisibleIndex(125)).toBe(2);
    expect(strategy.getVisibleCount(0, 120)).toBe(3);
    expect(strategy.getVisibleCount(0, 0)).toBe(0);
  });

  it('should not shrink total height while an item is excluded', () => {
    strategy.setExcludedIndex(3);

    expect(strategy.getTotalHeight(10)).toBe(500);
  });

  describe('getOffsetForIndex', () => {
    it('should place items at index * itemHeight', () => {
      expect(strategy.getOffsetForIndex(0)).toBe(0);
      expect(strategy.getOffsetForIndex(4)).toBe(200);
    });

    it('should collapse the excluded slot for the items after it', () => {
      strategy.setExcludedIndex(2);

      expect(strategy.getOffsetForIndex(1)).toBe(50);
      expect(strategy.getOffsetForIndex(2)).toBe(100);
      expect(strategy.getOffsetForIndex(3)).toBe(100);
      expect(strategy.getOffsetForIndex(4)).toBe(150);
    });
  });

  describe('findIndexAtOffset', () => {
    it('should map offsets to indexes', () => {
      expect(strategy.findIndexAtOffset(0)).toBe(0);
      expect(strategy.findIndexAtOffset(49)).toBe(0);
      expect(strategy.findIndexAtOffset(50)).toBe(1);
    });

    it('should skip the excluded index at and after its visual slot', () => {
      strategy.setExcludedIndex(2);

      expect(strategy.findIndexAtOffset(60)).toBe(1);
      // Visual slot 2 is now occupied by logical item 3
      expect(strategy.findIndexAtOffset(110)).toBe(3);
      expect(strategy.findIndexAtOffset(160)).toBe(4);
    });
  });

  describe('version', () => {
    it('should bump only when the excluded index actually changes', () => {
      const v0 = strategy.version();

      strategy.setExcludedIndex(1);
      strategy.setExcludedIndex(1);
      expect(strategy.version()).toBe(v0 + 1);

      strategy.setExcludedIndex(null);
      expect(strategy.version()).toBe(v0 + 2);
    });

    it('should bump only when the item count changes', () => {
      strategy.setItemKeys(['a', 'b']);
      const v = strategy.version();

      strategy.setItemKeys(['b', 'a']);
      expect(strategy.version()).toBe(v);
      expect(strategy.getItemCount()).toBe(2);

      strategy.setItemKeys(['a', 'b', 'c']);
      expect(strategy.version()).toBe(v + 1);
      expect(strategy.getItemCount()).toBe(3);
    });
  });
});
