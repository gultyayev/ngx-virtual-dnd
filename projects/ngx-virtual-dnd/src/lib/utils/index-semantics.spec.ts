import { insertionToPlaceholderIndex, placeholderToInsertionIndex } from './index-semantics';

describe('index semantics', () => {
  describe('insertionToPlaceholderIndex', () => {
    // [A, B, C, D], dragging B (source 1): without B the list is [A, C, D]
    it('counts the hidden source in for a slot at or after it in its own list', () => {
      expect(insertionToPlaceholderIndex(1, 1, true)).toBe(2); // where B was
      expect(insertionToPlaceholderIndex(3, 1, true)).toBe(4); // the end
    });

    it('leaves a slot before the source as it is', () => {
      expect(insertionToPlaceholderIndex(0, 1, true)).toBe(0);
    });

    it('leaves a slot in another list as it is', () => {
      expect(insertionToPlaceholderIndex(3, 1, false)).toBe(3);
    });

    it('leaves the slot as it is without a known source index', () => {
      expect(insertionToPlaceholderIndex(3, null, true)).toBe(3);
      expect(insertionToPlaceholderIndex(3, -1, true)).toBe(3);
    });
  });

  describe('placeholderToInsertionIndex', () => {
    const sameList = { sourceDroppableId: 'list', activeDroppableId: 'list' };

    it('takes the hidden source out for a slot after it in its own list', () => {
      expect(
        placeholderToInsertionIndex({ ...sameList, sourceIndex: 1, placeholderIndex: 4 }),
      ).toBe(3);
    });

    it('leaves the slot of the source and the slots before it as they are', () => {
      expect(
        placeholderToInsertionIndex({ ...sameList, sourceIndex: 1, placeholderIndex: 1 }),
      ).toBe(1);
      expect(
        placeholderToInsertionIndex({ ...sameList, sourceIndex: 1, placeholderIndex: 0 }),
      ).toBe(0);
    });

    it('leaves a slot in another list as it is', () => {
      expect(
        placeholderToInsertionIndex({
          sourceDroppableId: 'a',
          activeDroppableId: 'b',
          sourceIndex: 1,
          placeholderIndex: 4,
        }),
      ).toBe(4);
    });

    it('returns null without a placeholder', () => {
      expect(
        placeholderToInsertionIndex({ ...sameList, sourceIndex: 1, placeholderIndex: null }),
      ).toBeNull();
    });

    it('undoes insertionToPlaceholderIndex for every slot of a same-list drag', () => {
      const sourceIndex = 2;
      // Without the source a list of 5 has slots 0..4
      for (let insertion = 0; insertion <= 4; insertion++) {
        const placeholderIndex = insertionToPlaceholderIndex(insertion, sourceIndex, true);
        expect(placeholderToInsertionIndex({ ...sameList, sourceIndex, placeholderIndex })).toBe(
          insertion,
        );
      }
    });
  });
});
