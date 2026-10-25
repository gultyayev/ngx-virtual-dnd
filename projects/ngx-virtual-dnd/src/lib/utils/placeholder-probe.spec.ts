import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';
import { type PlaceholderProbe, probePlaceholderIndex } from './placeholder-probe';

describe('probePlaceholderIndex', () => {
  // A list whose rows start at viewport Y 100, not scrolled, with 50px rows
  const probe = (overrides: Partial<PlaceholderProbe>): PlaceholderProbe => ({
    previewTopY: 100,
    previewHeight: 50,
    itemHeight: 50,
    listTopY: 100,
    scrollTop: 0,
    strategy: null,
    sourceIndex: null,
    ...overrides,
  });

  describe('without a strategy (rows of the item height)', () => {
    it('finds the slot under the preview center', () => {
      // Center at 100 + 60 + 25 = 185: the row from 150 to 200, slot 1
      expect(probePlaceholderIndex(probe({ previewTopY: 160 }))).toBe(1);
    });

    it('counts the scroll offset in', () => {
      expect(probePlaceholderIndex(probe({ previewTopY: 160, scrollTop: 500 }))).toBe(11);
    });

    it('caps the probe of a preview taller than the rows at half a row below its top', () => {
      // A 200px preview: its center (100 + 100) would be slot 2, the cap keeps slot 0
      expect(probePlaceholderIndex(probe({ previewHeight: 200 }))).toBe(0);
    });

    it('counts the hidden source in for slots at or after it in its own list', () => {
      expect(probePlaceholderIndex(probe({ previewTopY: 160, sourceIndex: 0 }))).toBe(2);
      expect(probePlaceholderIndex(probe({ previewTopY: 160, sourceIndex: 3 }))).toBe(1);
    });
  });

  describe('with a strategy', () => {
    it('advances past a row only once the preview top crosses its midpoint', () => {
      const strategy = new DynamicHeightStrategy(50);
      strategy.setItemKeys(['a', 'b', 'c']);
      strategy.setMeasuredHeight('b', 150);
      // Row b spans 50..200 (list Y 150..300), midpoint list Y 225

      // Preview top at 210: probe at 235 is in row b, top before its midpoint
      expect(probePlaceholderIndex(probe({ previewTopY: 210, strategy }))).toBe(1);
      // Preview top at 230: past the midpoint
      expect(probePlaceholderIndex(probe({ previewTopY: 230, strategy }))).toBe(2);
    });

    it('counts the hidden source in until the strategy excludes it', () => {
      const strategy = new FixedHeightStrategy(50);
      strategy.setItemCount(5);
      // Preview top at 200 (list offset 100): row 2 before the exclusion
      const probeAtRow2 = probe({ previewTopY: 200, strategy, sourceIndex: 1 });

      expect(probePlaceholderIndex(probeAtRow2)).toBe(3);

      // Excluded, the rows after the source close up: offset 100 is row 3 of the list as it is
      strategy.setExcludedIndex(1);
      expect(probePlaceholderIndex(probeAtRow2)).toBe(3);
    });
  });
});
